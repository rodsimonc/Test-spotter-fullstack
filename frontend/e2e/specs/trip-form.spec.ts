import type { Page } from '@playwright/test'
import { expect, test } from '../helpers/test'
import { clickMap } from '../helpers/map'
import {
  FIELDS,
  choosePlace,
  clickPlan,
  field,
  formError,
  gotoApp,
  safeDeparture,
} from '../helpers/plan'

const isGeocodeSearch = (url: string) => new URL(url).pathname === '/api/geocode/search'

/** Types slowly enough to look human and returns the search calls the page made. */
function trackSearches(page: Page): URL[] {
  const calls: URL[] = []
  page.on('request', (request) => {
    if (isGeocodeSearch(request.url())) calls.push(new URL(request.url()))
  })
  return calls
}

test.describe('place typeahead', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  for (const name of FIELDS) {
    test(`fills the ${name} field from a suggestion`, async ({ page }) => {
      const value = await choosePlace(page, name, 'Denv', /Denver/)
      expect(value).toMatch(/Denver/)
    })
  }

  test('waits for two characters and sends one request per pause', async ({ page }) => {
    const searches = trackSearches(page)
    const input = field(page, 'current')
    await input.click()
    await input.pressSequentially('D')
    // The one fixed wait in the suite. Proving that a request does not happen means letting the
    // 300 ms debounce window pass twice over. Nothing on the page changes that a test could wait for.
    await page.waitForTimeout(700)
    expect(searches, 'one character is too short to search').toHaveLength(0)

    await input.pressSequentially('enve')
    await page.waitForResponse((r) => isGeocodeSearch(r.url()))
    // Without a debounce, each of the four keystrokes would have sent its own request by now.
    // One is what a debounce gives. Two allows for a machine so busy that typing stalled.
    expect(searches.length, 'typing without a pause should send one request').toBeLessThanOrEqual(2)
    expect(searches.at(-1)?.searchParams.get('q')).toBe('Denve')
  })

  test('marks the field as a combobox and each suggestion as an option', async ({ page }) => {
    const input = field(page, 'pickup')
    await expect(input).toHaveAttribute('role', 'combobox')
    await input.click()
    await input.pressSequentially('Mem', { delay: 20 })
    await expect(page.getByTestId('suggestion').first()).toBeVisible()
    await expect(input).toHaveAttribute('aria-expanded', 'true')
    // The time zone <select> has options too, so look only inside this field's list.
    const list = page.locator(`[id="${await input.getAttribute('aria-controls')}"]`)
    await expect(list).toHaveAttribute('role', 'listbox')
    expect(await list.getByRole('option').count()).toBe(
      await page.getByTestId('suggestion').count(),
    )
  })

  test('picks a suggestion with the arrow keys and Enter', async ({ page }) => {
    const input = field(page, 'dropoff')
    await input.click()
    await input.pressSequentially('Denv', { delay: 20 })
    await expect(page.getByTestId('suggestion').first()).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(input).toHaveValue(/Denver/)
  })

  test('closes the list on Escape and keeps what was typed', async ({ page }) => {
    const input = field(page, 'current')
    await input.click()
    await input.pressSequentially('Dall', { delay: 20 })
    await expect(page.getByTestId('suggestion').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(input).toHaveValue('Dall')
  })

  test('shows no suggestions when nothing matches', async ({ page }) => {
    const input = field(page, 'current')
    await input.click()
    const answered = page.waitForResponse((r) => isGeocodeSearch(r.url()))
    await input.pressSequentially('zzzzqqxx', { delay: 10 })
    expect((await answered).status()).toBe(200)
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(input).toBeEditable()
  })

  test('survives the search service failing', { tag: '@fake' }, async ({ page }) => {
    const input = field(page, 'current')
    await input.click()
    const answered = page.waitForResponse((r) => isGeocodeSearch(r.url()))
    await input.pressSequentially('boom', { delay: 10 })
    const response = await answered
    expect(response.status()).toBe(502)
    expect((await response.json()).error.code).toBe('upstream_error')
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(input).toBeEditable()
  })

  test(
    'lists both Springfields so the person can tell them apart',
    { tag: '@fake' },
    async ({ page }) => {
      const input = field(page, 'current')
      await input.click()
      await input.pressSequentially('Springfield', { delay: 10 })
      await expect(page.getByTestId('suggestion')).toHaveCount(2)
      const labels = await page.getByTestId('suggestion').allInnerTexts()
      expect(new Set(labels).size).toBe(2)
    },
  )
})

