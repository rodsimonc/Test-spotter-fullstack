import { expect, type Locator, type Page, type Response } from '@playwright/test'
import type { PlanRequest, PlanResponse } from '../../src/api/types'
import { DURATION_TOLERANCE_MINUTES, expectWithin, firstNumber, parseMinutes } from './parse'

export const FIELDS = ['current', 'pickup', 'dropoff'] as const
export type FieldName = (typeof FIELDS)[number]

/** The three places behind "Try an example": Dallas, then Memphis, then Denver. */
export const EXAMPLE_PLACES = {
  current: { label: 'Dallas, TX', lat: 32.7767, lon: -96.797 },
  pickup: { label: 'Memphis, TN', lat: 35.1495, lon: -90.049 },
  dropoff: { label: 'Denver, CO', lat: 39.7392, lon: -104.9903 },
} as const

const pad = (n: number) => String(n).padStart(2, '0')

/** Offset of a zone at an instant, such as "GMT-05:00". */
function zoneOffset(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')
  return parts?.value ?? ''
}

/**
 * A departure far enough ahead to be in the future and clear of a US clock change for the
 * following 9 days, as "YYYY-MM-DDTHH:mm". Keeps the DST warning out of tests that do not
 * care about it. Always a Monday.
 */
export function safeDeparture(hour = 6, now = new Date()): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12))
  day.setUTCDate(day.getUTCDate() + 10)
  while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1)
  for (let week = 0; week < 60; week++) {
    const later = new Date(day.getTime() + 9 * 86_400_000)
    if (zoneOffset(day, 'America/Chicago') === zoneOffset(later, 'America/Chicago')) break
    day.setUTCDate(day.getUTCDate() + 7)
  }
  const date = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`
  return `${date}T${pad(hour)}:00`
}

export function exampleRequest(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    current: { ...EXAMPLE_PLACES.current },
    pickup: { ...EXAMPLE_PLACES.pickup },
    dropoff: { ...EXAMPLE_PLACES.dropoff },
    cycle_used_hours: 24,
    departure: safeDeparture(),
    timezone: 'America/Chicago',
    header: {},
    ...overrides,
  }
}

/** The same encoding as the Share button: base64url of the request JSON. */
export function encodeTrip(request: PlanRequest): string {
  return Buffer.from(JSON.stringify(request), 'utf8').toString('base64url')
}

export function decodeTrip(param: string): PlanRequest {
  return JSON.parse(Buffer.from(param, 'base64url').toString('utf8')) as PlanRequest
}

export const tripUrl = (request: PlanRequest) => `/?trip=${encodeTrip(request)}`

// Navigation and planning ---------------------------------------------------------------

/** Opens the app and waits until it knows whether anyone is signed in. */
export async function gotoApp(page: Page, path = '/'): Promise<void> {
  const known = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/me')
  await page.goto(path)
  await known
  await expect(page.getByTestId('btn-plan')).toBeVisible()
}

export const isPlanCall = (response: Response) =>
  new URL(response.url()).pathname.replace(/\/$/, '') === '/api/plan' &&
  response.request().method() === 'POST'

export const waitForPlanCall = (page: Page) => page.waitForResponse(isPlanCall)

/** Presses Plan, waits for a 200, and returns the body the UI is now showing. */
export async function clickPlan(page: Page): Promise<PlanResponse> {
  const [response] = await Promise.all([
    waitForPlanCall(page),
    page.getByTestId('btn-plan').click(),
  ])
  expect(response.status(), await response.text()).toBe(200)
  const plan = (await response.json()) as PlanResponse
  await expect(page.getByTestId('stats-strip')).toBeVisible()
  return plan
}

/** "Try an example", check the form filled in, then Plan. */
export async function planExample(page: Page): Promise<PlanResponse> {
  await page.getByTestId('btn-example').click()
  await expect(page.getByTestId('field-current')).toHaveValue(/Dallas/i)
  await expect(page.getByTestId('field-pickup')).toHaveValue(/Memphis/i)
  await expect(page.getByTestId('field-dropoff')).toHaveValue(/Denver/i)
  return clickPlan(page)
}

/** Opens a share link for the request. Returns the plan call that the page makes on load. */
export async function openTrip(page: Page, request: PlanRequest): Promise<Response> {
  const planned = waitForPlanCall(page)
  await page.goto(tripUrl(request))
  return planned
}

/** Same, for a request that should plan fine. Waits for the results. */
export async function openTripAndPlan(page: Page, request: PlanRequest): Promise<PlanResponse> {
  const response = await openTrip(page, request)
  expect(response.status(), await response.text()).toBe(200)
  await expect(page.getByTestId('stats-strip')).toBeVisible()
  return (await response.json()) as PlanResponse
}

// Place fields -----------------------------------------------------------------------------

export const field = (page: Page, name: FieldName) => page.getByTestId(`field-${name}`)

/**
 * Types into a place field the way a person does, waits for a matching suggestion and clicks
 * it. Returns the text the field ends up with.
 */
export async function choosePlace(
  page: Page,
  name: FieldName,
  query: string,
  match?: string | RegExp,
): Promise<string> {
  const input = field(page, name)
  await input.click()
  await input.clear()
  await input.pressSequentially(query, { delay: 15 })
  const options = page.getByTestId('suggestion')
  const option = (match ? options.filter({ hasText: match }) : options).first()
  await expect(option).toBeVisible()
  await option.click()
  await expect(options).toHaveCount(0)
  await expect(input).not.toHaveValue('')
  return input.inputValue()
}

/** Fills all three fields from the typeahead. */
export async function choosePlaces(
  page: Page,
  places: Record<FieldName, { query: string; match?: string | RegExp }>,
): Promise<void> {
  for (const name of FIELDS) await choosePlace(page, name, places[name].query, places[name].match)
}

/** The error under a field. Cycle and departure errors may use the field or the API name. */
export function formError(page: Page, name: string): Locator {
  const aliases: Record<string, string[]> = {
    cycle: ['cycle', 'cycle_used_hours'],
    departure: ['departure'],
  }
  const ids = aliases[name] ?? [name]
  return page.locator(ids.map((id) => `[data-testid="form-error-${id}"]`).join(', ')).first()
}

// Results ------------------------------------------------------------------------------------

export const stopCards = (page: Page) => page.locator('[data-testid^="stop-card-"]')
export const markers = (page: Page) => page.locator('[data-testid^="marker-"]')
export const dayChips = (page: Page) => page.locator('[data-testid^="day-chip-"]')
export const visibleSheets = (page: Page) => page.locator('[data-testid^="log-sheet-"]:visible')

export const idFrom = async (locator: Locator, prefix: string) =>
  ((await locator.getAttribute('data-testid')) ?? '').slice(prefix.length)

/** Checks the stats strip against the API response it was drawn from. */
export async function expectStatsToMatch(page: Page, plan: PlanResponse): Promise<void> {
  const read = (id: string) => page.getByTestId(id).innerText()
  const { summary } = plan
  expectWithin(firstNumber(await read('stat-distance')), summary.distance_miles, 1, 'distance')
  expect(firstNumber(await read('stat-days')), 'days').toBe(summary.days)
  expect(firstNumber(await read('stat-fuel')), 'fuel stops').toBe(summary.fuel_stops)
  for (const [id, minutes] of [
    ['stat-driving', summary.driving_minutes],
    ['stat-trip-time', summary.elapsed_minutes],
  ] as const) {
    const shown = parseMinutes(await read(id))
    expect(shown, `${id} should be readable as a duration`).not.toBeNull()
    expectWithin(shown ?? 0, minutes, DURATION_TOLERANCE_MINUTES, id)
  }
  expect((await read('stat-arrival')).trim()).not.toBe('')
}

/** Opens the tab and waits for its panel. */
export async function openTab(
  page: Page,
  tab: 'itinerary' | 'directions' | 'logs' | 'summary',
): Promise<void> {
  await page.getByTestId(`tab-${tab}`).click()
  await expect(page.getByTestId(`panel-${tab}`)).toBeVisible()
}
