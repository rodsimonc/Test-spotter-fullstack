import type { Page } from '@playwright/test'
import type { DailyLog, PlanResponse } from '../../src/api/types'
import { numbersIn } from '../helpers/parse'
import { countPdfPages, readDownload, startsLikePdf } from '../helpers/pdf'
import {
  clickPlan,
  dayChips,
  exampleRequest,
  gotoApp,
  openTab,
  openTripAndPlan,
  planExample,
  visibleSheets,
} from '../helpers/plan'
import { expect, test } from '../helpers/test'

const pad = (n: number) => String(n).padStart(2, '0')

/** 360 becomes "06:00 AM", the form used in the remarks list on the sheet. */
function clock12(minute: number): string {
  const hours = Math.floor(minute / 60) % 24
  return `${pad(hours % 12 === 0 ? 12 : hours % 12)}:${pad(minute % 60)} ${hours < 12 ? 'AM' : 'PM'}`
}

// Read each <text> on its own. textContent glues neighbors together ("6", "6", "11" becomes "6611").
const sheetText = async (page: Page) =>
  (await visibleSheets(page).first().locator('text').allTextContents()).join(' ').replace(/\s+/g, ' ')

// The sheet rounds the four row totals together so they add up to exactly 24, which moves a value by 0.01 at most.
const hasHours = (shown: number[], minutes: number) =>
  shown.some((n) => Math.abs(n - minutes / 60) <= 0.011)

async function downloadPdf(page: Page, buttonId: string) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    page.getByTestId(buttonId).click(),
  ])
  return { name: download.suggestedFilename(), file: await readDownload(download) }
}

async function stubPrint(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __prints: number }
    w.__prints = 0
    window.print = () => {
      w.__prints += 1
    }
  })
}

const printCalls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __prints?: number }).__prints ?? 0)

