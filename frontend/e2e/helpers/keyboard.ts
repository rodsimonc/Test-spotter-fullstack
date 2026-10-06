import { expect, type Locator, type Page } from '@playwright/test'

const activeTestId = (page: Page) =>
  page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)

/**
 * Presses Tab until the element with this test id has focus. Fails if it takes more than
 * `limit` presses, which would also be a problem for a keyboard user.
 */
export async function tabTo(page: Page, testId: string, limit = 80): Promise<void> {
  for (let i = 0; i < limit; i++) {
    if ((await activeTestId(page)) === testId) return
    await page.keyboard.press('Tab')
  }
  expect(await activeTestId(page), `Tab should reach ${testId} within ${limit} presses`).toBe(
    testId,
  )
}

/** True when the element shows an outline or a box shadow while focused. */
export async function hasFocusRing(element: Locator): Promise<boolean> {
  return element.evaluate((node) => {
    const style = getComputedStyle(node)
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0
    const shadow = style.boxShadow !== 'none' && style.boxShadow !== ''
    return outline || shadow
  })
}

/** True when nothing on the page scrolls sideways. */
export async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const { documentElement: root, body } = document
    return root.scrollWidth <= window.innerWidth + 1 && body.scrollWidth <= window.innerWidth + 1
  })
}
