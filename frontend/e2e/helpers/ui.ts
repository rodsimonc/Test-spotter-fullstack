import { expect, type Locator, type Page } from '@playwright/test'

/** Toasts stack, so a test names the one it wants by its text. */
export const toastWith = (page: Page, text: string | RegExp): Locator =>
  page.getByTestId('toast').filter({ hasText: text })

/** The markup the injection tests try to get a page to run. Placed in labels, titles and names. */
export const HOSTILE_IMG = '<img src=x onerror="window.__xss=1">'
export const HOSTILE_SCRIPT = '<script>window.__xss=1</script>'

type ProbeWindow = { __xss?: unknown }

/**
 * Watches for the three ways injected markup would show itself: a dialog, the flag the payloads
 * set on `window`, and an element the payload would have created. Call `expectClean` at the end.
 */
export function watchForInjection(page: Page) {
  const dialogs: string[] = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    void dialog.dismiss()
  })
  return {
    dialogs,
    async expectClean(): Promise<void> {
      expect(dialogs, 'no alert, confirm or prompt may open').toEqual([])
      expect(
        await page.evaluate(() => (window as unknown as ProbeWindow).__xss),
        'an injected handler ran',
      ).toBeUndefined()
      await expect(page.locator('img[src="x"]'), 'an injected <img> exists').toHaveCount(0)
      await expect(
        page.locator('[onerror], [onload], [onclick]'),
        'an injected handler attribute exists',
      ).toHaveCount(0)
    },
  }
}

/** Unique per call, so tests that share a database never collide on a title. */
export function uniqueTitle(label = 'Run'): string {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
