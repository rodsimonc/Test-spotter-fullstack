import { randomInt } from 'node:crypto'
import { MAGIC } from '../fake-upstream/magic.mjs'
import { checkPlan } from '../helpers/hos-check'
import { tabTo } from '../helpers/keyboard'
import {
  EXAMPLE_PLACES,
  clickPlan,
  exampleRequest,
  expectStatsToMatch,
  field,
  gotoApp,
  openTab,
  openTrip,
  openTripAndPlan,
  planExample,
  stopCards,
  waitForPlanCall,
} from '../helpers/plan'
import { upstreamURL } from '../helpers/env'
import { expect, test } from '../helpers/test'
import type { PlanResponse } from '../../src/api/types'

const placeAt = (magic: { name: string; lat: number; lon: number }) => ({
  label: magic.name,
  lat: magic.lat,
  lon: magic.lon,
})

test.describe('planning the example trip', () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
  })

  test('shows stats that match the plan the API returned', async ({ page }) => {
    await expect(page.getByTestId('stats-strip')).toBeVisible()
    await expectStatsToMatch(page, plan)
  })

  test('opens on the itinerary tab', async ({ page }) => {
    await expect(page.getByTestId('panel-itinerary')).toBeVisible()
    await expect(page.getByTestId('panel-directions')).toBeHidden()
    await expect(page.getByTestId('panel-logs')).toBeHidden()
    await expect(page.getByTestId('panel-summary')).toBeHidden()
    await expect(page.getByTestId('empty-state')).toBeHidden()
  })

  test('lists every stop once, under the day it starts on', async ({ page }) => {
    await expect(stopCards(page)).toHaveCount(plan.stops.length)
    for (const day of new Set(plan.stops.map((s) => s.day))) {
      await expect(page.getByTestId(`day-group-${day}`)).toBeVisible()
    }
    for (const stop of plan.stops) {
      const card = page.getByTestId(`day-group-${stop.day}`).getByTestId(`stop-card-${stop.id}`)
      await expect(card).toBeVisible()
      await expect(card).toContainText(stop.title)
      await expect(card).toContainText(stop.place)
    }
  })

  test('shows each warning the API sent, or no banner when there are none', async ({ page }) => {
    const banner = page.getByTestId('warnings')
    if (plan.warnings.length === 0) {
      await expect(banner).toHaveCount(0)
      return
    }
    await expect(banner).toBeVisible()
    for (const warning of plan.warnings) await expect(banner).toContainText(warning)
  })

  test('replans from the form and shows the new numbers', async ({ page }) => {
    await page.getByTestId('input-cycle').fill('60')
    const second = await clickPlan(page)
    expect(second.summary.cycle_used_start_hours).toBe(60)
    expect(second.summary.restarts).toBeGreaterThanOrEqual(1)
    await expectStatsToMatch(page, second)
  })
})

