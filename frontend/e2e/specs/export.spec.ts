import type { Page } from '@playwright/test'
import type { PlanResponse } from '../../src/api/types'
import { countPdfPages, readDownload, startsLikePdf } from '../helpers/pdf'
import { exampleRequest, gotoApp, openTab, openTripAndPlan, planExample } from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { HOSTILE_IMG, toastWith, watchForInjection } from '../helpers/ui'

// The PDF and print buttons are also covered per day in logs.spec.ts. These specs cover what
// the toolbar says and does around them, and trips long enough for page breaks to matter.

async function downloadFrom(page: Page, buttonId: string) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId(buttonId).click(),
  ])
  return { name: download.suggestedFilename(), file: await readDownload(download) }
}

const LONG_TRIP = () =>
  exampleRequest({
    current: { label: 'Seattle, WA', lat: 47.6062, lon: -122.3321 },
    pickup: { label: 'Salt Lake City, UT', lat: 40.7608, lon: -111.891 },
    dropoff: { label: 'Miami, FL', lat: 25.7617, lon: -80.1918 },
    cycle_used_hours: 30,
  })

test.describe('download PDF', () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
  })

  test('names the file after the departure date', async ({ page }) => {
    const { name } = await downloadFrom(page, 'btn-pdf')
    expect(name).toBe(`eld-logs-${plan.request.departure.slice(0, 10)}.pdf`)
  })

  test('says how many sheets it saved', async ({ page }) => {
    await downloadFrom(page, 'btn-pdf')
    const expected = new RegExp(`Downloaded ${plan.logs.length} log sheets? as a PDF`)
    await expect(toastWith(page, expected)).toBeVisible()
  })

  test('works without an account and leaves the page where it was', async ({ page }) => {
    await expect(page.getByTestId('btn-sign-in')).toBeVisible()
    const { file } = await downloadFrom(page, 'btn-pdf')
    expect(startsLikePdf(file)).toBe(true)
    await expect(page.getByTestId('btn-pdf')).toBeEnabled()
    await expect(page.getByTestId('panel-itinerary')).toBeVisible()
  })

  test('can be downloaded twice in a row', async ({ page }) => {
    const first = await downloadFrom(page, 'btn-pdf')
    await expect(page.getByTestId('btn-pdf')).toBeEnabled()
    const second = await downloadFrom(page, 'btn-pdf')
    expect(countPdfPages(second.file)).toBe(countPdfPages(first.file))
  })

  test('is a real document with a size worth keeping', async ({ page }) => {
    const { file } = await downloadFrom(page, 'btn-pdf')
    expect(file.length).toBeGreaterThan(5_000)
    expect(file.subarray(-1024).toString('latin1')).toContain('%%EOF')
  })
})

test.describe('a trip that runs for days', () => {
  test('puts each day on its own PDF page', async ({ page }) => {
    const plan = await openTripAndPlan(page, LONG_TRIP())
    expect(plan.logs.length).toBeGreaterThanOrEqual(5)
    const { file } = await downloadFrom(page, 'btn-pdf')
    expect(startsLikePdf(file)).toBe(true)
    expect(countPdfPages(file)).toBe(plan.logs.length)
  })

  test('puts each day on its own printed page', async ({ page }) => {
    const plan = await openTripAndPlan(page, LONG_TRIP())
    await page.emulateMedia({ media: 'print' })
    const pdf = await page.pdf({ format: 'Letter', printBackground: true })
    expect(countPdfPages(pdf)).toBe(plan.logs.length)
  })

  test('prints from either tab', async ({ page }) => {
    await openTripAndPlan(page, LONG_TRIP())
    await page.evaluate(() => {
      const w = window as unknown as { __prints: number }
      w.__prints = 0
      window.print = () => {
        w.__prints += 1
      }
    })
    const prints = () => page.evaluate(() => (window as unknown as { __prints: number }).__prints)

    await page.getByTestId('btn-print').click()
    await expect.poll(prints).toBe(1)
    await openTab(page, 'logs')
    await page.getByTestId('btn-print-logs').click()
    await expect.poll(prints).toBe(2)
  })
})

test.describe('a sheet with hostile text in its header', () => {
  test('still downloads and never runs the text', async ({ page }) => {
    const injection = watchForInjection(page)
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-log-details').click()
    await page.getByTestId('input-carrier-name').fill(`${HOSTILE_IMG} Freight`)
    await page.getByTestId('input-shipper').fill('Smith & Sons (50%) <b>bold</b> \\ / \' "')
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('stats-strip')).toBeVisible()

    const { file } = await downloadFrom(page, 'btn-pdf')
    expect(startsLikePdf(file)).toBe(true)
    await injection.expectClean()
  })
})
