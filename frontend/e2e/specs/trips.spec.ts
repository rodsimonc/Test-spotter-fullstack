import type { Page, Request, Response } from '@playwright/test'
import { registerViaApi } from '../helpers/api'
import {
  expectSignedIn,
  newUser,
  signInViaUi,
  signOutViaUi,
  signedInApp,
  submitAuth,
  switchAuthTab,
} from '../helpers/auth'
import {
  clickPlan,
  expectStatsToMatch,
  field,
  gotoApp,
  markers,
  openTab,
  planExample,
  visibleSheets,
} from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { expectTripsLoaded, openTripsDrawer, seedTrip, tripRow, tripRows } from '../helpers/trips'
import { toastWith, uniqueTitle } from '../helpers/ui'

const pathOf = (url: string) => new URL(url).pathname

const isTripSave = (r: Response) =>
  pathOf(r.url()) === '/api/trips' && r.request().method() === 'POST'
const isTripCall = (id: string, method: string) => (r: Response) =>
  pathOf(r.url()) === `/api/trips/${id}` && r.request().method() === method

/** Counts requests that match. Read `.count` when the test is done waiting. */
function countRequests(page: Page, matches: (r: Request) => boolean) {
  const seen = { count: 0 }
  page.on('request', (r) => {
    if (matches(r)) seen.count += 1
  })
  return seen
}