test.describe('field buttons', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await expect(field(page, 'dropoff')).toHaveValue(/Denver/)
  })

  for (const name of FIELDS) {
    test(`clears the ${name} field`, async ({ page }) => {
      await page.getByTestId(`btn-clear-${name}`).click()
      await expect(field(page, name)).toHaveValue('')
      for (const other of FIELDS.filter((f) => f !== name)) {
        await expect(field(page, other)).not.toHaveValue('')
      }
    })
  }

  test('swaps pickup and dropoff', async ({ page }) => {
    await page.getByTestId('btn-swap').click()
    await expect(field(page, 'pickup')).toHaveValue(/Denver/)
    await expect(field(page, 'dropoff')).toHaveValue(/Memphis/)
    await expect(field(page, 'current')).toHaveValue(/Dallas/)
    await page.getByTestId('btn-swap').click()
    await expect(field(page, 'pickup')).toHaveValue(/Memphis/)
    await expect(field(page, 'dropoff')).toHaveValue(/Denver/)
  })

  test('swapping changes the route that gets planned', async ({ page }) => {
    const before = await clickPlan(page)
    await page.getByTestId('btn-swap').click()
    const after = await clickPlan(page)
    expect(after.request.pickup.lat).toBeCloseTo(before.request.dropoff.lat, 3)
    expect(after.request.dropoff.lat).toBeCloseTo(before.request.pickup.lat, 3)
    expect(after.summary.legs[0].distance_miles).not.toBeCloseTo(
      before.summary.legs[0].distance_miles,
      0,
    )
  })

  test('resets the form to its defaults', async ({ page }) => {
    await page.getByTestId('btn-reset').click()
    for (const name of FIELDS) await expect(field(page, name)).toHaveValue('')
    await expect(page.getByTestId('input-cycle')).toHaveValue(/^0(\.0+)?$/)
  })

  test('resets after a plan, and the next plan starts clean', async ({ page }) => {
    await clickPlan(page)
    await page.getByTestId('btn-reset').click()
    for (const name of FIELDS) await expect(field(page, name)).toHaveValue('')
    await page.getByTestId('btn-plan').click()
    await expect(formError(page, 'current')).toBeVisible()
  })
})

test.describe('example trip', () => {
  test('fills Dallas, Memphis and Denver, 24 hours, next 06:00', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await expect(field(page, 'current')).toHaveValue(/Dallas/)
    await expect(field(page, 'pickup')).toHaveValue(/Memphis/)
    await expect(field(page, 'dropoff')).toHaveValue(/Denver/)
    expect(Number(await page.getByTestId('input-cycle').inputValue())).toBe(24)
    await expect(page.getByTestId('input-departure')).toHaveValue(/T06:00$/)
    await expect(page.getByTestId('select-timezone')).toHaveValue('America/Chicago')
  })

  test('picks a departure that is still ahead of now', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    const value = await page.getByTestId('input-departure').inputValue()
    const nowInChicago = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
    expect(Date.parse(`${value}:00Z`)).toBeGreaterThan(
      Date.parse(`${nowInChicago.replace(' ', 'T')}Z`),
    )
  })
})

test.describe('cycle hours', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  test('moves the slider when the number changes', async ({ page }) => {
    await page.getByTestId('input-cycle').fill('30')
    await expect(page.getByTestId('slider-cycle')).toHaveValue('30')
  })

  test('moves the number when the slider changes, a quarter hour at a time', async ({ page }) => {
    const slider = page.getByTestId('slider-cycle')
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(page.getByTestId('input-cycle')).toHaveValue(/^0(\.0+)?$/)
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
    expect(Number(await page.getByTestId('input-cycle').inputValue())).toBe(1)
    await page.keyboard.press('End')
    expect(Number(await page.getByTestId('input-cycle').inputValue())).toBe(70)
  })

  test('rejects more than 70 hours', async ({ page }) => {
    await page.getByTestId('btn-example').click()
    await page.getByTestId('input-cycle').fill('75')
    const sent: string[] = []
    page.on('request', (r) => r.url().includes('/api/plan') && sent.push(r.url()))
    await page.getByTestId('btn-plan').click()
    await expect(formError(page, 'cycle')).toBeVisible()
    await expect(page.getByTestId('input-cycle')).toBeFocused()
    expect(sent).toHaveLength(0)
  })

  test('rejects a negative number', async ({ page }) => {
    await page.getByTestId('btn-example').click()
    await page.getByTestId('input-cycle').fill('-3')
    await page.getByTestId('btn-plan').click()
    await expect(formError(page, 'cycle')).toBeVisible()
  })
})

