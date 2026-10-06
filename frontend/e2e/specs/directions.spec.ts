import { HOSTILE_ROAD_POINT, STEPS_FAIL_POINT } from '../fake-upstream/magic.mjs'
import { expectNoSeriousA11yViolations } from '../helpers/a11y'
import {
  RESULT_TABS,
  directionLegs,
  directionStep,
  directionSteps,
  expectMapAt,
  midRoadIndex,
  mileShown,
  showsNumber,
  stepButton,
} from '../helpers/directions'
import { upstreamURL } from '../helpers/env'
import { hasNoHorizontalScroll } from '../helpers/keyboard'
import {
  exampleRequest,
  gotoApp,
  openTab,
  openTripAndPlan,
  planExample,
  stopCards,
} from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { watchForInjection } from '../helpers/ui'
import type { PlanResponse } from '../../src/api/types'

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const WORDS = 'north|northeast|east|southeast|south|southwest|west|northwest'
const EMPTY_NOTE = /Road-by-road directions aren.t available for this trip/
const EMPTY_NOTE_TAIL = /The route on the map and the stops are unaffected/

/** The en and em dash, spelled by code so this file holds neither. */
const DASHES = [8211, 8212].map((code) => String.fromCharCode(code))

const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0)

// Tab order ---------------------------------------------------------------------------------

test.describe('the Directions tab in the tab bar', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await planExample(page)
  })

  test('sits between Itinerary and Daily logs', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'Trip results' }).getByRole('tab')
    await expect(tabs).toHaveCount(4)
    const ids = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
    expect(ids).toEqual(RESULT_TABS.map((tab) => `tab-${tab}`))
  })

  test('opens on Itinerary and shows the Directions panel only when chosen', async ({ page }) => {
    await expect(page.getByTestId('tab-itinerary')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('panel-directions')).toBeHidden()

    await openTab(page, 'directions')
    await expect(page.getByTestId('tab-directions')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('panel-directions')).toHaveAttribute('role', 'tabpanel')
    for (const other of RESULT_TABS.filter((tab) => tab !== 'directions')) {
      await expect(page.getByTestId(`tab-${other}`)).toHaveAttribute('aria-selected', 'false')
      await expect(page.getByTestId(`panel-${other}`)).toBeHidden()
    }
  })

  test('keeps only the open tab in the tab order', async ({ page }) => {
    await openTab(page, 'directions')
    for (const tab of RESULT_TABS) {
      await expect(page.getByTestId(`tab-${tab}`)).toHaveAttribute(
        'tabindex',
        tab === 'directions' ? '0' : '-1',
      )
    }
  })

  test('walks the four tabs with the arrow keys, in order, and wraps at both ends', async ({
    page,
  }) => {
    await page.getByTestId('tab-itinerary').focus()
    for (const next of ['directions', 'logs', 'summary', 'itinerary'] as const) {
      await page.keyboard.press('ArrowRight')
      await expect(page.getByTestId(`tab-${next}`)).toBeFocused()
      await expect(page.getByTestId(`panel-${next}`)).toBeVisible()
    }
    for (const previous of ['summary', 'logs', 'directions'] as const) {
      await page.keyboard.press('ArrowLeft')
      await expect(page.getByTestId(`tab-${previous}`)).toBeFocused()
      await expect(page.getByTestId(`panel-${previous}`)).toBeVisible()
    }
  })

  test('jumps to the first and last tab with Home and End', async ({ page }) => {
    await page.getByTestId('tab-itinerary').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('tab-directions')).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByTestId('tab-summary')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.getByTestId('tab-itinerary')).toBeFocused()
    await expect(page.getByTestId('panel-itinerary')).toBeVisible()
  })
})

// What the API sends and what the tab shows ---------------------------------------------------

