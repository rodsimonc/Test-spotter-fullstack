import type { Locator, Page } from '@playwright/test'
import { hasNoHorizontalScroll } from '../helpers/keyboard'
import { clickMap } from '../helpers/map'
import { openAuthDialog, signedInApp } from '../helpers/auth'
import { FIELDS, field, gotoApp, openTab, planExample } from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { openTripsDrawer, seedTrip } from '../helpers/trips'
import { uniqueTitle } from '../helpers/ui'

// A phone in portrait: 390 by 844 CSS pixels, touch, mobile browser behavior.
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
})

const WIDTH = 390
/** The smallest tap target worth shipping. WCAG 2.2 AA says 24 px, the app's buttons are 36 px. */
const MIN_TAP = 32

async function expectOnScreen(locator: Locator, name: string, width = WIDTH) {
  // Drawers and dialogs slide in. Wait until the box stops moving before judging it.
  let last = ''
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox()
        const now = box ? `${box.x.toFixed(1)}:${box.width.toFixed(1)}` : 'none'
        const settled = now === last
        last = now
        return settled
      },
      { message: `${name} should stop moving` },
    )
    .toBe(true)
  const box = await locator.boundingBox()
  expect(box, `${name} should be on the page`).not.toBeNull()
  expect(box!.x, `${name} starts inside the screen`).toBeGreaterThanOrEqual(-0.5)
  expect(box!.x + box!.width, `${name} ends inside the screen`).toBeLessThanOrEqual(width + 0.5)
}

async function expectTappable(locator: Locator, name: string) {
  const box = await locator.boundingBox()
  expect(box, `${name} should be on the page`).not.toBeNull()
  expect(box!.height, `${name} is tall enough to tap`).toBeGreaterThanOrEqual(MIN_TAP)
  expect(box!.width, `${name} is wide enough to tap`).toBeGreaterThanOrEqual(MIN_TAP)
}

async function expectNoSideScroll(page: Page, where: string) {
  expect(await hasNoHorizontalScroll(page), `${where} scrolls sideways`).toBe(true)
}

test.describe('phone layout before planning', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  test('does not scroll sideways', async ({ page }) => {
    await expectNoSideScroll(page, 'the empty page')
  })

  test('fits the header, the form and the map on screen', async ({ page }) => {
    await expectOnScreen(page.getByTestId('btn-sign-in'), 'Sign in')
    await expectOnScreen(page.getByTestId('btn-sign-up'), 'Create account')
    for (const name of FIELDS) await expectOnScreen(field(page, name), `${name} field`)
    for (const id of [
      'btn-plan',
      'btn-example',
      'btn-reset',
      'input-cycle',
      'input-departure',
      'select-timezone',
    ]) {
      await expectOnScreen(page.getByTestId(id), id)
    }
    await expectOnScreen(page.getByTestId('map'), 'the map')
  })

  test('stacks the form above the map', async ({ page }) => {
    const form = (await page.getByTestId('btn-plan').boundingBox())!
    const map = (await page.getByTestId('map').boundingBox())!
    expect(map.y, 'the map sits below the form').toBeGreaterThan(form.y + form.height - 1)
    expect(map.width, 'the map uses the width of the phone').toBeGreaterThan(WIDTH - 48)
  })

  test('gives every control a tap target big enough for a thumb', async ({ page }) => {
    for (const id of [
      'btn-sign-in',
      'btn-sign-up',
      'btn-plan',
      'btn-example',
      'btn-reset',
      'btn-swap',
    ]) {
      await expectTappable(page.getByTestId(id), id)
    }
    for (const name of FIELDS)
      await expectTappable(page.getByTestId(`btn-pick-${name}`), `pick ${name}`)
  })

  test('uses a text size the browser will not zoom in on', async ({ page }) => {
    // iOS zooms the page when an input's font is under 16 px. That shifts the layout on focus.
    for (const id of ['field-current', 'input-cycle', 'input-departure']) {
      const size = await page
        .getByTestId(id)
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(size, `${id} font size`).toBeGreaterThanOrEqual(16)
    }
  })

  test('picks a place on the map with one tap', async ({ page }) => {
    await page.getByTestId('btn-pick-pickup').click()
    await expect(page.getByTestId('pick-banner')).toBeVisible()
    await expectOnScreen(page.getByTestId('pick-banner'), 'the pick banner')
    await clickMap(page)
    await expect(field(page, 'pickup')).not.toHaveValue('')
    await expect(page.getByTestId('pick-banner')).toBeHidden()
  })

  test('still reads at the narrowest common phone, 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await expectNoSideScroll(page, 'the empty page at 320 px')
    await expectOnScreen(page.getByTestId('btn-plan'), 'Plan trip', 320)
    await expectOnScreen(page.getByTestId('btn-sign-up'), 'Create account', 320)
  })
})