test.describe('departure and time zone', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  test('defaults to a quarter hour in the browser time zone', async ({ page }) => {
    await expect(page.getByTestId('select-timezone')).toHaveValue('America/Chicago')
    await expect(page.getByTestId('input-departure')).toHaveValue(
      /^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45)$/,
    )
  })

  test('lists IANA zones from every part of North America', async ({ page }) => {
    const zones = await page
      .getByTestId('select-timezone')
      .locator('option')
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value))
    for (const zone of [
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
    ]) {
      expect(zones).toContain(zone)
    }
  })

  test('refuses an empty departure', async ({ page }) => {
    await page.getByTestId('btn-example').click()
    await page.getByTestId('input-departure').fill('')
    await page.getByTestId('btn-plan').click()
    await expect(formError(page, 'departure')).toBeVisible()
  })

  test('keeps a chosen departure and zone in the request', async ({ page }) => {
    await page.getByTestId('btn-example').click()
    await page.getByTestId('input-departure').fill(safeDeparture(7))
    await page.getByTestId('select-timezone').selectOption('America/Denver')
    const plan = await clickPlan(page)
    expect(plan.request.departure).toBe(safeDeparture(7))
    expect(plan.request.timezone).toBe('America/Denver')
    expect(plan.summary.depart_at).toMatch(/T07:00:00-0[67]:00$/)
  })
})