test.describe('daily log viewer', () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
    await openTab(page, 'logs')
  })

  test('shows the first sheet with one chip per day', async ({ page }) => {
    await expect(page.getByTestId('log-viewer')).toBeVisible()
    await expect(visibleSheets(page)).toHaveCount(1)
    await expect(page.getByTestId('log-sheet-1').filter({ visible: true })).toBeVisible()
    await expect(dayChips(page)).toHaveCount(plan.logs.length)
    expect(plan.logs.length).toBeGreaterThanOrEqual(3)
  })

  test('gives each sheet a readable name for screen readers', async ({ page }) => {
    const image = page.getByTestId('log-viewer').locator('svg[role="img"]:visible').first()
    await expect(image).toHaveAccessibleName(/\S/)
  })

  test('steps through the days with next and previous', async ({ page }) => {
    const prev = page.getByTestId('btn-prev-day')
    const next = page.getByTestId('btn-next-day')
    await expect(prev).toBeDisabled()
    for (let day = 2; day <= plan.logs.length; day++) {
      await next.click()
      await expect(page.locator(`[data-testid="log-sheet-${day}"]:visible`)).toBeVisible()
      await expect(visibleSheets(page)).toHaveCount(1)
    }
    await expect(next).toBeDisabled()
    await prev.click()
    await expect(
      page.locator(`[data-testid="log-sheet-${plan.logs.length - 1}"]:visible`),
    ).toBeVisible()
  })

  test('jumps to a day from its chip', async ({ page }) => {
    const last = plan.logs.length
    await page.getByTestId(`day-chip-${last}`).click()
    await expect(page.locator(`[data-testid="log-sheet-${last}"]:visible`)).toBeVisible()
    await page.getByTestId('day-chip-1').click()
    await expect(page.locator('[data-testid="log-sheet-1"]:visible')).toBeVisible()
  })

  test('works from the keyboard', async ({ page }) => {
    await page.getByTestId('btn-next-day').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="log-sheet-2"]:visible')).toBeVisible()
    await page.getByTestId('day-chip-3').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="log-sheet-3"]:visible')).toBeVisible()
  })

  test('prints every number on every sheet the way the API computed it', async ({ page }) => {
    for (const log of plan.logs) {
      await page.getByTestId(`day-chip-${log.day}`).click()
      await expect(page.locator(`[data-testid="log-sheet-${log.day}"]:visible`)).toBeVisible()
      const text = await sheetText(page)
      const shown = numbersIn(text)
      const where = `day ${log.day}`

      expect(text, where).toMatch(/Drivers Daily Log/i)
      const [year, month, day] = log.date.split('-').map(Number)
      for (const part of [year, month, day]) expect(shown, `${where} date`).toContain(part)

      expect(shown, `${where} miles driving`).toContain(Math.round(log.total_miles_driving))
      for (const status of ['off_duty', 'sleeper', 'driving', 'on_duty'] as const) {
        expect(hasHours(shown, log.totals[status]), `${where} ${status} hours`).toBe(true)
      }
      expect(shown, `${where} grand total`).toContain(24)

      const { recap } = log
      for (const [label, minutes] of [
        ['on duty today', recap.on_duty_today_minutes],
        ['A', recap.a_minutes],
        ['B', recap.b_minutes],
        ['C', recap.c_minutes],
      ] as const) {
        expect(hasHours(shown, minutes), `${where} recap ${label}`).toBe(true)
      }
    }
  })

  test('lists each remark with its time, place and note', async ({ page }) => {
    for (const log of plan.logs) {
      await page.getByTestId(`day-chip-${log.day}`).click()
      const text = await sheetText(page)
      for (const remark of log.remarks) {
        const where = `day ${log.day}, ${clock12(remark.minute)}`
        expect(text, where).toContain(clock12(remark.minute))
        expect(text, where).toContain(remark.place)
        expect(text, where).toContain(remark.note)
      }
    }
  })

  test('fills From and To from the first and last place of the day', async ({ page }) => {
    for (const log of plan.logs) {
      await page.getByTestId(`day-chip-${log.day}`).click()
      const text = await sheetText(page)
      expect(text).toContain(log.from_place)
      expect(text).toContain(log.to_place)
    }
  })

  test('scales the sheet to the width of its container', async ({ page }) => {
    const viewerBox = (await page.getByTestId('log-viewer').boundingBox())!
    const sheetBox = (await visibleSheets(page).first().boundingBox())!
    expect(sheetBox.width).toBeLessThanOrEqual(viewerBox.width + 1)
    // The form is 850 by 1100 units.
    expect(sheetBox.height / sheetBox.width).toBeCloseTo(1100 / 850, 1)
  })
})

test.describe('log header details', () => {
  test('appear on the sheet', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-log-details').click()
    const details = {
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
    for (const [id, value] of Object.entries(details)) await page.getByTestId(id).fill(value)
    await clickPlan(page)
    await openTab(page, 'logs')

    const text = await sheetText(page)
    for (const value of Object.values(details)) expect(text).toContain(value)
  })

  test('cannot inject markup into the sheet', async ({ page }) => {
    const dialogs: string[] = []
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message())
      void dialog.dismiss()
    })
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-log-details').click()
    const html = '<img src=x onerror="window.__xss=1"><script>window.__xss=1</script>'
    await page.getByTestId('input-carrier-name').fill(html)
    await page.getByTestId('input-driver-name').fill(html)
    await clickPlan(page)
    await openTab(page, 'logs')

    await expect(visibleSheets(page).first()).toContainText('<img src=x')
    await expect(page.locator('img[src="x"]')).toHaveCount(0)
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined()
    expect(dialogs).toEqual([])
  })
})