test.describe('trips that stress the rules', () => {
  test('adds a 34-hour restart and says so when the cycle runs out', async ({ page }) => {
    const request = exampleRequest({
      current: { label: 'Seattle, WA', lat: 47.6062, lon: -122.3321 },
      pickup: { label: 'Salt Lake City, UT', lat: 40.7608, lon: -111.891 },
      dropoff: { label: 'Miami, FL', lat: 25.7617, lon: -80.1918 },
      cycle_used_hours: 60,
    })
    const plan = await openTripAndPlan(page, request)

    expect(plan.summary.restarts).toBeGreaterThanOrEqual(1)
    expect(plan.summary.fuel_stops).toBeGreaterThanOrEqual(3)
    expect(plan.warnings.some((w) => /34-hour restart/i.test(w))).toBe(true)
    expect(checkPlan(plan)).toEqual([])

    await expect(page.getByTestId('warnings')).toContainText(/34-hour restart/i)
    await expectStatsToMatch(page, plan)
    for (const stop of plan.stops.filter((s) => s.kind === 'restart')) {
      await expect(page.getByTestId(`stop-card-${stop.id}`)).toContainText(stop.title)
    }
  })

  test('restarts before the first mile when the cycle is already used up', async ({ page }) => {
    const plan = await openTripAndPlan(page, exampleRequest({ cycle_used_hours: 70 }))
    expect(plan.segments[0].kind).toBe('restart')
    expect(plan.summary.restarts).toBeGreaterThanOrEqual(1)
    expect(plan.warnings.length).toBeGreaterThanOrEqual(1)
    expect(checkPlan(plan)).toEqual([])
    await expect(page.getByTestId('warnings')).toBeVisible()
  })

  test('shows start-of-trip times in the home terminal zone, not the browser zone', async ({
    page,
  }) => {
    // The browser runs in Chicago. A Los Angeles departure at 06:00 is 08:00 on the browser clock.
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('select-timezone').selectOption('America/Los_Angeles')
    const departure = (await page.getByTestId('input-departure').inputValue()).replace(
      /T.*/,
      'T06:00',
    )
    await page.getByTestId('input-departure').fill(departure)
    const plan = await clickPlan(page)

    expect(plan.summary.depart_at).toMatch(/T06:00:00-0[78]:00$/)
    const first = plan.stops[0]
    const card = page.getByTestId(`stop-card-${first.id}`)
    await expect(card).toContainText(/0?6:00 AM/)
    await expect(card).not.toContainText(/\b0?8:00/)
  })
})

test.describe('while planning', () => {
  test('shows a skeleton until a slow answer arrives', async ({ page }) => {
    await page.route('**/api/plan', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('loading')).toBeVisible()
    await expect(page.getByTestId('stats-strip')).toHaveCount(0)
    await expect(page.getByTestId('stats-strip')).toBeVisible()
    await expect(page.getByTestId('loading')).toBeHidden()
  })

  test('plans from the keyboard alone', async ({ page }) => {
    await gotoApp(page)
    for (const [name, query] of [
      ['current', 'Oklahoma Ci'],
      ['pickup', 'Memphis'],
      ['dropoff', 'Denver'],
    ] as const) {
      await tabTo(page, `field-${name}`)
      await page.keyboard.type(query, { delay: 20 })
      await expect(page.getByTestId('suggestion').first()).toBeVisible()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(field(page, name)).not.toHaveValue(query)
    }
    await tabTo(page, 'btn-plan')
    const [response] = await Promise.all([waitForPlanCall(page), page.keyboard.press('Enter')])
    expect(response.status()).toBe(200)
    await expect(page.getByTestId('stats-strip')).toBeVisible()

    // Tabs use a roving tabindex: Tab lands on the selected tab, arrow keys move between them.
    await tabTo(page, 'tab-itinerary')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('panel-directions')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('panel-logs')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('panel-summary')).toBeVisible()
  })
})

