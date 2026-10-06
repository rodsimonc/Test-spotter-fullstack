import { numbersIn } from '../helpers/parse'
import { gotoApp, openTab, planExample } from '../helpers/plan'
import { expect, test } from '../helpers/test'
import type { PlanResponse } from '../../src/api/types'

test.describe('results tabs', () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
  })

  test('switches between itinerary, directions, daily logs and summary', async ({ page }) => {
    const tabs = ['itinerary', 'directions', 'logs', 'summary'] as const
    for (const shown of tabs) {
      await openTab(page, shown)
      for (const other of tabs.filter((t) => t !== shown)) {
        await expect(page.getByTestId(`panel-${other}`)).toBeHidden()
      }
    }
    await openTab(page, 'itinerary')
  })

  test('marks the open tab for assistive technology', async ({ page }) => {
    await expect(page.getByTestId('tab-itinerary')).toHaveAttribute('aria-selected', 'true')
    await page.getByTestId('tab-logs').click()
    await expect(page.getByTestId('tab-logs')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('tab-itinerary')).toHaveAttribute('aria-selected', 'false')
  })

  test('keeps the same results when the tab changes and changes back', async ({ page }) => {
    const before = await page.getByTestId('panel-itinerary').innerText()
    await openTab(page, 'summary')
    await openTab(page, 'itinerary')
    expect(await page.getByTestId('panel-itinerary').innerText()).toBe(before)
  })

  test('summary shows the cycle meter with the start and end hours', async ({ page }) => {
    await openTab(page, 'summary')
    const meter = page.getByTestId('cycle-meter')
    await expect(meter).toBeVisible()
    const shown = numbersIn(await meter.innerText())
    expect(shown.some((n) => Math.abs(n - plan.summary.cycle_used_start_hours) < 0.05)).toBe(true)
    expect(shown.some((n) => Math.abs(n - plan.summary.cycle_used_end_hours) < 0.1)).toBe(true)
    expect(shown).toContain(70)
  })

  test('summary breaks the trip into its two legs', async ({ page }) => {
    await openTab(page, 'summary')
    const rows = page.getByTestId('panel-summary').getByRole('row')
    // A header row, one row per leg, and a total row.
    await expect(rows).toHaveCount(plan.summary.legs.length + 2)
    for (const [index, leg] of plan.summary.legs.entries()) {
      const numbers = numbersIn(await rows.nth(index + 1).innerText())
      expect(
        numbers.some((n) => Math.abs(n - leg.distance_miles) <= 1),
        `leg ${index + 1} should show about ${leg.distance_miles} miles, got ${numbers.join(', ')}`,
      ).toBe(true)
    }
  })

  test('summary lists every assumption, including the time zone used', async ({ page }) => {
    await openTab(page, 'summary')
    const assumptions = page.getByTestId('assumptions')
    await expect(assumptions).toBeVisible()
    for (const line of plan.assumptions) await expect(assumptions).toContainText(line)
    expect(plan.assumptions.join(' ')).toContain('America/Chicago')
  })

  test('shows the stats strip on every tab', async ({ page }) => {
    for (const tab of ['directions', 'logs', 'summary', 'itinerary'] as const) {
      await openTab(page, tab)
      await expect(page.getByTestId('stats-strip')).toBeVisible()
    }
  })
})
