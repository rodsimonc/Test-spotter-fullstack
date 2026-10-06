import type { Page } from '@playwright/test'
import { registerViaApi } from '../helpers/api'
import { expectNoSeriousA11yViolations } from '../helpers/a11y'
import {
  expectSignedIn,
  expectSignedOut,
  newUser,
  openAuthDialog,
  signedInApp,
  switchAuthTab,
} from '../helpers/auth'
import { hasFocusRing, tabTo } from '../helpers/keyboard'
import { gotoApp, openTab, planExample } from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { openTripsDrawer, seedTrip } from '../helpers/trips'
import { uniqueTitle } from '../helpers/ui'

// "Serious" and "critical" axe findings fail the test. See helpers/a11y.ts for the rule set.

test.describe('automated accessibility scan', () => {
  test('first screen', async ({ page }) => {
    await gotoApp(page)
    await expectNoSeriousA11yViolations(page, 'first screen')
  })

  test('form with every error showing', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('form-error-current')).toBeVisible()
    await expectNoSeriousA11yViolations(page, 'form errors')
  })

  test('log details open', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-log-details').click()
    await expect(page.getByTestId('input-driver-name')).toBeVisible()
    await expectNoSeriousA11yViolations(page, 'log details')
  })

  test('place suggestions open', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('field-current').pressSequentially('Den', { delay: 20 })
    await expect(page.getByTestId('suggestion').first()).toBeVisible()
    await expectNoSeriousA11yViolations(page, 'suggestion list')
  })

  test('pick on map mode', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('btn-pick-current').click()
    await expect(page.getByTestId('pick-banner')).toBeVisible()
    await expectNoSeriousA11yViolations(page, 'pick on map')
  })

  test.describe('with a planned trip', () => {
    test.beforeEach(async ({ page }) => {
      await gotoApp(page)
      await planExample(page)
    })

    test('itinerary', async ({ page }) => {
      await expectNoSeriousA11yViolations(page, 'results, itinerary')
    })

    test('daily logs', async ({ page }) => {
      await openTab(page, 'logs')
      await expectNoSeriousA11yViolations(page, 'results, daily logs')
    })

    test('summary', async ({ page }) => {
      await openTab(page, 'summary')
      await expectNoSeriousA11yViolations(page, 'results, summary')
    })

    test('a stop popup open on the map', async ({ page }) => {
      await page.locator('[data-testid^="stop-card-"]').nth(1).click()
      await expect(page.locator('.leaflet-popup')).toBeVisible()
      await expectNoSeriousA11yViolations(page, 'stop popup')
    })

    test('results on a phone', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await expectNoSeriousA11yViolations(page, 'results at 390 px')
    })
  })

  test.describe('dialogs', () => {
    test.beforeEach(async ({ page }) => gotoApp(page))

    test('sign in dialog', async ({ page }) => {
      await openAuthDialog(page, 'login')
      await expectNoSeriousA11yViolations(page, 'sign in dialog')
    })

    test('create account dialog', async ({ page }) => {
      await openAuthDialog(page, 'register')
      await expectNoSeriousA11yViolations(page, 'create account dialog')
    })

    test('sign in dialog with errors', async ({ page }) => {
      await openAuthDialog(page, 'login')
      await page.getByTestId('btn-auth-submit').click()
      await expect(
        page.getByTestId('auth-dialog').getByText('Enter your email address.'),
      ).toBeVisible()
      await expectNoSeriousA11yViolations(page, 'sign in dialog with errors')
    })

    test('sign in dialog with the password showing', async ({ page }) => {
      await openAuthDialog(page, 'login')
      await page.getByTestId('btn-toggle-password').click()
      await expectNoSeriousA11yViolations(page, 'sign in dialog, password shown')
    })
  })

  test.describe('signed in', () => {
    test('account menu open', async ({ page }) => {
      await signedInApp(page)
      await page.getByTestId('account-menu').click()
      await expect(page.getByTestId('btn-sign-out')).toBeVisible()
      await expectNoSeriousA11yViolations(page, 'account menu')
    })

    test('my trips drawer, empty', async ({ page }) => {
      await signedInApp(page)
      await openTripsDrawer(page)
      await expect(page.getByTestId('trips-empty')).toBeVisible()
      await expectNoSeriousA11yViolations(page, 'trips drawer, empty')
    })

    test('my trips drawer, with trips and a delete question', async ({ page }) => {
      await signedInApp(page)
      const trip = await seedTrip(page.request, uniqueTitle('Scan'))
      await seedTrip(page.request, uniqueTitle('Scan too'))
      await openTripsDrawer(page)
      await expect(page.getByTestId(`trip-row-${trip.id}`)).toBeVisible()
      await expectNoSeriousA11yViolations(page, 'trips drawer, with trips')

      await page.getByTestId(`btn-delete-trip-${trip.id}`).click()
      await expect(page.getByTestId('btn-confirm-delete')).toBeVisible()
      await expectNoSeriousA11yViolations(page, 'trips drawer, delete question')

      await page.getByTestId('btn-cancel-delete').click()
      await page.getByTestId(`btn-rename-trip-${trip.id}`).click()
      await expect(page.getByTestId(`input-rename-trip-${trip.id}`)).toBeVisible()
      await expectNoSeriousA11yViolations(page, 'trips drawer, rename box')
    })
  })
})

