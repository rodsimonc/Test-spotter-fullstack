import { expect, type Locator, type Page, type Response } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { registerViaApi, type Credentials } from './api'
import { escapeRegExp } from './parse'
import { gotoApp } from './plan'

/** Strong enough for Django's validators. Not close to any generated email. */
export const PASSWORD = 'Roadside-Ledger-2026!'

/** A new, never-seen account. Emails use example.com, which can never receive mail. */
export function newUser(label = 'driver'): Required<Credentials> {
  const id = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
  return {
    email: `e2e-${label}-${id}@example.com`,
    password: PASSWORD,
    name: `Pat ${label} ${id.slice(-4)}`,
  }
}

/**
 * Makes an account through the API in this page's browser context, so the context is signed in,
 * then loads the app. Use it when signing in is setup and not the thing under test.
 */
export async function signedInApp(page: Page, label = 'driver'): Promise<Required<Credentials>> {
  const user = newUser(label)
  await registerViaApi(page.request, user)
  await gotoApp(page)
  await expectSignedIn(page, user)
  return user
}

export type AuthMode = 'login' | 'register'

const authCall = (mode: AuthMode) => (response: Response) =>
  new URL(response.url()).pathname === `/api/auth/${mode}` && response.request().method() === 'POST'

/** Clicks the header button for the mode and returns the open dialog. */
export async function openAuthDialog(page: Page, mode: AuthMode): Promise<Locator> {
  await page.getByTestId(mode === 'login' ? 'btn-sign-in' : 'btn-sign-up').click()
  const dialog = page.getByTestId('auth-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

/** Picks a tab inside an open dialog. */
export async function switchAuthTab(page: Page, mode: AuthMode): Promise<void> {
  await page.getByTestId(mode === 'login' ? 'tab-auth-login' : 'tab-auth-register').click()
}

/** Fills the open dialog and submits it. Returns the API response. */
export async function submitAuth(
  page: Page,
  mode: AuthMode,
  credentials: Credentials,
): Promise<Response> {
  await page.getByTestId('input-auth-email').fill(credentials.email)
  if (mode === 'register' && credentials.name) {
    await page.getByTestId('input-auth-name').fill(credentials.name)
  }
  await page.getByTestId('input-auth-password').fill(credentials.password)
  const [response] = await Promise.all([
    page.waitForResponse(authCall(mode)),
    page.getByTestId('btn-auth-submit').click(),
  ])
  return response
}

export async function signUpViaUi(page: Page, user: Required<Credentials>): Promise<void> {
  await openAuthDialog(page, 'register')
  const response = await submitAuth(page, 'register', user)
  expect(response.status(), await response.text()).toBe(201)
  await expectSignedIn(page, user)
}

export async function signInViaUi(page: Page, user: Credentials): Promise<void> {
  await openAuthDialog(page, 'login')
  const response = await submitAuth(page, 'login', user)
  expect(response.status(), await response.text()).toBe(200)
  await expectSignedIn(page, user)
}

/** The header shows the account menu and the dialog is gone. */
export async function expectSignedIn(page: Page, user: Credentials): Promise<void> {
  await expect(page.getByTestId('auth-dialog')).toBeHidden()
  const menu = page.getByTestId('account-menu')
  await expect(menu).toBeVisible()
  const who = [user.name, user.email].filter(Boolean).map((s) => escapeRegExp(s!))
  await expect(menu).toContainText(new RegExp(who.join('|'), 'i'))
}

export async function expectSignedOut(page: Page): Promise<void> {
  await expect(page.getByTestId('btn-sign-in')).toBeVisible()
  await expect(page.getByTestId('btn-sign-up')).toBeVisible()
  await expect(page.getByTestId('account-menu')).toBeHidden()
}

/**
 * Opens the account menu if its items are not showing. `account-menu` may be the trigger
 * or a wrapper around it, so this clicks the button inside when there is one.
 */
export async function openAccountMenu(page: Page): Promise<void> {
  if (await page.getByTestId('btn-sign-out').isVisible()) return
  const menu = page.getByTestId('account-menu')
  await expect(menu).toBeVisible()
  const inner = menu.getByRole('button')
  if ((await inner.count()) > 0) await inner.first().click()
  else await menu.click()
  await expect(page.getByTestId('btn-sign-out')).toBeVisible()
}

export async function signOutViaUi(page: Page): Promise<void> {
  await openAccountMenu(page)
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/logout'),
    page.getByTestId('btn-sign-out').click(),
  ])
  expect(response.status()).toBe(204)
  await expectSignedOut(page)
}
