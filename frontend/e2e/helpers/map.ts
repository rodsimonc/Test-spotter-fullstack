import { expect, type Page } from '@playwright/test'

/** Clicks a point on the map, given as fractions of its width and height. */
export async function clickMap(page: Page, x = 0.5, y = 0.55): Promise<void> {
  const map = page.getByTestId('map')
  const box = await map.boundingBox()
  expect(box, 'the map should be on screen').not.toBeNull()
  await map.click({ position: { x: box!.width * x, y: box!.height * y } })
}

/** Leaflet's own popup element. Its content comes from the app, its class from Leaflet. */
export const popup = (page: Page) => page.locator('.leaflet-popup')

/**
 * The popup once exactly one is left. Leaflet fades a closed popup out over 200 ms, so for that
 * moment the old one and the new one are both in the page.
 */
export async function onlyPopup(page: Page) {
  const open = popup(page)
  await expect(open).toHaveCount(1)
  return open
}
