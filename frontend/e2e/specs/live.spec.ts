import { liveEnabled } from '../helpers/env'
import { checkPlan } from '../helpers/hos-check'
import { clickMap } from '../helpers/map'
import {
  choosePlace,
  exampleRequest,
  expectStatsToMatch,
  field,
  gotoApp,
  openTrip,
  openTripAndPlan,
} from '../helpers/plan'
import { expect, test } from '../helpers/test'

// These talk to the real OSRM, Photon and Nominatim servers, directly or through a deployed
// site. Real services change their answers, so the checks use ranges and rules, never exact numbers.
// They run in the `live` project, and only with E2E_LIVE=1 or E2E_BASE_URL set.

test.describe('real services', { tag: '@live' }, () => {
  test.skip(!liveEnabled, 'Set E2E_LIVE=1, or E2E_BASE_URL to a deployed site, to run these.')

  test('finds Denver in the real place search', async ({ page }) => {
    await gotoApp(page)
    const label = await choosePlace(page, 'dropoff', 'Denver, Colorado', /Denver/)
    expect(label).toMatch(/Denver/)
    await expect(field(page, 'dropoff')).toHaveValue(label)
  })

  test('plans a real route that follows the rules and is the right size', async ({ page }) => {
    const plan = await openTripAndPlan(page, exampleRequest())

    expect(checkPlan(plan)).toEqual([])
    const [toPickup, toDropoff] = plan.summary.legs
    // Dallas to Memphis is about 450 miles by road, Memphis to Denver about 1,040.
    expect(toPickup.distance_miles).toBeGreaterThan(400)
    expect(toPickup.distance_miles).toBeLessThan(520)
    expect(toDropoff.distance_miles).toBeGreaterThan(950)
    expect(toDropoff.distance_miles).toBeLessThan(1150)
    expect(plan.route.geometry.length).toBeGreaterThan(100)
    await expectStatsToMatch(page, plan)
  })

  test('names the places on the log sheets with a town and state', async ({ page }) => {
    const plan = await openTripAndPlan(page, exampleRequest())
    const places = plan.logs.flatMap((log) => log.remarks.map((remark) => remark.place))
    expect(places.length).toBeGreaterThan(5)
    for (const place of places) expect(place, 'a remark should name a place').toMatch(/\S/)
    const named = places.filter((place) => /, [A-Z]{2}$/.test(place))
    expect(named.length / places.length, 'most remarks end in a state code').toBeGreaterThan(0.8)
  })

  test('names a spot picked on the real map', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-pick-current').click()
    const lookup = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/geocode/reverse')
    await clickMap(page)
    expect((await lookup).status()).toBe(200)
    await expect(field(page, 'current')).not.toHaveValue('')
  })

  test('says so when no road joins the places', async ({ page }) => {
    // Honolulu is an island. No driving route leads there from Dallas.
    const response = await openTrip(
      page,
      exampleRequest({ dropoff: { label: 'Honolulu, HI', lat: 21.3069, lon: -157.8583 } }),
    )
    expect([422, 502]).toContain(response.status())
    await expect(page.getByTestId('error-banner')).toBeVisible()
    await expect(page.getByTestId('stats-strip')).toHaveCount(0)
  })
})
