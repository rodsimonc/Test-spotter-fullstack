import { onlyPopup, popup } from '../helpers/map'
import { gotoApp, idFrom, markers, planExample, stopCards } from '../helpers/plan'
import { expect, test } from '../helpers/test'
import type { PlanResponse } from '../../src/api/types'

test.describe('map before planning', () => {
  test('shows a pin for each place picked, before any plan', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await expect(page.locator('.leaflet-marker-icon')).toHaveCount(3)
    await expect(page.getByTestId('stats-strip')).toHaveCount(0)
  })

  test('credits OpenStreetMap', async ({ page }) => {
    await gotoApp(page)
    await expect(page.locator('.leaflet-control-attribution')).toContainText(/OpenStreetMap/i)
  })
})

test.describe('map after planning', () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
  })

  test('puts a marker on every stop', async ({ page }) => {
    expect(await markers(page).count()).toBeGreaterThanOrEqual(3)
    // The end of the trip shares the dropoff's marker, so it has none of its own.
    for (const stop of plan.stops.filter((s) => s.kind !== 'end')) {
      await expect(page.getByTestId(`marker-${stop.id}`)).toBeAttached()
    }
  })

  test('draws the route and a legend', async ({ page }) => {
    await expect(page.getByTestId('map-legend')).toBeVisible()
    // Two legs, each with a white casing underneath.
    expect.soft(await page.locator('.leaflet-overlay-pane path').count()).toBeGreaterThanOrEqual(4)
  })

  test('pans to a stop and opens its popup when its card is clicked', async ({ page }) => {
    const pickup = plan.stops.find((s) => s.kind === 'pickup')!
    await page.getByTestId(`stop-card-${pickup.id}`).click()

    const open = popup(page)
    await expect(open).toBeVisible()
    await expect(open).toContainText(pickup.title)
    await expect(open).toContainText(pickup.place)

    const mapBox = (await page.getByTestId('map').boundingBox())!
    const popupBox = (await open.boundingBox())!
    expect(popupBox.x).toBeGreaterThanOrEqual(mapBox.x - 1)
    expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width + 1)
    expect(popupBox.y).toBeGreaterThanOrEqual(mapBox.y - 1)
  })

  test('opens a popup for every kind of stop in the plan', async ({ page }) => {
    // The end of the trip shares the dropoff's marker, so its card opens the dropoff popup.
    const firstOfEachKind = [...new Map(plan.stops.filter((s) => s.kind !== 'end').map((s) => [s.kind, s])).values()]
    expect(firstOfEachKind.length).toBeGreaterThanOrEqual(4)
    for (const stop of firstOfEachKind) {
      await page.getByTestId(`stop-card-${stop.id}`).click()
      await expect(await onlyPopup(page)).toContainText(stop.title)
    }
  })

  test('opens the popup when the marker itself is clicked', async ({ page }) => {
    // Markers that sit close together overlap on the map, so a mouse click can land on the one on top.
    // Send the click to this marker's own element instead.
    const pickup = plan.stops.find((s) => s.kind === 'pickup')!
    await page.getByTestId(`marker-${pickup.id}`).dispatchEvent('click')
    await expect(await onlyPopup(page)).toContainText(pickup.title)
  })

  test('shows the time and length of a stop in its popup', async ({ page }) => {
    const fuel = plan.stops.find((s) => s.kind === 'fuel')!
    await page.getByTestId(`stop-card-${fuel.id}`).click()
    const text = await popup(page).innerText()
    expect(text).toMatch(/\d{1,2}:\d{2}/)
    expect(text).toMatch(/30\s*(min|m)|0:30|0\.5\s*h/i)
  })

  test('lists the cards in the same order as the stops', async ({ page }) => {
    const cardIds = await Promise.all(
      (await stopCards(page).all()).map((card) => idFrom(card, 'stop-card-')),
    )
    expect(cardIds).toEqual(plan.stops.map((s) => s.id))
  })
})