test.describe('directions for the example trip', { tag: '@fake' }, () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
  })

  test('the API sends two legs that follow the contract', async () => {
    const [toPickup, toDropoff] = plan.directions
    expect(plan.directions).toHaveLength(2)
    expect([toPickup.from, toPickup.to]).toEqual(['current', 'pickup'])
    expect([toDropoff.from, toDropoff.to]).toEqual(['pickup', 'dropoff'])
    expect(toPickup.title).toBe('Dallas to Memphis')
    expect(toDropoff.title).toBe('Memphis to Denver')

    plan.directions.forEach((leg, i) => {
      const where = `leg ${i}`
      expect(
        Math.abs(leg.distance_miles - plan.summary.legs[i].distance_miles),
        where,
      ).toBeLessThan(0.2)
      expect(leg.steps.length, `${where} step count`).toBeGreaterThanOrEqual(7)
      expect(leg.steps.length, `${where} step count`).toBeLessThanOrEqual(13)
      expect(leg.steps[0].kind).toBe('depart')
      expect(leg.steps.at(-1)?.kind).toBe('arrive')
      expect(leg.steps.at(-1)?.distance_miles).toBe(0)
      expect(
        leg.steps.slice(1, -1).every((step) => step.kind === 'road'),
        where,
      ).toBe(true)

      const total = sum(leg.steps.map((step) => step.distance_miles))
      expect(Math.abs(total - leg.distance_miles), `${where} sum of steps`).toBeLessThanOrEqual(
        0.05,
      )
      for (const step of leg.steps) {
        expect(
          Math.abs(step.distance_miles * 10 - Math.round(step.distance_miles * 10)),
        ).toBeLessThan(1e-6)
        expect(step.lat).toBeGreaterThan(24)
        expect(step.lat).toBeLessThan(50)
        expect(step.lon).toBeGreaterThan(-125)
        expect(step.lon).toBeLessThan(-66)
        if (step.kind === 'arrive') expect(step.heading).toBe('')
        else expect(COMPASS, `${where} heading`).toContain(step.heading)
      }
    })
  })

  test('the miles run on from one leg to the next and match the stops', async () => {
    const [toPickup, toDropoff] = plan.directions
    const miles = plan.directions.flatMap((leg) => leg.steps.map((step) => step.mile))
    expect(miles[0]).toBe(0)
    // Rounding to a tenth can put a leg's last mile a hair above the next leg's first.
    expect(miles.every((mile, i) => i === 0 || mile >= miles[i - 1] - 0.06)).toBe(true)
    expect(Math.abs(toDropoff.steps[0].mile - toPickup.distance_miles)).toBeLessThan(0.15)
    const pickup = plan.stops.find((stop) => stop.kind === 'pickup')!
    expect(Math.abs(pickup.mile - toPickup.steps.at(-1)!.mile)).toBeLessThan(0.5)
  })

  test('the lines read as plain directions, ending in the place names from the request', async () => {
    const [toPickup, toDropoff] = plan.directions
    expect(toPickup.steps.at(-1)?.instruction).toBe('Arrive at Memphis')
    expect(toDropoff.steps.at(-1)?.instruction).toBe('Arrive at Denver')
    expect(['E', 'NE', 'SE']).toContain(toPickup.steps[0].heading)
    expect(['W', 'NW', 'SW']).toContain(toDropoff.steps[0].heading)

    for (const step of plan.directions.flatMap((leg) => leg.steps)) {
      if (step.kind === 'depart') {
        expect(step.instruction).toMatch(new RegExp(`^Head (${WORDS})( on .+)?$`))
      } else if (step.kind === 'road') {
        const known = [
          new RegExp(`^Take [A-Z]+-\\d+[A-Z]* (${COMPASS.join('|')})$`),
          /^Continue on .+$/,
          new RegExp(`^Continue (${COMPASS.join('|')})$`),
        ]
        expect(
          known.some((form) => form.test(step.instruction)),
          step.instruction,
        ).toBe(true)
      }
      expect(
        DASHES.some((dash) => step.instruction.includes(dash)),
        step.instruction,
      ).toBe(false)
    }
    const roads = new Set(plan.directions.flatMap((leg) => leg.steps.map((step) => step.road)))
    expect([...roads].some((road) => /^I-\d+$/.test(road))).toBe(true)
    expect([...roads].some((road) => /^US-\d+$/.test(road))).toBe(true)
  })

  test('draws one card per leg with its title and its distance', async ({ page }) => {
    await openTab(page, 'directions')
    await expect(directionLegs(page)).toHaveCount(2)
    await expect(page.getByTestId('direction-leg-2')).toHaveCount(0)

    for (const [i, leg] of plan.directions.entries()) {
      const card = page.getByTestId(`direction-leg-${i}`)
      await expect(card).toBeVisible()
      await expect(card).toContainText(leg.title)
      // Take the lines out of the card's text. What is left is the header.
      let header = await card.innerText()
      for (const line of await directionSteps(page, i).allInnerTexts())
        header = header.replace(line, '')
      expect(showsNumber(header, leg.distance_miles), `header of leg ${i}: ${header}`).toBe(true)
    }
  })

  test('lists every line of both legs with its instruction, road, distance and mile', async ({
    page,
  }) => {
    await openTab(page, 'directions')
    for (const [i, leg] of plan.directions.entries()) {
      await expect(directionSteps(page, i)).toHaveCount(leg.steps.length)
      for (const [j, step] of leg.steps.entries()) {
        const line = directionStep(page, i, j)
        await expect(line).toContainText(step.instruction)
        if (step.road) await expect(line).toContainText(step.road)
        const text = await line.innerText()
        if (step.kind !== 'arrive') {
          expect(
            showsNumber(text, step.distance_miles),
            `distance on line ${i}-${j}: ${text}`,
          ).toBe(true)
        }
        const mile = mileShown(text)
        expect(mile, `a "mile" note on line ${i}-${j}: ${text}`).not.toBeNull()
        expect(Math.abs(mile! - step.mile), `mile on line ${i}-${j}`).toBeLessThanOrEqual(0.5)
      }
    }
  })

  test('puts the lines of the second leg after the first, in order', async ({ page }) => {
    await openTab(page, 'directions')
    const ids = await directionSteps(page).evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid')),
    )
    const expected = plan.directions.flatMap((leg, i) =>
      leg.steps.map((_, j) => `direction-step-${i}-${j}`),
    )
    expect(ids).toEqual(expected)
  })

  test('makes each line a button', async ({ page }) => {
    await openTab(page, 'directions')
    const button = await stepButton(directionStep(page, 0, 1))
    await expect(button).toHaveRole('button')
    await expect(button).toBeEnabled()
  })

  test('moves the map to a line that is clicked, zoomed in to street level', async ({ page }) => {
    await openTab(page, 'directions')
    const [toPickup, toDropoff] = plan.directions
    const second = midRoadIndex(toDropoff.steps)
    expect(second, 'the second leg should have a road line to click').toBeGreaterThan(1)

    await (await stepButton(directionStep(page, 1, second))).click()
    await expectMapAt(page, toDropoff.steps[second])

    // A second click somewhere else, in the first leg, moves it again.
    const first = midRoadIndex(toPickup.steps)
    expect(first, 'the first leg should have a road line to click').toBeGreaterThan(1)
    await (await stepButton(directionStep(page, 0, first))).click()
    await expectMapAt(page, toPickup.steps[first])
  })

  test('lets the keyboard reach every line: Tab to move, Enter and Space to choose', async ({
    page,
  }) => {
    await openTab(page, 'directions')
    const [leg] = plan.directions
    const a = await stepButton(directionStep(page, 0, 1))
    const b = await stepButton(directionStep(page, 0, 2))
    await expect(a).not.toHaveAttribute('tabindex', '-1')

    await a.focus()
    await expect(a).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(b).toBeFocused()

    await page.keyboard.press('Enter')
    await expectMapAt(page, leg.steps[2])

    await page.keyboard.press('Shift+Tab')
    await expect(a).toBeFocused()
    await page.keyboard.press('Space')
    await expectMapAt(page, leg.steps[1])
  })

  test('has nothing serious for axe to report', async ({ page }) => {
    await openTab(page, 'directions')
    await expect(directionLegs(page)).toHaveCount(2)
    await expectNoSeriousA11yViolations(page, 'results, directions')
  })
})