test.describe('page structure', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  test('has one h1, one main landmark and a labelled account nav', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('banner')).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Account' })).toBeVisible()
  })

  test('declares its language and a title', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('lang', /^en/)
    await expect(page).toHaveTitle(/\S/)
  })

  test('names the form areas', async ({ page }) => {
    await expect(page.getByRole('complementary', { name: 'Trip details' })).toBeVisible()
    await expect(page.locator('[data-testid^="field-"][role="combobox"]')).toHaveCount(3)
    for (const id of ['input-cycle', 'input-departure', 'select-timezone']) {
      await expect(page.getByTestId(id)).toHaveAccessibleName(/\S/)
    }
  })

  test('names every icon button', async ({ page }) => {
    await page.getByTestId('btn-example').click()
    for (const name of ['current', 'pickup', 'dropoff']) {
      await expect(page.getByTestId(`btn-clear-${name}`)).toHaveAccessibleName(/\S/)
      await expect(page.getByTestId(`btn-pick-${name}`)).toHaveAccessibleName(/\S/)
    }
    await expect(page.getByTestId('btn-swap')).toHaveAccessibleName(/\S/)
  })

  test('announces form errors to screen readers', async ({ page }) => {
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('form-error-current')).toHaveAttribute('role', 'alert')
    await expect(page.getByTestId('field-current')).toHaveAttribute('aria-invalid', 'true')
    const described = await page.getByTestId('field-current').getAttribute('aria-describedby')
    expect(described ?? '').toContain(
      (await page.getByTestId('form-error-current').getAttribute('id')) ?? 'missing',
    )
  })

  test('announces a planning error as an alert', async ({ page }) => {
    await page.route('**/api/plan', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'upstream_error', message: 'The routing service did not answer.' },
        }),
      }),
    )
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('error-banner')).toHaveAttribute('role', 'alert')
  })

  test('shows a loading status while planning', async ({ page }) => {
    await page.route('**/api/plan', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      await route.continue()
    })
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    const loading = page.getByTestId('loading')
    await expect(loading).toHaveAttribute('role', 'status')
    await expect(loading).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByTestId('btn-plan')).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByTestId('stats-strip')).toBeVisible()
  })

  test('marks the results tabs for assistive technology', async ({ page }) => {
    await planExample(page)
    await expect(page.getByRole('tablist', { name: 'Trip results' })).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(4)
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(1)
    await expect(page.getByTestId('panel-itinerary')).toHaveAttribute('role', 'tabpanel')
  })

  test('moves between result tabs with the arrow keys', async ({ page }) => {
    await planExample(page)
    await page.getByTestId('tab-itinerary').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('tab-directions')).toBeFocused()
    await expect(page.getByTestId('panel-directions')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('tab-logs')).toBeFocused()
    await expect(page.getByTestId('panel-logs')).toBeVisible()
    await page.keyboard.press('End')
    await expect(page.getByTestId('tab-summary')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.getByTestId('tab-itinerary')).toBeFocused()
  })
})

