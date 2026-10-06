import { expect, test } from '../helpers/test'
import { FIELDS, field, gotoApp } from '../helpers/plan'

test.describe('first load', () => {
  test('shows the empty form, the map and the first-run state', async ({ page }) => {
    await gotoApp(page)
    await expect(page).toHaveTitle(/Trip Planner/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    for (const name of FIELDS) await expect(field(page, name)).toBeVisible()
    await expect(page.getByTestId('btn-plan')).toBeEnabled()
    await expect(page.getByTestId('btn-example')).toBeVisible()
    await expect(page.getByTestId('btn-reset')).toBeVisible()
    await expect(page.getByTestId('map')).toBeVisible()
    await expect(page.getByTestId('empty-state')).toBeVisible()
    await expect(page.getByTestId('stats-strip')).toHaveCount(0)
  })

  test('offers sign in and create account to a visitor', async ({ page }) => {
    await gotoApp(page)
    await expect(page.getByTestId('btn-sign-in')).toBeVisible()
    await expect(page.getByTestId('btn-sign-up')).toBeVisible()
    await expect(page.getByTestId('account-menu')).toBeHidden()
  })

  test('asks for a CSRF token and then for the current user', async ({ page, context }) => {
    const calls: string[] = []
    page.on('response', (response) => {
      const { pathname } = new URL(response.url())
      if (pathname.startsWith('/api/auth/')) calls.push(`${pathname} ${response.status()}`)
    })
    await gotoApp(page)
    expect(calls).toContain('/api/auth/csrf 200')
    expect(calls).toContain('/api/auth/me 200')
    expect(calls.indexOf('/api/auth/csrf 200')).toBeLessThan(calls.indexOf('/api/auth/me 200'))

    const cookies = await context.cookies()
    expect(cookies.map((c) => c.name)).toContain('csrftoken')
  })

  test('answers any other path with the app, so deep links work', async ({ page }) => {
    await page.goto('/some/deep/link')
    await expect(page.getByTestId('btn-plan')).toBeVisible()
  })

  test('loads with a share link that holds garbage and still shows the form', async ({ page }) => {
    await page.goto('/?trip=%25%25not-a-trip')
    await expect(page.getByTestId('btn-plan')).toBeVisible()
    await expect(field(page, 'current')).toHaveValue('')
  })
})

test.describe('health', () => {
  test('GET /api/health says ok', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