// A router that gives no steps ------------------------------------------------------------

test.describe('directions when the router gives no steps', { tag: '@fake' }, () => {
  test('plans the trip anyway and says so on the tab, without an error', async ({
    page,
    request,
  }) => {
    const plan = await openTripAndPlan(
      page,
      exampleRequest({
        pickup: { label: 'Amarillo, TX', lat: STEPS_FAIL_POINT.lat, lon: STEPS_FAIL_POINT.lon },
      }),
    )
    expect(plan.directions).toEqual([])
    expect(plan.warnings.join(' ')).not.toMatch(/direction|step|road-by-road/i)
    expect(plan.stops.length).toBeGreaterThan(3)
    expect(plan.route.geometry.length).toBeGreaterThan(100)

    // The failure is real: the fake saw the steps request for these points and turned it down.
    const url = `${upstreamURL}/__calls?service=osrm&contains=${encodeURIComponent('steps=true')}`
    const { calls } = (await (await request.get(url)).json()) as { calls: { url: string }[] }
    const here = new RegExp(`${STEPS_FAIL_POINT.lon}\\d*,${STEPS_FAIL_POINT.lat}\\d*`)
    expect(calls.some((call) => here.test(decodeURIComponent(call.url)))).toBe(true)

    await expect(page.getByTestId('tab-directions')).toBeVisible()
    await openTab(page, 'directions')
    const empty = page.getByTestId('directions-empty')
    await expect(empty).toBeVisible()
    await expect(empty).toContainText(EMPTY_NOTE)
    await expect(empty).toContainText(EMPTY_NOTE_TAIL)
    await expect(empty).not.toHaveAttribute('role', 'alert')
    await expect(directionLegs(page)).toHaveCount(0)
    await expect(directionSteps(page)).toHaveCount(0)
    await expect(page.getByTestId('error-banner')).toHaveCount(0)

    // Everything else about the trip is still there.
    await expect(page.getByTestId('map-legend')).toBeVisible()
    await openTab(page, 'itinerary')
    await expect(stopCards(page)).toHaveCount(plan.stops.length)
    await expectNoSeriousA11yViolations(page, 'results, empty directions')
  })

  test('does not show the empty note when there are directions', async ({ page }) => {
    await gotoApp(page)
    await planExample(page)
    await openTab(page, 'directions')
    await expect(directionLegs(page)).toHaveCount(2)
    await expect(page.getByTestId('directions-empty')).toHaveCount(0)
  })
})