test.describe('phone layout with results', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await planExample(page)
  })

  test('does not scroll sideways on any tab', async ({ page }) => {
    for (const tab of ['itinerary', 'logs', 'summary'] as const) {
      await openTab(page, tab)
      await expectNoSideScroll(page, `the ${tab} tab`)
    }
  })

  test('brings the map into view after planning', async ({ page }) => {
    await expect(page.getByTestId('map')).toBeInViewport({ ratio: 0.5 })
  })

  test('keeps the action buttons on screen and tappable', async ({ page }) => {
    for (const id of ['btn-share', 'btn-pdf', 'btn-print', 'btn-save']) {
      const button = page.getByTestId(id)
      await button.scrollIntoViewIfNeeded()
      await expectOnScreen(button, id)
      await expectTappable(button, id)
    }
  })

  test('shows the stats in a grid that fits', async ({ page }) => {
    const strip = page.getByTestId('stats-strip')
    await strip.scrollIntoViewIfNeeded()
    await expectOnScreen(strip, 'the stats strip')
    for (const id of [
      'stat-distance',
      'stat-driving',
      'stat-trip-time',
      'stat-arrival',
      'stat-days',
      'stat-fuel',
    ]) {
      await expectOnScreen(page.getByTestId(id), id)
    }
  })

  test('scales the log sheet to the phone without cutting it off', async ({ page }) => {
    await openTab(page, 'logs')
    const sheet = page.locator('[data-testid^="log-sheet-"]:visible').first()
    await sheet.scrollIntoViewIfNeeded()
    await expectOnScreen(sheet, 'the log sheet')
    const box = (await sheet.boundingBox())!
    expect(box.width, 'the sheet should use most of the width').toBeGreaterThan(WIDTH - 64)
    expect(box.height / box.width).toBeCloseTo(1100 / 850, 1)
  })

  test('steps through the days with the buttons', async ({ page }) => {
    await openTab(page, 'logs')
    const next = page.getByTestId('btn-next-day')
    await next.scrollIntoViewIfNeeded()
    await expectTappable(next, 'next day')
    await next.click()
    await expect(page.locator('[data-testid="log-sheet-2"]:visible')).toBeVisible()
    await expectNoSideScroll(page, 'day 2')
  })

  test('keeps stop cards inside the screen', async ({ page }) => {
    const cards = page.locator('[data-testid^="stop-card-"]')
    const count = await cards.count()
    expect(count).toBeGreaterThan(3)
    for (let i = 0; i < count; i++) await expectOnScreen(cards.nth(i), `stop card ${i + 1}`)
  })

  test('opens the map popup for a stop when its card is tapped', async ({ page }) => {
    await page.locator('[data-testid^="stop-card-"]').nth(1).click()
    await expect(page.locator('.leaflet-popup')).toBeVisible()
    await expect(page.getByTestId('map')).toBeInViewport({ ratio: 0.5 })
  })
})

test.describe('phone layout with dialogs', () => {
  test('shows the sign in dialog whole, with the submit button in view', async ({ page }) => {
    await gotoApp(page)
    const dialog = await openAuthDialog(page, 'login')
    await expectOnScreen(dialog, 'the dialog')
    for (const id of [
      'input-auth-email',
      'input-auth-password',
      'btn-auth-submit',
      'btn-auth-close',
    ]) {
      await expect(page.getByTestId(id)).toBeInViewport()
    }
    await expectTappable(page.getByTestId('btn-auth-submit'), 'submit')
    await expectTappable(page.getByTestId('btn-auth-close'), 'close')
    await expectNoSideScroll(page, 'the sign in dialog')
  })

  test('shows the create account dialog with the keyboard-friendly fields', async ({ page }) => {
    await gotoApp(page)
    const dialog = await openAuthDialog(page, 'register')
    await expectOnScreen(dialog, 'the dialog')
    await expect(page.getByTestId('btn-auth-submit')).toBeInViewport()
    expect(await page.getByTestId('input-auth-email').getAttribute('type')).toBe('email')
    expect(await page.getByTestId('input-auth-password').getAttribute('autocomplete')).toBe(
      'new-password',
    )
  })

  test('fits the trips drawer to the screen', async ({ page }) => {
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Phone'))
    const drawer = await openTripsDrawer(page)
    await expectOnScreen(drawer, 'the drawer')
    await expectOnScreen(page.getByTestId(`trip-row-${trip.id}`), 'a trip row')
    await expectTappable(page.getByTestId(`btn-open-trip-${trip.id}`), 'Open')
    await expectTappable(page.getByTestId(`btn-delete-trip-${trip.id}`), 'Delete')
    await expectTappable(page.getByTestId('btn-close-trips'), 'Close')
    await expectNoSideScroll(page, 'the trips drawer')
  })

  test('fits the signed-in header', async ({ page }) => {
    await signedInApp(page)
    await expectOnScreen(page.getByTestId('account-menu'), 'the account menu')
    await page.getByTestId('account-menu').click()
    await expectOnScreen(page.getByTestId('btn-sign-out'), 'Sign out')
    await expectOnScreen(page.getByTestId('btn-my-trips'), 'My trips')
  })
})