test.describe('saving a trip while signed out', () => {
  test('asks for an account, then saves the trip once signed in', async ({ page, request }) => {
    const user = newUser('save')
    await registerViaApi(request, user)
    await gotoApp(page)
    await planExample(page)

    await page.getByTestId('btn-save').click()
    const dialog = page.getByTestId('auth-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Sign in or create an account to save this trip.')
    await expect(page.getByTestId('tab-auth-login')).toHaveAttribute('aria-selected', 'true')

    const saved = page.waitForResponse(isTripSave)
    await submitAuth(page, 'login', user)
    const response = await saved
    expect(response.status(), await response.text()).toBe(201)
    const trip = await response.json()
    expect(trip.title).toBe('Dallas to Denver')

    await expectSignedIn(page, user)
    await expect(toastWith(page, /Trip saved/i)).toBeVisible()
    await expect(page.getByTestId('btn-save')).toBeDisabled()
    await expect(page.getByTestId('btn-save')).toContainText('Saved')
    await expect(page.getByTestId('stats-strip'), 'the results stay on screen').toBeVisible()

    await openTripsDrawer(page)
    await expect(tripRow(page, trip.id)).toBeVisible()
  })

  test('also saves after the person creates an account in the same dialog', async ({ page }) => {
    const user = newUser('register')
    await gotoApp(page)
    await planExample(page)
    await page.getByTestId('btn-save').click()
    await expect(page.getByTestId('auth-dialog')).toBeVisible()
    await switchAuthTab(page, 'register')

    const saved = page.waitForResponse(isTripSave)
    const created = await submitAuth(page, 'register', user)
    expect(created.status()).toBe(201)
    expect((await saved).status()).toBe(201)
    await expect(page.getByTestId('btn-save')).toContainText('Saved')
  })

  test('forgets the save when the dialog is closed instead', async ({ page, request }) => {
    const user = newUser('cancel')
    await registerViaApi(request, user)
    await gotoApp(page)
    await planExample(page)
    const saves = countRequests(
      page,
      (r) => pathOf(r.url()) === '/api/trips' && r.method() === 'POST',
    )

    await page.getByTestId('btn-save').click()
    await expect(page.getByTestId('auth-dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('auth-dialog')).toBeHidden()
    await expect(page.getByTestId('btn-save')).toBeFocused()

    // Signing in later from the header must not save a trip no one asked to save.
    await signInViaUi(page, user)
    await expect(toastWith(page, /Signed in as/i)).toBeVisible()
    await expect(page.getByTestId('btn-save')).toContainText('Save trip')
    await expect(page.getByTestId('btn-save')).toBeEnabled()
    expect(saves.count).toBe(0)
  })

  test('still plans, shows the map and downloads the PDF without an account', async ({ page }) => {
    await gotoApp(page)
    const plan = await planExample(page)
    await expectStatsToMatch(page, plan)
    await expect(page.getByTestId('btn-pdf')).toBeEnabled()
    await expect(page.getByTestId('btn-share')).toBeEnabled()
    await expect(page.getByTestId('btn-print')).toBeEnabled()
  })
})

test.describe('saving a trip while signed in', () => {
  test.beforeEach(async ({ page }) => {
    await signedInApp(page)
  })

  test('saves with one click and marks the trip saved', async ({ page }) => {
    const plan = await planExample(page)
    const [response] = await Promise.all([
      page.waitForResponse(isTripSave),
      page.getByTestId('btn-save').click(),
    ])
    expect(response.status(), await response.text()).toBe(201)

    const trip = await response.json()
    expect(trip.title).toBe('Dallas to Denver')
    expect(trip.result.summary.distance_miles).toBeCloseTo(plan.summary.distance_miles, 0)
    expect(trip.result.logs).toHaveLength(plan.logs.length)

    await expect(toastWith(page, /Trip saved/i)).toBeVisible()
    await expect(page.getByTestId('btn-save')).toBeDisabled()
    await expect(page.getByTestId('btn-save')).toContainText('Saved')
  })

  test('allows another save once the trip is planned again', async ({ page }) => {
    await planExample(page)
    await page.getByTestId('btn-save').click()
    await expect(page.getByTestId('btn-save')).toContainText('Saved')

    await page.getByTestId('input-cycle').fill('10')
    await clickPlan(page)
    await expect(page.getByTestId('btn-save')).toContainText('Save trip')
    await expect(page.getByTestId('btn-save')).toBeEnabled()
  })
})

test.describe('my trips', () => {
  test('shows an empty state with a hint when nothing is saved', async ({ page }) => {
    await signedInApp(page)
    const drawer = await openTripsDrawer(page)
    await expect(page.getByTestId('trips-empty')).toBeVisible()
    await expect(page.getByTestId('trips-empty')).toContainText('No saved trips yet')
    await expect(tripRows(page)).toHaveCount(0)
    await expect(drawer).toHaveAttribute('role', 'dialog')
    await expect(drawer).toHaveAccessibleName(/My trips/i)
  })

  test('closes with the close button and puts focus back on the account menu', async ({ page }) => {
    await signedInApp(page)
    await openTripsDrawer(page)
    await expect(page.getByTestId('btn-close-trips')).toBeFocused()
    await page.getByTestId('btn-close-trips').click()
    await expect(page.getByTestId('trips-drawer')).toBeHidden()
    await expect(page.getByTestId('account-menu')).toBeFocused()
  })

  test('closes on Escape', async ({ page }) => {
    await signedInApp(page)
    await openTripsDrawer(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('trips-drawer')).toBeHidden()
  })

  test('closes when the backdrop is clicked', async ({ page }) => {
    await signedInApp(page)
    await openTripsDrawer(page)
    await page.mouse.click(4, 4)
    await expect(page.getByTestId('trips-drawer')).toBeHidden()
  })

  test('lists saved trips newest first with their route, distance and days', async ({ page }) => {
    await signedInApp(page)
    const first = await seedTrip(page.request, uniqueTitle('First'))
    const second = await seedTrip(page.request, uniqueTitle('Second'))
    const third = await seedTrip(page.request, uniqueTitle('Third'))

    await openTripsDrawer(page)
    await expectTripsLoaded(page)
    await expect(tripRows(page)).toHaveCount(3)
    expect(
      await tripRows(page).evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid'))),
    ).toEqual([`trip-row-${third.id}`, `trip-row-${second.id}`, `trip-row-${first.id}`])
    await expect(page.getByTestId('trips-drawer')).toContainText('3 saved, newest first')

    const row = tripRow(page, first.id)
    await expect(row).toContainText(first.title)
    for (const city of ['Dallas', 'Memphis', 'Denver']) await expect(row).toContainText(city)
    await expect(row).toContainText(/[\d,]+ mi/)
    await expect(row).toContainText(new RegExp(`${first.days} days?`))
    await expect(row).toContainText(/Saved/i)
  })

  test('keeps the trips when the person signs out and back in', async ({ page }) => {
    const user = await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Keeper'))
    await signOutViaUi(page)
    await signInViaUi(page, user)
    await openTripsDrawer(page)
    await expect(tripRow(page, trip.id)).toBeVisible()
  })

  test('shows each person only their own trips', async ({ page, openSession }) => {
    await signedInApp(page, 'owner')
    const trip = await seedTrip(page.request, uniqueTitle('Private'))

    const other = await openSession()
    const stranger = newUser('stranger')
    await registerViaApi(other.page.request, stranger)
    await gotoApp(other.page)
    await expectSignedIn(other.page, stranger)
    await openTripsDrawer(other.page)
    await expect(other.page.getByTestId('trips-empty')).toBeVisible()
    await expect(tripRows(other.page)).toHaveCount(0)
    await expect(other.page.getByText(trip.title)).toHaveCount(0)

    await openTripsDrawer(page)
    await expect(tripRow(page, trip.id)).toContainText(trip.title)
  })
})

test.describe('opening a saved trip', () => {
  test('fills the form, shows the stored result and does not plan again', async ({ page }) => {
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Open'), { cycle_used_hours: 12.5 })
    const plans = countRequests(
      page,
      (r) => pathOf(r.url()) === '/api/plan' && r.method() === 'POST',
    )

    await openTripsDrawer(page)
    const [response] = await Promise.all([
      page.waitForResponse(isTripCall(trip.id, 'GET')),
      page.getByTestId(`btn-open-trip-${trip.id}`).click(),
    ])
    expect(response.status()).toBe(200)

    await expect(page.getByTestId('trips-drawer')).toBeHidden()
    await expect(toastWith(page, /Opened/)).toContainText(trip.title)
    await expect(field(page, 'current')).toHaveValue(/Dallas/)
    await expect(field(page, 'pickup')).toHaveValue(/Memphis/)
    await expect(field(page, 'dropoff')).toHaveValue(/Denver/)
    expect(Number(await page.getByTestId('input-cycle').inputValue())).toBe(12.5)

    await expect(page.getByTestId('stats-strip')).toBeVisible()
    await expectStatsToMatch(page, trip.result)
    expect(await markers(page).count()).toBeGreaterThanOrEqual(3)
    await expect(page.getByTestId('btn-save'), 'a stored trip is already saved').toContainText(
      'Saved',
    )
    expect(plans.count, 'opening a trip should show what was stored').toBe(0)
  })

  test('shows the stored daily logs', async ({ page }) => {
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Logs'))
    await openTripsDrawer(page)
    await page.getByTestId(`btn-open-trip-${trip.id}`).click()
    await expect(page.getByTestId('stats-strip')).toBeVisible()
    await openTab(page, 'logs')
    await expect(visibleSheets(page)).toHaveCount(1)
    await expect(page.locator('[data-testid^="day-chip-"]')).toHaveCount(trip.result.logs.length)
  })

  test('replaces the results already on screen', async ({ page }) => {
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Replace'), {
      current: { label: 'Atlanta, GA', lat: 33.749, lon: -84.388 },
      pickup: { label: 'Nashville, TN', lat: 36.1627, lon: -86.7816 },
      dropoff: { label: 'Chicago, IL', lat: 41.8781, lon: -87.6298 },
    })
    await planExample(page)
    await openTripsDrawer(page)
    await page.getByTestId(`btn-open-trip-${trip.id}`).click()
    await expect(field(page, 'current')).toHaveValue(/Atlanta/)
    await expect(
      page.getByRole('heading', { level: 2, name: /Atlanta to Chicago via Nashville/ }),
    ).toBeVisible()
    await expectStatsToMatch(page, trip.result)
  })
})