// Hostile text -----------------------------------------------------------------------------

test.describe('a road name made of HTML', { tag: '@fake' }, () => {
  test('is shown as text and never runs', async ({ page }) => {
    const injection = watchForInjection(page)
    const plan = await openTripAndPlan(
      page,
      exampleRequest({
        pickup: {
          label: 'Oklahoma City, OK',
          lat: HOSTILE_ROAD_POINT.lat,
          lon: HOSTILE_ROAD_POINT.lon,
        },
      }),
    )
    const hostile = plan.directions.flatMap((leg, i) =>
      leg.steps
        .map((step, j) => ({ i, j, step }))
        .filter(({ step }) => step.instruction.includes('<img')),
    )
    expect(
      hostile.length,
      'the street named with HTML should reach the page through the API',
    ).toBeGreaterThan(0)

    await openTab(page, 'directions')
    const panel = page.getByTestId('panel-directions')
    for (const { i, j, step } of hostile) {
      await expect(directionStep(page, i, j)).toContainText(step.instruction)
    }
    await expect(panel.locator('img')).toHaveCount(0)
    await expect(panel.locator('[onerror]')).toHaveCount(0)
    await injection.expectClean()

    // Choosing the line puts a pulse ring on the map. That has to be text too.
    const { i, j, step } = hostile[0]
    await (await stepButton(directionStep(page, i, j))).click()
    await expectMapAt(page, step)
    await expect(page.locator('img[src="x"]')).toHaveCount(0)
    await injection.expectClean()
  })
})

