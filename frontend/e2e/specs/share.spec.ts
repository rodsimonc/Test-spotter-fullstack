import type { Page } from '@playwright/test'
import type { PlanResponse } from '../../src/api/types'
import { origin } from '../helpers/env'
import {
  clickPlan,
  decodeTrip,
  encodeTrip,
  exampleRequest,
  expectStatsToMatch,
  field,
  gotoApp,
  openTab,
  openTripAndPlan,
  planExample,
  tripUrl,
  waitForPlanCall,
} from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { toastWith } from '../helpers/ui'

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

async function shareLink(page: Page): Promise<string> {
  await page.getByTestId('btn-share').click()
  await expect(toastWith(page, /Link copied/i)).toBeVisible()
  return readClipboard(page)
}

test.describe('share link', () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
  })

  test('copies a link to the clipboard and says so', async ({ page }) => {
    const link = await shareLink(page)
    expect(link.startsWith(`${origin}/?trip=`), link).toBe(true)
    expect(new URL(link).searchParams.get('trip')).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('carries the whole request and nothing private', async ({ page }) => {
    const link = await shareLink(page)
    const shared = decodeTrip(new URL(link).searchParams.get('trip')!)

    expect(shared.current.label).toBe(plan.request.current.label)
    expect(shared.pickup.label).toBe(plan.request.pickup.label)
    expect(shared.dropoff.label).toBe(plan.request.dropoff.label)
    expect(shared.current.lat).toBeCloseTo(plan.request.current.lat, 4)
    expect(shared.dropoff.lon).toBeCloseTo(plan.request.dropoff.lon, 4)
    expect(shared.cycle_used_hours).toBe(plan.request.cycle_used_hours)
    expect(shared.departure).toBe(plan.request.departure)
    expect(shared.timezone).toBe(plan.request.timezone)
    expect(Object.keys(shared).sort()).toEqual(
      ['current', 'cycle_used_hours', 'departure', 'dropoff', 'pickup', 'timezone'].sort(),
    )
  })

  test('leaves the page as it was', async ({ page }) => {
    const before = page.url()
    await shareLink(page)
    expect(page.url()).toBe(before)
    await expect(page.getByTestId('stats-strip')).toBeVisible()
  })

  test('opens in a fresh browser and plans the same trip', async ({ page, openSession }) => {
    const link = await shareLink(page)

    const guest = await openSession()
    const planned = waitForPlanCall(guest.page)
    await guest.page.goto(link)
    const response = await planned
    expect(response.status(), await response.text()).toBe(200)
    const copy = (await response.json()) as PlanResponse
    await expect(guest.page.getByTestId('stats-strip')).toBeVisible()

    expect(copy.summary.distance_miles).toBeCloseTo(plan.summary.distance_miles, 0)
    expect(copy.summary.driving_minutes).toBeCloseTo(plan.summary.driving_minutes, -1)
    expect(copy.summary.elapsed_minutes).toBeCloseTo(plan.summary.elapsed_minutes, -1)
    expect(copy.summary.days).toBe(plan.summary.days)
    expect(copy.summary.fuel_stops).toBe(plan.summary.fuel_stops)
    expect(copy.stops.map((s) => s.kind)).toEqual(plan.stops.map((s) => s.kind))
    expect(copy.logs.map((l) => l.date)).toEqual(plan.logs.map((l) => l.date))
    await expectStatsToMatch(guest.page, copy)

    // The guest never signed in, and did not need to.
    await expect(guest.page.getByTestId('btn-sign-in')).toBeVisible()
    await expect(field(guest.page, 'current')).toHaveValue(plan.request.current.label)
    await expect(field(guest.page, 'dropoff')).toHaveValue(plan.request.dropoff.label)
  })

  test('shows the same days on the daily logs tab for the person who opens it', async ({
    page,
    openSession,
  }) => {
    const link = await shareLink(page)
    const guest = await openSession()
    await guest.page.goto(link)
    await expect(guest.page.getByTestId('stats-strip')).toBeVisible()
    await openTab(guest.page, 'logs')
    await expect(guest.page.locator('[data-testid^="day-chip-"]')).toHaveCount(plan.logs.length)
  })

  test('opens in a new tab of the same browser as well', async ({ page, context }) => {
    const link = await shareLink(page)
    const tab = await context.newPage()
    const planned = waitForPlanCall(tab)
    await tab.goto(link)
    expect((await planned).status()).toBe(200)
    await expect(tab.getByTestId('stats-strip')).toBeVisible()
  })

  test('keeps working after a reload of the shared page', async ({ page, openSession }) => {
    const link = await shareLink(page)
    const guest = await openSession()
    await guest.page.goto(link)
    await expect(guest.page.getByTestId('stats-strip')).toBeVisible()
    const planned = waitForPlanCall(guest.page)
    await guest.page.reload()
    expect((await planned).status()).toBe(200)
    await expect(guest.page.getByTestId('stats-strip')).toBeVisible()
  })

  test('can be shared again from the page it opened', async ({ page, openSession }) => {
    const first = await shareLink(page)
    const guest = await openSession()
    await guest.page.goto(first)
    await expect(guest.page.getByTestId('stats-strip')).toBeVisible()
    const second = await shareLink(guest.page)
    expect(decodeTrip(new URL(second).searchParams.get('trip')!)).toEqual(
      decodeTrip(new URL(first).searchParams.get('trip')!),
    )
  })
})