test.describe('renaming a trip', () => {
  let tripId: string
  let title: string

  test.beforeEach(async ({ page }) => {
    await signedInApp(page)
    title = uniqueTitle('Before')
    tripId = (await seedTrip(page.request, title)).id
    await openTripsDrawer(page)
    await page.getByTestId(`btn-rename-trip-${tripId}`).click()
  })

  test('opens an input with the current name selected and focused', async ({ page }) => {
    const input = page.getByTestId(`input-rename-trip-${tripId}`)
    await expect(input).toBeFocused()
    await expect(input).toHaveValue(title)
    const selected = await input.evaluate(
      (el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0),
    )
    expect(selected).toBe(title.length)
  })

  test('saves the new name with Enter and keeps it', async ({ page }) => {
    const input = page.getByTestId(`input-rename-trip-${tripId}`)
    const next = uniqueTitle('After')
    await input.fill(next)
    const [response] = await Promise.all([
      page.waitForResponse(isTripCall(tripId, 'PATCH')),
      input.press('Enter'),
    ])
    expect(response.status()).toBe(200)
    expect((await response.json()).title).toBe(next)

    await expect(toastWith(page, 'Trip renamed.')).toBeVisible()
    await expect(input).toHaveCount(0)
    await expect(tripRow(page, tripId)).toContainText(next)

    const stored = await page.request.get(`/api/trips/${tripId}`)
    expect((await stored.json()).title).toBe(next)
  })

  test('saves the new name from the save button', async ({ page }) => {
    const next = uniqueTitle('Button')
    await page.getByTestId(`input-rename-trip-${tripId}`).fill(next)
    await tripRow(page, tripId).getByRole('button', { name: 'Save name' }).click()
    await expect(tripRow(page, tripId)).toContainText(next)
  })

  test('trims spaces around the name', async ({ page }) => {
    const next = uniqueTitle('Trim')
    await page.getByTestId(`input-rename-trip-${tripId}`).fill(`   ${next}   `)
    const [response] = await Promise.all([
      page.waitForResponse(isTripCall(tripId, 'PATCH')),
      page.getByTestId(`input-rename-trip-${tripId}`).press('Enter'),
    ])
    expect((await response.json()).title).toBe(next)
  })

  test('cancels with Escape and leaves the drawer open', async ({ page }) => {
    const input = page.getByTestId(`input-rename-trip-${tripId}`)
    await input.fill('Never saved')
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(page.getByTestId('trips-drawer')).toBeVisible()
    await expect(tripRow(page, tripId)).toContainText(title)
  })

  test('cancels with the cancel button', async ({ page }) => {
    await page.getByTestId(`input-rename-trip-${tripId}`).fill('Never saved')
    await tripRow(page, tripId).getByRole('button', { name: 'Cancel rename' }).click()
    await expect(tripRow(page, tripId)).toContainText(title)
    await expect(tripRow(page, tripId)).not.toContainText('Never saved')
  })

  test('will not save an empty name', async ({ page }) => {
    await page.getByTestId(`input-rename-trip-${tripId}`).fill('   ')
    await expect(tripRow(page, tripId).getByRole('button', { name: 'Save name' })).toBeDisabled()
  })

  test('disables Open while the name is being edited', async ({ page }) => {
    await expect(page.getByTestId(`btn-open-trip-${tripId}`)).toBeDisabled()
  })
})

