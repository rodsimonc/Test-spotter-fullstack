import type { Route } from '@playwright/test'
import { signedInApp } from '../helpers/auth'
import { clickMap } from '../helpers/map'
import {
  exampleRequest,
  field,
  gotoApp,
  planExample,
  tripUrl,
  waitForPlanCall,
} from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { expectTripsLoaded, openTripsDrawer, seedTrip, tripRow } from '../helpers/trips'
import { toastWith, uniqueTitle } from '../helpers/ui'

// Planning errors (422, 502, 429, 500, retry) are in planning.spec.ts and field errors are in
// trip-form.spec.ts. These cover the other places the app can fail: the network, saving, the
// trips drawer and the map.

const json = (status: number, code: string, message: string) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify({ error: { code, message } }),
})

/** Fails the first `times` calls with the given answer, then lets the rest through. */
function failFirst(times: number, answer: ReturnType<typeof json>) {
  let calls = 0
  return (route: Route) => {
    calls += 1
    return calls <= times ? route.fulfill(answer) : route.continue()
  }
}

/** The trips list and the save call share a path. Only the method tells them apart. */
const tripsCollection = (url: URL) => url.pathname === '/api/trips'

/** Runs `handler` for calls that use `method` and passes every other call through. */
function onlyFor(method: string, handler: (route: Route) => Promise<void>) {
  return (route: Route) => (route.request().method() === method ? handler(route) : route.continue())
}

test.describe('when the network is down', () => {
  test('shows a banner that says the server cannot be reached, and Retry works', async ({
    page,
  }) => {
    let down = true
    await page.route('**/api/plan', (route) =>
      down ? route.abort('connectionrefused') : route.continue(),
    )
    await page.goto(tripUrl(exampleRequest()))
    await expect(page.getByTestId('error-banner')).toContainText(/reach the server/i)

    down = false
    const [response] = await Promise.all([
      waitForPlanCall(page),
      page.getByTestId('btn-retry').click(),
    ])
    expect(response.status()).toBe(200)
    await expect(page.getByTestId('stats-strip')).toBeVisible()
    await expect(page.getByTestId('error-banner')).toBeHidden()
  })

  test('still shows the form so the person can change it', async ({ page }) => {
    await page.route('**/api/plan', (route) => route.abort('connectionrefused'))
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('error-banner')).toBeVisible()
    await expect(page.getByTestId('btn-plan')).toBeEnabled()
    await expect(field(page, 'pickup')).toHaveValue(/Memphis/)
  })

  test('shows a server error without a stack trace or markup', async ({ page }) => {
    await page.route('**/api/plan', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'text/html',
        body: '<h1>Traceback (most recent call last)</h1>',
      }),
    )
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    const banner = page.getByTestId('error-banner')
    await expect(banner).toBeVisible()
    await expect(banner).not.toContainText('Traceback')
    await expect(banner).toContainText(/try again/i)
  })
})

test.describe('when saving fails', () => {
  test.beforeEach(async ({ page }) => {
    await signedInApp(page)
    await planExample(page)
  })

  test('tells the person and lets them try again', async ({ page }) => {
    const failOnce = failFirst(1, json(500, 'server_error', 'Something went wrong on our side.'))
    await page.route(
      tripsCollection,
      onlyFor('POST', async (route) => failOnce(route)),
    )
    await page.getByTestId('btn-save').click()
    await expect(toastWith(page, 'Something went wrong on our side.')).toBeVisible()
    await expect(page.getByTestId('btn-save')).toBeEnabled()
    await expect(page.getByTestId('btn-save')).toContainText('Save trip')

    await page.getByTestId('btn-save').click()
    await expect(toastWith(page, /Trip saved/i)).toBeVisible()
    await expect(page.getByTestId('btn-save')).toContainText('Saved')
  })

  test('says so when the session has ended', async ({ page }) => {
    await page.route(
      tripsCollection,
      onlyFor('POST', (route) =>
        route.fulfill(json(401, 'not_authenticated', 'Sign in to save trips.')),
      ),
    )
    await page.getByTestId('btn-save').click()
    await expect(toastWith(page, 'Sign in to save trips.')).toBeVisible()
    await expect(page.getByTestId('btn-save')).toContainText('Save trip')
  })

  test('shows the message the server gives when it refuses a save', async ({ page }) => {
    await page.route(
      tripsCollection,
      onlyFor('POST', (route) =>
        route.fulfill(
          json(
            400,
            'validation_error',
            'You can keep up to 100 trips. Delete one to save another.',
          ),
        ),
      ),
    )
    await page.getByTestId('btn-save').click()
    await expect(toastWith(page, /up to 100 trips/)).toBeVisible()
  })

  test('shows a saving state while the server works', async ({ page }) => {
    await page.route(
      tripsCollection,
      onlyFor('POST', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1200))
        await route.continue()
      }),
    )
    await page.getByTestId('btn-save').click()
    await expect(page.getByTestId('btn-save')).toBeDisabled()
    await expect(page.getByTestId('btn-save')).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByTestId('btn-save')).toContainText('Saved')
  })
})