test.describe('log details', () => {
  const FIELD_IDS = [
    'input-driver-name',
    'input-co-driver-name',
    'input-carrier-name',
    'input-main-office',
    'input-home-terminal',
    'input-truck-number',
    'input-trailer-number',
    'input-shipper',
    'input-commodity',
    'input-doc-no',
  ]

  test.beforeEach(async ({ page }) => gotoApp(page))

  test('start collapsed and open and close with the button', async ({ page }) => {
    const toggle = page.getByTestId('btn-log-details')
    const region = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`)
    // Collapsed means zero height and inert, so Tab and screen readers skip the fields.
    // (Playwright still calls an inert, clipped input "visible", so this checks the cause.)
    const height = async () => (await region.boundingBox())?.height ?? 0
    const expectState = async (open: boolean) => {
      await expect(toggle).toHaveAttribute('aria-expanded', String(open))
      await expect(region.locator('[inert]')).toHaveCount(open ? 0 : 1)
      if (open) await expect.poll(height).toBeGreaterThan(100)
      else await expect.poll(height).toBeLessThan(2)
    }

    await expectState(false)
    await toggle.click()
    await expectState(true)
    for (const id of FIELD_IDS) await expect(page.getByTestId(id)).toBeVisible()
    await toggle.click()
    await expectState(false)
  })

  test('stay out of the tab order while collapsed', async ({ page }) => {
    await page.getByTestId('btn-log-details').focus()
    for (let i = 0; i < FIELD_IDS.length + 1; i++) {
      await page.keyboard.press('Tab')
      const id = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? '',
      )
      expect(FIELD_IDS, `Tab reached ${id} inside the collapsed section`).not.toContain(id)
    }
  })

  test('keep what was typed while collapsed', async ({ page }) => {
    await page.getByTestId('btn-log-details').click()
    await page.getByTestId('input-driver-name').fill('Alex Rivera')
    await page.getByTestId('btn-log-details').click()
    await page.getByTestId('btn-log-details').click()
    await expect(page.getByTestId('input-driver-name')).toHaveValue('Alex Rivera')
  })

  test('go to the server in the plan request', async ({ page }) => {
    await page.getByTestId('btn-example').click()
    await expect(field(page, 'dropoff')).toHaveValue(/Denver/)
    await page.getByTestId('btn-log-details').click()
    const values: Record<string, string> = {
      'input-driver-name': 'Alex Rivera',
      'input-co-driver-name': 'Sam Okafor',
      'input-carrier-name': 'Prairie Freight LLC',
      'input-main-office': '100 Main St, Omaha, NE',
      'input-home-terminal': '22 Depot Rd, Dallas, TX',
      'input-truck-number': '101',
      'input-trailer-number': '202',
      'input-shipper': 'Acme Foods',
      'input-commodity': 'Canned goods',
      'input-doc-no': 'BOL-7781',
    }
    for (const [id, value] of Object.entries(values)) await page.getByTestId(id).fill(value)
    const plan = await clickPlan(page)
    expect(plan.request.header).toMatchObject({
      driver_name: 'Alex Rivera',
      co_driver_name: 'Sam Okafor',
      carrier_name: 'Prairie Freight LLC',
      main_office_address: '100 Main St, Omaha, NE',
      home_terminal_address: '22 Depot Rd, Dallas, TX',
      truck_number: '101',
      trailer_number: '202',
      shipper: 'Acme Foods',
      commodity: 'Canned goods',
      shipping_doc_no: 'BOL-7781',
    })
  })
})

test.describe('validation', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  test('names every empty place and focuses the first one', async ({ page }) => {
    const sent: string[] = []
    page.on('request', (r) => r.url().includes('/api/plan') && sent.push(r.url()))
    await page.getByTestId('btn-plan').click()
    for (const name of FIELDS) await expect(formError(page, name)).toBeVisible()
    await expect(field(page, 'current')).toBeFocused()
    expect(sent).toHaveLength(0)
  })

  test('only complains about what is still missing', async ({ page }) => {
    await choosePlace(page, 'current', 'Dallas', /Dallas/)
    await page.getByTestId('btn-plan').click()
    await expect(formError(page, 'current')).toBeHidden()
    await expect(formError(page, 'pickup')).toBeVisible()
    await expect(formError(page, 'dropoff')).toBeVisible()
    await expect(field(page, 'pickup')).toBeFocused()
  })

  test('refuses text that was typed but never picked from the list', async ({ page }) => {
    await page.getByTestId('btn-example').click()
    await field(page, 'pickup').fill('Somewhere I typed')
    await page.keyboard.press('Escape')
    await page.getByTestId('btn-plan').click()
    await expect(formError(page, 'pickup')).toBeVisible()
  })

  test('shows the server message on the field it belongs to', async ({ page }) => {
    await page.route('**/api/plan', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'validation_error',
            message: 'Check the highlighted fields.',
            fields: { cycle_used_hours: ['Must be between 0 and 70.'] },
          },
        }),
      }),
    )
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    await expect(formError(page, 'cycle')).toContainText('Must be between 0 and 70.')
    await expect(page.getByTestId('stats-strip')).toHaveCount(0)
  })

  test('clears an error once the field is fixed', async ({ page }) => {
    await page.getByTestId('btn-plan').click()
    await expect(formError(page, 'current')).toBeVisible()
    await choosePlace(page, 'current', 'Dallas', /Dallas/)
    await expect(formError(page, 'current')).toBeHidden()
  })
})

test.describe('pick on the map', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  for (const name of FIELDS) {
    test(`sets the ${name} place with one click`, async ({ page }) => {
      await page.getByTestId(`btn-pick-${name}`).click()
      await expect(page.getByTestId('pick-banner')).toBeVisible()
      const lookup = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/geocode/reverse',
      )
      await clickMap(page)
      expect((await lookup).status()).toBe(200)
      await expect(page.getByTestId('pick-banner')).toBeHidden()
      await expect(field(page, name)).not.toHaveValue('')
    })

    test(`cancels picking the ${name} place with Escape`, async ({ page }) => {
      await page.getByTestId(`btn-pick-${name}`).click()
      await expect(page.getByTestId('pick-banner')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('pick-banner')).toBeHidden()
      await expect(field(page, name)).toHaveValue('')
    })

    test(`toggles picking the ${name} place off when pressed again`, async ({ page }) => {
      const button = page.getByTestId(`btn-pick-${name}`)
      await button.click()
      await expect(page.getByTestId('pick-banner')).toBeVisible()
      await button.click()
      await expect(page.getByTestId('pick-banner')).toBeHidden()
    })
  }

  test('writes coordinates into the field when no town is found', async ({ page }) => {
    // The API falls back to "lat, lon" text when Nominatim and the town list both come up empty.
    await page.route('**/api/geocode/reverse*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ place: { label: '39.74, -104.99', lat: 39.74, lon: -104.99 } }),
      }),
    )
    await page.getByTestId('btn-pick-current').click()
    await clickMap(page)
    await expect(field(page, 'current')).toHaveValue('39.74, -104.99')
  })
})