// Phone ----------------------------------------------------------------------------------

const WIDTH = 390
/** The smallest tap target worth shipping. WCAG 2.2 AA says 24 px, the app's buttons are 36 px. */
const MIN_TAP = 32

test.describe('on a phone', () => {
  test.use({
    viewport: { width: WIDTH, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })

  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
  })

  test('fits four tabs without scrolling the page sideways', async ({ page }) => {
    await expect(page.getByRole('tab')).toHaveCount(4)
    expect(await hasNoHorizontalScroll(page), 'the page scrolls sideways').toBe(true)

    // A tab bar wider than the screen has to scroll inside itself.
    const bar = page.getByRole('tablist', { name: 'Trip results' })
    const barBox = (await bar.boundingBox())!
    expect(barBox.x).toBeGreaterThanOrEqual(-0.5)
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(WIDTH + 0.5)
    if (await bar.evaluate((el) => el.scrollWidth > el.clientWidth + 1)) {
      expect(['auto', 'scroll']).toContain(
        await bar.evaluate((el) => getComputedStyle(el).overflowX),
      )
    }

    for (const tab of RESULT_TABS) {
      await openTab(page, tab)
      const box = (await page.getByTestId(`tab-${tab}`).boundingBox())!
      expect(box.x, `${tab} tab starts inside the screen`).toBeGreaterThanOrEqual(-0.5)
      expect(box.x + box.width, `${tab} tab ends inside the screen`).toBeLessThanOrEqual(
        WIDTH + 0.5,
      )
      expect(box.height, `${tab} tab is tall enough to tap`).toBeGreaterThanOrEqual(MIN_TAP)
      expect(await hasNoHorizontalScroll(page), `the ${tab} tab scrolls sideways`).toBe(true)
    }
  })

  test(
    'keeps every line inside the screen and big enough to tap',
    { tag: '@fake' },
    async ({ page }) => {
      await openTab(page, 'directions')
      const lines = directionSteps(page)
      await expect(lines).toHaveCount(sum(plan.directions.map((leg) => leg.steps.length)))
      for (const [i, line] of (await lines.all()).entries()) {
        const box = (await line.boundingBox())!
        expect(box.x, `line ${i} starts inside the screen`).toBeGreaterThanOrEqual(-0.5)
        expect(box.x + box.width, `line ${i} ends inside the screen`).toBeLessThanOrEqual(
          WIDTH + 0.5,
        )
        expect(box.height, `line ${i} is tall enough to tap`).toBeGreaterThanOrEqual(MIN_TAP)
      }
      for (let i = 0; i < plan.directions.length; i++) {
        const card = (await page.getByTestId(`direction-leg-${i}`).boundingBox())!
        expect(card.x).toBeGreaterThanOrEqual(-0.5)
        expect(card.x + card.width).toBeLessThanOrEqual(WIDTH + 0.5)
      }
      expect(await hasNoHorizontalScroll(page), 'the directions scroll sideways').toBe(true)
    },
  )

  test(
    'brings the map back into view when a line is tapped',
    { tag: '@fake' },
    async ({ page }) => {
      await openTab(page, 'directions')
      const leg = plan.directions[1]
      const index = leg.steps.length - 3
      const line = directionStep(page, 1, index)
      await line.scrollIntoViewIfNeeded()
      const map = page.getByTestId('map')
      await expect(
        map,
        'the map should be off screen while a late line is in view',
      ).not.toBeInViewport({
        ratio: 0.5,
      })

      await (await stepButton(line)).click()
      await expect(map).toBeInViewport({ ratio: 0.5 })
      await expectMapAt(page, leg.steps[index])
    },
  )

  test('has nothing serious for axe to report at 390 px', async ({ page }) => {
    await openTab(page, 'directions')
    await expectNoSeriousA11yViolations(page, 'directions at 390 px')
  })
})
