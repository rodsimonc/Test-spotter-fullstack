import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import type { PlanRequest, Trip } from '../../src/api/types'
import { saveTripViaApi } from './api'
import { openAccountMenu } from './auth'
import { exampleRequest, idFrom } from './plan'

/** Saves a trip through the API as whoever the request context is signed in as. */
export function seedTrip(
  request: APIRequestContext,
  title: string,
  overrides: Partial<PlanRequest> = {},
): Promise<Trip> {
  return saveTripViaApi(request, exampleRequest(overrides), title)
}

export const tripRows = (page: Page): Locator => page.locator('[data-testid^="trip-row-"]')

export const tripRow = (page: Page, id: string): Locator => page.getByTestId(`trip-row-${id}`)

export const tripIdOf = (row: Locator): Promise<string> => idFrom(row, 'trip-row-')

/** Opens My trips from the account menu and waits for the drawer. */
export async function openTripsDrawer(page: Page): Promise<Locator> {
  await openAccountMenu(page)
  await page.getByTestId('btn-my-trips').click()
  const drawer = page.getByTestId('trips-drawer')
  await expect(drawer).toBeVisible()
  return drawer
}

/** Waits until the drawer has settled on either rows or the empty state. */
export async function expectTripsLoaded(page: Page): Promise<void> {
  await expect(
    page.locator('[data-testid^="trip-row-"], [data-testid="trips-empty"]').first(),
  ).toBeVisible()
}