test.describe('the trips drawer', () => {
  test('shows a loading state, then the trips', async ({ page }) => {
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Slow'))
    await page.route(
      tripsCollection,
      onlyFor('GET', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1200))
        await route.continue()
      }),
    )
    await openTripsDrawer(page)
    await expect(page.getByRole('status', { name: 'Loading your trips' })).toBeVisible()
    await expect(page.getByTestId('trips-empty')).toHaveCount(0)
    await expect(tripRow(page, trip.id)).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading your trips' })).toHaveCount(0)
  })

  test('shows an error with Retry when the list cannot be loaded', async ({ page }) => {
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Retry'))
    const failOnce = failFirst(1, json(500, 'server_error', 'Something went wrong on our side.'))
    await page.route(
      tripsCollection,
      onlyFor('GET', async (route) => failOnce(route)),
    )

    const drawer = await openTripsDrawer(page)
    await expect(drawer.getByRole('alert')).toContainText("We couldn't load your trips")
    await expect(drawer).toContainText('Something went wrong on our side.')
    await expect(page.getByTestId('trips-empty')).toHaveCount(0)

    await page.getByTestId('btn-retry-trips').click()
    await expect(tripRow(page, trip.id)).toBeVisible()
    await expect(drawer.getByRole('alert')).toHaveCount(0)
  })

  test('keeps the drawer open and says why when a trip cannot be opened', async ({ page }) => {
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Gone'))
    await page.route(`**/api/trips/${trip.id}`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill(json(404, 'not_found', 'That trip no longer exists.'))
        : route.continue(),
    )
    await openTripsDrawer(page)
    await page.getByTestId(`btn-open-trip-${trip.id}`).click()
    await expect(toastWith(page, 'That trip no longer exists.')).toBeVisible()
    await expect(page.getByTestId('trips-drawer')).toBeVisible()
    await expect(page.getByTestId(`btn-open-trip-${trip.id}`)).toBeEnabled()
  })

  test('keeps the old name when a rename fails', async ({ page }) => {
    await signedInApp(page)
    const title = uniqueTitle('Stays')
    const trip = await seedTrip(page.request, title)
    await page.route(`**/api/trips/${trip.id}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill(json(500, 'server_error', "Couldn't rename that trip."))
        : route.continue(),
    )
    await openTripsDrawer(page)
    await page.getByTestId(`btn-rename-trip-${trip.id}`).click()
    const input = page.getByTestId(`input-rename-trip-${trip.id}`)
    await input.fill('Will not stick')
    await input.press('Enter')
    await expect(toastWith(page, "Couldn't rename that trip.")).toBeVisible()
    await expect(input, 'the edit box stays so the person can try again').toBeVisible()
    await page.getByRole('button', { name: 'Cancel rename' }).click()
    await expect(tripRow(page, trip.id)).toContainText(title)
  })

  test('keeps the trip when a delete fails', async ({ page }) => {
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Survivor'))
    await page.route(`**/api/trips/${trip.id}`, (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill(json(500, 'server_error', "Couldn't delete that trip."))
        : route.continue(),
    )
    await openTripsDrawer(page)
    await expectTripsLoaded(page)
    await page.getByTestId(`btn-delete-trip-${trip.id}`).click()
    await page.getByTestId('btn-confirm-delete').click()
    await expect(toastWith(page, "Couldn't delete that trip.")).toBeVisible()
    await expect(tripRow(page, trip.id)).toBeVisible()
    expect((await page.request.get(`/api/trips/${trip.id}`)).status()).toBe(200)
  })
})

test.describe('picking a place on the map', () => {
  test('keeps picking when the spot cannot be named', async ({ page }) => {
    await page.route('**/api/geocode/reverse*', (route) =>
      route.fulfill(json(502, 'upstream_error', 'The place lookup did not answer.')),
    )
    await gotoApp(page)
    await page.getByTestId('btn-pick-current').click()
    await clickMap(page)
    await expect(toastWith(page, /name that spot/i)).toBeVisible()
    await expect(page.getByTestId('pick-banner')).toBeVisible()
    await expect(field(page, 'current')).toHaveValue('')
  })
})

test.describe('searching for a place', () => {
  test('shows no list and no crash when the search is throttled', async ({ page }) => {
    await page.route('**/api/geocode/search*', (route) =>
      route.fulfill({
        ...json(429, 'throttled', 'Too many requests. Try again in a minute.'),
        headers: { 'Retry-After': '30' },
      }),
    )
    await gotoApp(page)
    const input = field(page, 'current')
    await input.click()
    const answered = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/geocode/search',
    )
    await input.pressSequentially('Denver', { delay: 15 })
    expect((await answered).status()).toBe(429)
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(input).toBeEditable()
    await expect(input).toHaveValue('Denver')
  })
})