test.describe('deleting a trip', () => {
  let keep: string
  let drop: string

  test.beforeEach(async ({ page }) => {
    await signedInApp(page)
    keep = (await seedTrip(page.request, uniqueTitle('Keep'))).id
    drop = (await seedTrip(page.request, uniqueTitle('Drop'))).id
    await openTripsDrawer(page)
    await expectTripsLoaded(page)
  })

  test('asks before it deletes anything', async ({ page }) => {
    const deletes = countRequests(page, (r) => r.method() === 'DELETE')
    await page.getByTestId(`btn-delete-trip-${drop}`).click()

    const row = tripRow(page, drop)
    await expect(row.getByRole('alertdialog')).toBeVisible()
    await expect(row).toContainText('Delete this trip?')
    await expect(page.getByTestId('btn-confirm-delete')).toBeVisible()
    await expect(page.getByTestId('btn-cancel-delete')).toBeVisible()
    await expect(page.getByTestId(`btn-open-trip-${drop}`)).toBeHidden()
    expect(deletes.count).toBe(0)
  })

  test('keeps the trip when the person cancels', async ({ page }) => {
    const deletes = countRequests(page, (r) => r.method() === 'DELETE')
    await page.getByTestId(`btn-delete-trip-${drop}`).click()
    await page.getByTestId('btn-cancel-delete').click()

    await expect(tripRow(page, drop).getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByTestId(`btn-open-trip-${drop}`)).toBeVisible()
    await expect(tripRows(page)).toHaveCount(2)
    expect(deletes.count).toBe(0)
    const stored = await page.request.get(`/api/trips/${drop}`)
    expect(stored.status()).toBe(200)
  })

  test('deletes the trip once confirmed and leaves the others alone', async ({ page }) => {
    await page.getByTestId(`btn-delete-trip-${drop}`).click()
    const [response] = await Promise.all([
      page.waitForResponse(isTripCall(drop, 'DELETE')),
      page.getByTestId('btn-confirm-delete').click(),
    ])
    expect(response.status()).toBe(204)

    await expect(toastWith(page, 'Trip deleted.')).toBeVisible()
    await expect(tripRow(page, drop)).toHaveCount(0)
    await expect(tripRow(page, keep)).toBeVisible()
    await expect(tripRows(page)).toHaveCount(1)
    expect((await page.request.get(`/api/trips/${drop}`)).status()).toBe(404)
    expect((await page.request.get(`/api/trips/${keep}`)).status()).toBe(200)
  })

  test('shows the empty state after the last trip goes', async ({ page }) => {
    for (const id of [drop, keep]) {
      await page.getByTestId(`btn-delete-trip-${id}`).click()
      await page.getByTestId('btn-confirm-delete').click()
      await expect(tripRow(page, id)).toHaveCount(0)
    }
    await expect(page.getByTestId('trips-empty')).toBeVisible()
  })

  test('asks about one trip at a time', async ({ page }) => {
    await page.getByTestId(`btn-delete-trip-${drop}`).click()
    await page.getByTestId(`btn-delete-trip-${keep}`).click()
    await expect(tripRow(page, drop).getByRole('alertdialog')).toHaveCount(0)
    await expect(tripRow(page, keep).getByRole('alertdialog')).toBeVisible()
    await expect(page.getByTestId('btn-confirm-delete')).toHaveCount(1)
  })

  test('drops the question when the person starts a rename instead', async ({ page }) => {
    await page.getByTestId(`btn-delete-trip-${drop}`).click()
    await page.getByTestId(`btn-rename-trip-${drop}`).click()
    await expect(tripRow(page, drop).getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByTestId(`input-rename-trip-${drop}`)).toBeVisible()
  })
})
