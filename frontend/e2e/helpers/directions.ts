import { expect, type Locator, type Page } from '@playwright/test'
import type { DirectionStep } from '../../src/api/types'
import { numbersIn } from './parse'

// Helpers for the Directions tab. Test ids: tab-directions, panel-directions,
// direction-leg-<leg>, direction-step-<leg>-<step> and directions-empty.

export const RESULT_TABS = ['itinerary', 'directions', 'logs', 'summary'] as const
export type ResultTab = (typeof RESULT_TABS)[number]

export const directionLegs = (page: Page) => page.getByTestId(/^direction-leg-\d+$/)

/** Every line of one leg, or of both when no leg is given. */
export const directionSteps = (page: Page, leg?: number) =>
  page.getByTestId(
    leg === undefined ? /^direction-step-\d+-\d+$/ : new RegExp(`^direction-step-${leg}-\\d+$`),
  )

export const directionStep = (page: Page, leg: number, step: number) =>
  page.getByTestId(`direction-step-${leg}-${step}`)

/**
 * The control to focus or press on a line. The line is a button, so this is usually the line
 * itself. If the test id sits on a wrapper, it is the button inside.
 */
export async function stepButton(line: Locator): Promise<Locator> {
  const isButton = await line.evaluate((el) => el.matches('button, [role="button"]'))
  return isButton ? line : line.getByRole('button')
}

/** The number after "mile" in a line, such as 340 from "mile 340" or 1053 from "mile 1,053". */
export function mileShown(text: string): number | null {
  const match = /\bmile\s+(\d[\d,]*(?:\.\d+)?)/i.exec(text)
  return match ? numbersIn(match[1])[0] : null
}

/** True when some number in the text sits within `tolerance` of the value. */
export const showsNumber = (text: string, value: number, tolerance = 0.5) =>
  numbersIn(text).some((n) => Math.abs(n - value) <= tolerance)

/** The first road line of a leg after its first two lines, so a click has somewhere to go. */
export const midRoadIndex = (steps: DirectionStep[]) =>
  steps.findIndex((step, i) => i >= 2 && step.kind === 'road')

export interface MapView {
  zoom: number
  lat: number
  lon: number
}

/**
 * Where the map is looking, read from the tiles on screen. Leaflet puts no handle on `window`,
 * but every tile has its zoom, column and row in its URL and its position on the page. The tile
 * under the middle of the map gives the middle's longitude and latitude. Null while no tile has
 * been drawn there yet, so poll it.
 */
export async function mapView(page: Page): Promise<MapView | null> {
  return page.evaluate(() => {
    const container = document.querySelector('[data-testid="map"]')
    if (!container) return null
    const box = container.getBoundingClientRect()
    const [cx, cy] = [box.left + box.width / 2, box.top + box.height / 2]
    const tiles: { img: HTMLImageElement; z: number; x: number; y: number }[] = []
    for (const img of container.querySelectorAll<HTMLImageElement>('img.leaflet-tile')) {
      const match = /\/(\d+)\/(\d+)\/(\d+)\.png/.exec(img.src)
      if (match) tiles.push({ img, z: Number(match[1]), x: Number(match[2]), y: Number(match[3]) })
    }
    if (!tiles.length) return null
    // During a zoom the old level hangs around for a moment. The newest level has the highest zoom.
    const zoom = Math.max(...tiles.map((t) => t.z))
    for (const { img, z, x, y } of tiles) {
      if (z !== zoom) continue
      const r = img.getBoundingClientRect()
      if (cx < r.left || cx >= r.right || cy < r.top || cy >= r.bottom) continue
      const world = 256 * 2 ** zoom
      const px = x * 256 + ((cx - r.left) * 256) / r.width
      const py = y * 256 + ((cy - r.top) * 256) / r.height
      return {
        zoom,
        lon: (px / world) * 360 - 180,
        lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / world))) * 180) / Math.PI,
      }
    }
    return null
  })
}

/** Waits until the map is zoomed to at least `minZoom` and centred within `degrees` of the spot. */
export async function expectMapAt(
  page: Page,
  spot: { lat: number; lon: number },
  { minZoom = 10, degrees = 0.05 } = {},
): Promise<void> {
  await expect
    .poll(
      async () => {
        const view = await mapView(page)
        if (!view) return 'no tile under the middle of the map yet'
        const off = Math.max(Math.abs(view.lat - spot.lat), Math.abs(view.lon - spot.lon))
        if (view.zoom < minZoom) return `zoom ${view.zoom}, wanted ${minZoom} or more`
        if (off > degrees) return `centre ${view.lat.toFixed(3)}, ${view.lon.toFixed(3)}`
        return 'at the spot'
      },
      { message: `the map should centre on ${spot.lat}, ${spot.lon} at zoom ${minZoom} or more` },
    )
    .toBe('at the spot')
}