test.describe('share link with details', () => {
  test('carries the log header and fills it back in', async ({ page, openSession }) => {
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-log-details').click()
    await page.getByTestId('input-driver-name').fill('Alex Rivera')
    await page.getByTestId('input-carrier-name').fill('Prairie Freight LLC')
    await page.getByTestId('input-doc-no').fill('BOL-7781')
    await clickPlan(page)

    const link = await shareLink(page)
    expect(decodeTrip(new URL(link).searchParams.get('trip')!).header).toEqual({
      driver_name: 'Alex Rivera',
      carrier_name: 'Prairie Freight LLC',
      shipping_doc_no: 'BOL-7781',
    })

    const guest = await openSession()
    await guest.page.goto(link)
    await expect(guest.page.getByTestId('stats-strip')).toBeVisible()
    await expect(guest.page.getByTestId('btn-log-details')).toContainText('3 fields filled in')
    await guest.page.getByTestId('btn-log-details').click()
    await expect(guest.page.getByTestId('input-driver-name')).toHaveValue('Alex Rivera')
    await expect(guest.page.getByTestId('input-carrier-name')).toHaveValue('Prairie Freight LLC')
    await expect(guest.page.getByTestId('input-doc-no')).toHaveValue('BOL-7781')
  })

  test('keeps the home terminal zone and departure the sender chose', async ({
    page,
    openSession,
  }) => {
    const request = exampleRequest({
      timezone: 'America/Denver',
      departure: exampleRequest().departure.replace('T06:00', 'T07:30'),
    })
    const sender = await openTripAndPlan(page, request)
    const link = await shareLink(page)

    const guest = await openSession({ timezoneId: 'Pacific/Honolulu' })
    const planned = waitForPlanCall(guest.page)
    await guest.page.goto(link)
    const copy = (await (await planned).json()) as PlanResponse
    expect(copy.request.timezone).toBe('America/Denver')
    expect(copy.request.departure).toBe(sender.request.departure)
    expect(copy.summary.depart_at).toBe(sender.summary.depart_at)
    await expect(guest.page.getByTestId('select-timezone')).toHaveValue('America/Denver')
  })
})

test.describe('opening a link that is not good', () => {
  test('says so when the link is damaged and does not plan anything', async ({ page }) => {
    const plans: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/plan') plans.push(r.url())
    })
    await page.goto('/?trip=%25%25not-a-trip')
    await expect(toastWith(page, /damaged/i)).toBeVisible()
    await expect(page.getByTestId('btn-plan')).toBeVisible()
    await expect(page.getByTestId('stats-strip')).toHaveCount(0)
    expect(plans).toEqual([])
  })

  test('refuses a link whose numbers are out of range', async ({ page }) => {
    const bad = encodeTrip(exampleRequest({ cycle_used_hours: 99 }))
    await page.goto(`/?trip=${bad}`)
    await expect(toastWith(page, /damaged/i)).toBeVisible()
    await expect(page.getByTestId('stats-strip')).toHaveCount(0)
    await expect(field(page, 'current')).toHaveValue('')
  })

  test('refuses a link that is valid JSON of the wrong shape', async ({ page }) => {
    const bad = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64url')
    await page.goto(`/?trip=${bad}`)
    await expect(toastWith(page, /damaged/i)).toBeVisible()
    await expect(page.getByTestId('btn-plan')).toBeVisible()
  })

  test('refuses a link that is far too long', async ({ page }) => {
    await page.goto(`/?trip=${'A'.repeat(9000)}`)
    await expect(toastWith(page, /damaged/i)).toBeVisible()
    await expect(page.getByTestId('btn-plan')).toBeVisible()
  })

  test('shows the API error when a good-looking link cannot be planned', async ({ page }) => {
    await page.route('**/api/plan', (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'no_route', message: 'No driving route connects those places.' },
        }),
      }),
    )
    await page.goto(tripUrl(exampleRequest()))
    await expect(page.getByTestId('error-banner')).toContainText(
      'No driving route connects those places.',
    )
    await expect(field(page, 'current')).toHaveValue(/Dallas/)
  })
})