test.describe('keyboard', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  /** The test ids of the first `count` stops Tab makes, in order. Unnamed elements are skipped. */
  async function tabOrder(page: Page, count: number): Promise<string[]> {
    const order: string[] = []
    for (let i = 0; i < count; i++) {
      await page.keyboard.press('Tab')
      const id = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? '',
      )
      if (id) order.push(id)
    }
    return order
  }

  test('follows the page from the header to the form to the plan button', async ({ page }) => {
    const order = await tabOrder(page, 30)
    const at = (id: string) => order.indexOf(id)
    for (const id of [
      'btn-sign-in',
      'btn-sign-up',
      'field-current',
      'field-pickup',
      'field-dropoff',
      'btn-plan',
    ]) {
      expect(at(id), `${id} should be reachable with Tab`).toBeGreaterThanOrEqual(0)
    }
    expect(at('btn-sign-in')).toBeLessThan(at('btn-sign-up'))
    expect(at('btn-sign-up')).toBeLessThan(at('field-current'))
    expect(at('field-current')).toBeLessThan(at('field-pickup'))
    expect(at('field-pickup')).toBeLessThan(at('field-dropoff'))
    expect(at('field-dropoff')).toBeLessThan(at('btn-plan'))
  })

  test('shows a focus ring on buttons and fields', async ({ page }) => {
    for (const id of [
      'btn-sign-in',
      'btn-sign-up',
      'field-current',
      'btn-pick-current',
      'input-cycle',
      'input-departure',
      'select-timezone',
      'btn-log-details',
      'btn-plan',
      'btn-example',
      'btn-reset',
    ]) {
      await tabTo(page, id)
      expect(await hasFocusRing(page.getByTestId(id)), `${id} should show where focus is`).toBe(
        true,
      )
    }
  })

  test('opens the sign in dialog from the keyboard and signs in', async ({ page, request }) => {
    const user = newUser('keys')
    await registerViaApi(request, user)

    await tabTo(page, 'btn-sign-in')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('auth-dialog')).toBeVisible()
    await expect(page.getByTestId('input-auth-email')).toBeFocused()
    await page.keyboard.type(user.email)
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('input-auth-password')).toBeFocused()
    await page.keyboard.type(user.password)
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/login'),
      page.keyboard.press('Enter'),
    ])
    expect(response.status()).toBe(200)
    await expectSignedIn(page, user)
  })

  test('opens My trips and signs out from the keyboard', async ({ page }) => {
    const user = newUser('menu')
    await registerViaApi(page.request, user)
    await gotoApp(page)
    await expectSignedIn(page, user)

    await tabTo(page, 'account-menu')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('btn-my-trips')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('trips-drawer')).toBeVisible()
    await expect(page.getByTestId('btn-close-trips')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('trips-drawer')).toBeHidden()
    await expect(page.getByTestId('account-menu')).toBeFocused()

    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('btn-sign-out')).toBeFocused()
    await page.keyboard.press('Enter')
    await expectSignedOut(page)
  })

  test('enters pick-on-map mode from the keyboard and leaves it with Escape', async ({ page }) => {
    await tabTo(page, 'btn-pick-pickup')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('pick-banner')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('pick-banner')).toBeHidden()
  })

  test('chooses a place, then plans, then reads the logs without a mouse', async ({ page }) => {
    for (const name of ['current', 'pickup', 'dropoff'] as const) {
      await tabTo(page, `field-${name}`)
      await page.keyboard.type(
        name === 'current' ? 'Dallas' : name === 'pickup' ? 'Memphis' : 'Denver',
        { delay: 20 },
      )
      await expect(page.getByTestId('suggestion').first()).toBeVisible()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('suggestion')).toHaveCount(0)
    }
    await tabTo(page, 'btn-plan')
    await page.keyboard.press('Space')
    await expect(page.getByTestId('stats-strip')).toBeVisible()

    // Tabs use a roving tabindex: Tab lands on the selected tab, arrow keys move between them.
    await tabTo(page, 'tab-itinerary')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('panel-directions')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('panel-logs')).toBeVisible()
    await tabTo(page, 'btn-next-day')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-testid="log-sheet-2"]:visible')).toBeVisible()
  })

  test('closes the suggestion list with Escape without leaving the field', async ({ page }) => {
    await page.getByTestId('field-pickup').pressSequentially('Mem', { delay: 20 })
    await expect(page.getByTestId('suggestion').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('suggestion')).toHaveCount(0)
    await expect(page.getByTestId('field-pickup')).toBeFocused()
  })

  test('keeps only the selected sign in tab in the tab order', async ({ page }) => {
    await openAuthDialog(page, 'login')
    await expect(page.getByTestId('tab-auth-login')).toHaveAttribute('tabindex', '0')
    await expect(page.getByTestId('tab-auth-register')).toHaveAttribute('tabindex', '-1')
    await switchAuthTab(page, 'register')
    await expect(page.getByTestId('tab-auth-register')).toHaveAttribute('tabindex', '0')
  })
})

test.describe('motion and contrast preferences', () => {
  test('stops animating when the person asks for less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await gotoApp(page)
    const dialog = await openAuthDialog(page, 'login')
    const seconds = await dialog.evaluate((el) => {
      const raw = getComputedStyle(el).animationDuration.split(',')[0]?.trim() ?? '0s'
      return raw.endsWith('ms') ? parseFloat(raw) / 1000 : parseFloat(raw)
    })
    expect(seconds, 'animation length in seconds').toBeLessThan(0.05)
  })

  test('keeps working in forced colors mode', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' })
    await gotoApp(page)
    await expect(page.getByTestId('btn-plan')).toBeVisible()
    await expect(page.getByTestId('field-current')).toBeVisible()
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('stats-strip')).toBeVisible()
  })

  test('is readable in dark color scheme without breaking', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await gotoApp(page)
    await expectNoSeriousA11yViolations(page, 'first screen, dark scheme')
  })
})