test.describe('when planning fails', () => {
  test(
    'shows no_route as a banner and lets the person retry',
    { tag: '@fake' },
    async ({ page }) => {
      const first = await openTrip(page, exampleRequest({ dropoff: placeAt(MAGIC.noRoute) }))
      expect(first.status()).toBe(422)
      const { error } = await first.json()
      expect(error.code).toBe('no_route')

      const banner = page.getByTestId('error-banner')
      await expect(banner).toBeVisible()
      await expect(banner).toContainText(error.message)
      await expect(page.getByTestId('stats-strip')).toHaveCount(0)

      const [second] = await Promise.all([
        waitForPlanCall(page),
        page.getByTestId('btn-retry').click(),
      ])
      expect(second.status()).toBe(422)
      await expect(banner).toBeVisible()
    },
  )

  test('shows an upstream failure as a banner', { tag: '@fake' }, async ({ page }) => {
    const response = await openTrip(page, exampleRequest({ pickup: placeAt(MAGIC.brokenBridge) }))
    expect(response.status()).toBe(502)
    expect((await response.json()).error.code).toBe('upstream_error')
    await expect(page.getByTestId('error-banner')).toBeVisible()
    await expect(page.getByTestId('btn-retry')).toBeVisible()
  })

  test('shows a garbled router answer as a banner too', { tag: '@fake' }, async ({ page }) => {
    const response = await openTrip(page, exampleRequest({ pickup: placeAt(MAGIC.garbled) }))
    expect(response.status()).toBe(502)
    await expect(page.getByTestId('error-banner')).toBeVisible()
  })

  test('recovers on retry once the service is back', async ({ page }) => {
    let calls = 0
    await page.route('**/api/plan', (route) => {
      calls += 1
      if (calls > 1) return route.continue()
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'upstream_error', message: 'The routing service did not answer.' },
        }),
      })
    })
    await openTrip(page, exampleRequest())
    await expect(page.getByTestId('error-banner')).toBeVisible()
    const [response] = await Promise.all([
      waitForPlanCall(page),
      page.getByTestId('btn-retry').click(),
    ])
    expect(response.status()).toBe(200)
    await expect(page.getByTestId('stats-strip')).toBeVisible()
    await expect(page.getByTestId('error-banner')).toBeHidden()
  })

  test('shows a throttled answer as a banner', async ({ page }) => {
    await page.route('**/api/plan', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'Retry-After': '30' },
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'throttled', message: 'Too many requests. Try again in 30 seconds.' },
        }),
      }),
    )
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('error-banner')).toBeVisible()
    await expect(page.getByTestId('btn-retry')).toBeVisible()
  })

  test('keeps the form filled in after an error', async ({ page }) => {
    await page.route('**/api/plan', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'server_error', message: 'Something went wrong on our side.' },
        }),
      }),
    )
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('error-banner')).toBeVisible()
    await expect(field(page, 'current')).toHaveValue(/Dallas/)
    await expect(field(page, 'dropoff')).toHaveValue(/Denver/)
  })
})

test.describe('route cache', () => {
  test(
    'asks the router once, and once more for the steps, for a trip that is planned twice',
    { tag: '@fake' },
    async ({ page, request }) => {
      // Coordinates no other test uses, so the call log holds this test's requests only.
      const unique = () => randomInt(1000, 9000) / 1e4
      const current = {
        label: 'Cache check',
        lat: Number((EXAMPLE_PLACES.current.lat - 0.4 + unique()).toFixed(4)),
        lon: Number((EXAMPLE_PLACES.current.lon - 0.4 + unique()).toFixed(4)),
      }
      const needle = `${current.lon.toFixed(6)},${current.lat.toFixed(6)}`
      // A fresh plan makes two router calls: the route, then the best-effort one for the steps.
      const routerCalls = async () => {
        const url = `${upstreamURL}/__calls?service=osrm&contains=${encodeURIComponent(needle)}`
        const { calls } = (await (await request.get(url)).json()) as { calls: { url: string }[] }
        const steps = calls.filter((call) => call.url.includes('steps=true')).length
        return { route: calls.length - steps, steps }
      }

      await openTripAndPlan(page, exampleRequest({ current }))
      expect(await routerCalls()).toEqual({ route: 1, steps: 1 })
      await clickPlan(page)
      expect(await routerCalls(), 'the second plan should come from the cache').toEqual({
        route: 1,
        steps: 1,
      })
    },
  )
})

test.describe('share link on load', () => {
  test('fills the form and shows results for a link', async ({ page }) => {
    const request = exampleRequest({ cycle_used_hours: 12.5 })
    const plan = await openTripAndPlan(page, request)
    await expect(field(page, 'current')).toHaveValue(request.current.label)
    await expect(field(page, 'dropoff')).toHaveValue(request.dropoff.label)
    expect(Number(await page.getByTestId('input-cycle').inputValue())).toBe(12.5)
    expect(plan.request.cycle_used_hours).toBe(12.5)
    await openTab(page, 'summary')
    await expect(page.getByTestId('cycle-meter')).toContainText(/12/)
  })
})