test.describe('34-hour restart on the sheet', () => {
  test('notes the restart on the day it finishes', async ({ page }) => {
    const plan = await openTripAndPlan(
      page,
      exampleRequest({
        current: { label: 'Seattle, WA', lat: 47.6062, lon: -122.3321 },
        pickup: { label: 'Salt Lake City, UT', lat: 40.7608, lon: -111.891 },
        dropoff: { label: 'Miami, FL', lat: 25.7617, lon: -80.1918 },
        cycle_used_hours: 60,
      }),
    )
    const restartDay = plan.logs.find((log: DailyLog) => log.recap.restart_completed)
    expect(restartDay, 'a 60-hour start on a 3,000-mile trip needs a restart').toBeDefined()

    await openTab(page, 'logs')
    await page.getByTestId(`day-chip-${restartDay!.day}`).click()
    await expect(visibleSheets(page).first()).toContainText(/34-hour restart completed today/i)

    const other = plan.logs.find((log) => !log.recap.restart_completed)
    if (other) {
      await page.getByTestId(`day-chip-${other.day}`).click()
      await expect(visibleSheets(page).first()).not.toContainText(
        /34-hour restart completed today/i,
      )
    }
  })
})

test.describe('a trip that fits in one day', () => {
  test('has one sheet and nothing to step through', async ({ page }) => {
    const plan = await openTripAndPlan(
      page,
      exampleRequest({
        current: { label: 'Dallas, TX', lat: 32.7767, lon: -96.797 },
        pickup: { label: 'Fort Worth, TX', lat: 32.7555, lon: -97.3308 },
        dropoff: { label: 'Waco, TX', lat: 31.5493, lon: -97.1467 },
        cycle_used_hours: 10,
      }),
    )
    expect(plan.summary.days).toBe(1)
    await openTab(page, 'logs')
    await expect(dayChips(page)).toHaveCount(1)
    await expect(page.getByTestId('btn-prev-day')).toBeDisabled()
    await expect(page.getByTestId('btn-next-day')).toBeDisabled()

    const { file } = await downloadPdf(page, 'btn-pdf-logs')
    expect(countPdfPages(file)).toBe(1)
  })
})

test.describe('PDF download', () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
  })

  for (const [button, where] of [
    ['btn-pdf', 'the results toolbar'],
    ['btn-pdf-logs', 'the daily logs tab'],
  ] as const) {
    test(`saves one page per log day from ${where}`, async ({ page }) => {
      if (button === 'btn-pdf-logs') await openTab(page, 'logs')
      const { name, file } = await downloadPdf(page, button)
      expect(name).toMatch(/\.pdf$/i)
      expect(startsLikePdf(file)).toBe(true)
      expect(countPdfPages(file)).toBe(plan.logs.length)
    })
  }

  test('stays on the same tab and view after the download', async ({ page }) => {
    await openTab(page, 'logs')
    await downloadPdf(page, 'btn-pdf-logs')
    await expect(page.getByTestId('panel-logs')).toBeVisible()
    await expect(page.locator('[data-testid="log-sheet-1"]:visible')).toBeVisible()
  })
})

test.describe('print', () => {
  let plan: PlanResponse

  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    plan = await planExample(page)
    await stubPrint(page)
  })

  test('the results toolbar button opens the print dialog', async ({ page }) => {
    await page.getByTestId('btn-print').click()
    await expect.poll(() => printCalls(page)).toBe(1)
  })

  test('the daily logs tab button opens the print dialog', async ({ page }) => {
    await openTab(page, 'logs')
    await page.getByTestId('btn-print-logs').click()
    await expect.poll(() => printCalls(page)).toBe(1)
  })

  test('has a print root holding every sheet, even on the itinerary tab', async ({ page }) => {
    const root = page.getByTestId('log-print-root')
    await expect(root).toBeAttached()
    await expect(root.locator('svg[role="img"]')).toHaveCount(plan.logs.length)
  })

  test('shows only the sheets in print view, one page for each day', async ({ page }) => {
    await page.emulateMedia({ media: 'print' })
    await expect(page.getByTestId('log-print-root')).toBeVisible()
    await expect(page.getByTestId('btn-plan')).toBeHidden()
    await expect(page.getByTestId('map')).toBeHidden()
    await expect(page.getByTestId('log-print-root').locator('svg[role="img"]:visible')).toHaveCount(
      plan.logs.length,
    )

    const pdf = await page.pdf({ format: 'Letter', printBackground: true })
    expect(countPdfPages(pdf)).toBe(plan.logs.length)
  })
})
