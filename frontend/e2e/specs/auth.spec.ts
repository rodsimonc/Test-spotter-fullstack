import { registerViaApi } from '../helpers/api'
import {
  expectSignedIn,
  expectSignedOut,
  newUser,
  openAccountMenu,
  openAuthDialog,
  signInViaUi,
  signOutViaUi,
  signUpViaUi,
  submitAuth,
  switchAuthTab,
} from '../helpers/auth'
import { gotoApp } from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { toastWith } from '../helpers/ui'

test.describe('create account', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  test('opens on the create account tab from the header button', async ({ page }) => {
    const dialog = await openAuthDialog(page, 'register')
    await expect(page.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('tab-auth-login')).toHaveAttribute('aria-selected', 'false')
    await expect(page.getByTestId('input-auth-name')).toBeVisible()
    await expect(page.getByTestId('btn-auth-submit')).toHaveText(/Create account/)
    await expect(dialog).toHaveAccessibleName(/Create your account/i)
  })

  test('signs the new person in and shows their name in the header', async ({ page, context }) => {
    const user = newUser('signup')
    await openAuthDialog(page, 'register')
    const response = await submitAuth(page, 'register', user)
    expect(response.status()).toBe(201)
    expect((await response.json()).user).toMatchObject({ email: user.email, name: user.name })

    await expectSignedIn(page, user)
    await expect(toastWith(page, /Account created/i)).toBeVisible()
    await expect(page.getByTestId('btn-sign-in')).toHaveCount(0)
    expect((await context.cookies()).map((c) => c.name)).toContain('sessionid')
  })

  test('does not need a name', async ({ page }) => {
    const { email, password } = newUser('noname')
    await signUpViaUi(page, { email, password, name: '' })
    // With no name, the header falls back to the email address.
    await expect(page.getByTestId('account-menu')).toContainText(email)
  })

  test('stores the email in lower case', async ({ page }) => {
    const user = newUser('case')
    const shouty = user.email.toUpperCase()
    await openAuthDialog(page, 'register')
    const response = await submitAuth(page, 'register', { email: shouty, password: user.password })
    expect(response.status()).toBe(201)
    expect((await response.json()).user.email).toBe(user.email)
    await expect(page.getByTestId('account-menu')).toContainText(user.email)
  })

  test('refuses a weak password, keeps the dialog open and focuses the field', async ({ page }) => {
    const user = newUser('weak')
    await openAuthDialog(page, 'register')
    const response = await submitAuth(page, 'register', { ...user, password: '12345678' })
    expect(response.status()).toBe(400)

    await expect(page.getByTestId('auth-dialog')).toBeVisible()
    await expect(page.getByTestId('auth-error')).toBeVisible()
    await expect(page.getByTestId('input-auth-password')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('input-auth-password')).toBeFocused()
    await expect(page.getByTestId('account-menu')).toHaveCount(0)
  })

  test('refuses an email that already has an account', async ({ page, request }) => {
    const user = newUser('taken')
    await registerViaApi(request, user)
    await openAuthDialog(page, 'register')
    const response = await submitAuth(page, 'register', { ...user, name: 'Someone else' })
    expect(response.status()).toBe(400)
    await expect(page.getByTestId('auth-error')).toBeVisible()
    await expect(page.getByTestId('input-auth-email')).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByTestId('account-menu')).toHaveCount(0)
  })
})

test.describe('sign in', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  test('opens on the sign in tab from the header button', async ({ page }) => {
    const dialog = await openAuthDialog(page, 'login')
    await expect(page.getByTestId('tab-auth-login')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('input-auth-name')).toHaveCount(0)
    await expect(page.getByTestId('btn-auth-submit')).toHaveText(/Sign in/)
    await expect(dialog).toHaveAccessibleName(/Welcome back/i)
  })

  test('signs in with the right password', async ({ page, request }) => {
    const user = newUser('login')
    await registerViaApi(request, user)
    await signInViaUi(page, user)
    await expect(toastWith(page, /Signed in as/i)).toBeVisible()
  })

  test('submits with the Enter key', async ({ page, request }) => {
    const user = newUser('enter')
    await registerViaApi(request, user)
    await openAuthDialog(page, 'login')
    await page.getByTestId('input-auth-email').fill(user.email)
    await page.getByTestId('input-auth-password').fill(user.password)
    const [response] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === '/api/auth/login'),
      page.getByTestId('input-auth-password').press('Enter'),
    ])
    expect(response.status()).toBe(200)
    await expectSignedIn(page, user)
  })

  test('accepts the email in any case', async ({ page, request }) => {
    const user = newUser('mixed')
    await registerViaApi(request, user)
    await signInViaUi(page, { ...user, email: user.email.toUpperCase() })
  })

  test('shows an error for a wrong password and lets the person try again', async ({
    page,
    request,
  }) => {
    const user = newUser('wrong')
    await registerViaApi(request, user)
    await openAuthDialog(page, 'login')
    const failed = await submitAuth(page, 'login', { ...user, password: 'Not-The-Password-1!' })
    expect([400, 401]).toContain(failed.status())

    await expect(page.getByTestId('auth-error')).toBeVisible()
    await expect(page.getByTestId('auth-dialog')).toBeVisible()
    await expect(page.getByTestId('input-auth-email')).toHaveValue(user.email)
    await expect(page.getByTestId('account-menu')).toHaveCount(0)

    const worked = await submitAuth(page, 'login', user)
    expect(worked.status()).toBe(200)
    await expectSignedIn(page, user)
  })

  test('gives the same answer for an unknown email as for a wrong password', async ({
    page,
    request,
  }) => {
    const user = newUser('same')
    await registerViaApi(request, user)
    await openAuthDialog(page, 'login')

    await submitAuth(page, 'login', { ...user, password: 'Not-The-Password-1!' })
    const error = page.getByTestId('auth-error')
    await expect(error).toBeVisible()
    const forWrongPassword = await error.innerText()

    await submitAuth(page, 'login', newUser('ghost'))
    await expect(error).toBeVisible()
    expect(await error.innerText()).toBe(forWrongPassword)
    expect(forWrongPassword).not.toMatch(/no account|not found|does not exist|doesn't exist/i)
  })

  test('checks the form before it asks the server', async ({ page }) => {
    const calls: string[] = []
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/api/auth/login') calls.push(r.method())
    })
    await openAuthDialog(page, 'login')
    await page.getByTestId('btn-auth-submit').click()
    await expect(
      page.getByTestId('auth-dialog').getByText('Enter your email address.'),
    ).toBeVisible()
    await expect(page.getByTestId('auth-dialog').getByText('Enter your password.')).toBeVisible()
    await expect(page.getByTestId('input-auth-email')).toBeFocused()

    await page.getByTestId('input-auth-email').fill('not-an-email')
    await page.getByTestId('input-auth-password').fill('whatever-1')
    await page.getByTestId('btn-auth-submit').click()
    await expect(page.getByTestId('auth-dialog').getByText(/looks incomplete/i)).toBeVisible()
    expect(calls, 'nothing should reach the server').toEqual([])
  })

  test('shows a throttled answer in the dialog', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'Retry-After': '45' },
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'throttled', message: 'Too many attempts. Try again in a minute.' },
        }),
      }),
    )
    await openAuthDialog(page, 'login')
    await submitAuth(page, 'login', newUser('throttled'))
    await expect(page.getByTestId('auth-error')).toContainText('Too many attempts')
    await expect(page.getByTestId('auth-dialog')).toBeVisible()
  })

  test('shows a message when the server cannot be reached', async ({ page }) => {
    await page.route('**/api/auth/login', (route) => route.abort('connectionrefused'))
    await openAuthDialog(page, 'login')
    await page.getByTestId('input-auth-email').fill(newUser('offline').email)
    await page.getByTestId('input-auth-password').fill('Roadside-Ledger-2026!')
    await page.getByTestId('btn-auth-submit').click()
    await expect(page.getByTestId('auth-error')).toContainText(/reach the server/i)
    await expect(page.getByTestId('btn-auth-submit')).toBeEnabled()
  })
})

test.describe('password field', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await openAuthDialog(page, 'login')
  })

  test('hides the password until asked to show it', async ({ page }) => {
    const password = page.getByTestId('input-auth-password')
    const toggle = page.getByTestId('btn-toggle-password')
    await password.fill('Roadside-Ledger-2026!')

    await expect(password).toHaveAttribute('type', 'password')
    await expect(toggle).toHaveAccessibleName(/show password/i)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()
    await expect(password).toHaveAttribute('type', 'text')
    await expect(password).toHaveValue('Roadside-Ledger-2026!')
    await expect(toggle).toHaveAccessibleName(/hide password/i)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')

    await toggle.click()
    await expect(password).toHaveAttribute('type', 'password')
  })

  test('does not submit the form when the toggle is pressed', async ({ page }) => {
    let sent = 0
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/auth/login')) sent += 1
    })
    await page.getByTestId('input-auth-email').fill(newUser('toggle').email)
    await page.getByTestId('input-auth-password').fill('Roadside-Ledger-2026!')
    await page.getByTestId('btn-toggle-password').click()
    await expect(page.getByTestId('input-auth-password')).toHaveAttribute('type', 'text')
    await expect(page.getByTestId('auth-error')).toHaveCount(0)
    expect(sent).toBe(0)
  })

  test('keeps the typed password when switching tabs', async ({ page }) => {
    await page.getByTestId('input-auth-email').fill('someone@example.com')
    await page.getByTestId('input-auth-password').fill('Roadside-Ledger-2026!')
    await switchAuthTab(page, 'register')
    await expect(page.getByTestId('input-auth-password')).toHaveValue('Roadside-Ledger-2026!')
    await expect(page.getByTestId('input-auth-email')).toHaveValue('someone@example.com')
  })
})

test.describe('tabs inside the dialog', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await openAuthDialog(page, 'login')
  })

  test('switches between sign in and create account', async ({ page }) => {
    await switchAuthTab(page, 'register')
    await expect(page.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('input-auth-name')).toBeVisible()
    await expect(page.getByTestId('btn-auth-submit')).toHaveText(/Create account/)

    await switchAuthTab(page, 'login')
    await expect(page.getByTestId('tab-auth-login')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('input-auth-name')).toHaveCount(0)
    await expect(page.getByTestId('btn-auth-submit')).toHaveText(/Sign in/)
  })

  test('clears an error when the tab changes', async ({ page }) => {
    await page.getByTestId('btn-auth-submit').click()
    await expect(
      page.getByTestId('auth-dialog').getByText('Enter your email address.'),
    ).toBeVisible()
    await switchAuthTab(page, 'register')
    await expect(
      page.getByTestId('auth-dialog').getByText('Enter your email address.'),
    ).toHaveCount(0)
  })

  test('moves between tabs with the arrow keys', async ({ page }) => {
    await page.getByTestId('tab-auth-login').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('tab-auth-register')).toBeFocused()
    await expect(page.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'true')
  })

  test('has a link at the bottom that flips to the other tab', async ({ page }) => {
    await page
      .getByTestId('auth-dialog')
      .getByRole('button', { name: 'Create an account', exact: true })
      .click()
    await expect(page.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'true')
    await page
      .getByTestId('auth-dialog')
      .getByRole('button', { name: 'Sign in', exact: true })
      .click()
    await expect(page.getByTestId('tab-auth-login')).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('dialog behavior', () => {
  test.beforeEach(async ({ page }) => gotoApp(page))

  test('puts focus in the email field when it opens', async ({ page }) => {
    await openAuthDialog(page, 'login')
    await expect(page.getByTestId('input-auth-email')).toBeFocused()
  })

  test('is a modal dialog with a name', async ({ page }) => {
    const dialog = await openAuthDialog(page, 'login')
    await expect(dialog).toHaveAttribute('role', 'dialog')
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    await expect(dialog).toHaveAccessibleName(/\S/)
  })

  test('keeps Tab and Shift+Tab inside the dialog', async ({ page }) => {
    const dialog = await openAuthDialog(page, 'login')
    const insideDialog = () =>
      dialog.evaluate(
        (node) => node.contains(document.activeElement) && document.activeElement !== node,
      )
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      expect(await insideDialog(), `Tab press ${i + 1} left the dialog`).toBe(true)
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await insideDialog(), `Shift+Tab press ${i + 1} left the dialog`).toBe(true)
    }
  })

  test('makes the page behind it inert', async ({ page }) => {
    await openAuthDialog(page, 'login')
    await expect(page.locator('#root')).toHaveAttribute('inert', '')
    await page.keyboard.press('Escape')
    await expect(page.locator('#root')).not.toHaveAttribute('inert', '')
  })

  for (const mode of ['login', 'register'] as const) {
    const opener = mode === 'login' ? 'btn-sign-in' : 'btn-sign-up'

    test(`closes on Escape and returns focus to the ${mode === 'login' ? 'Sign in' : 'Create account'} button`, async ({
      page,
    }) => {
      await openAuthDialog(page, mode)
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('auth-dialog')).toBeHidden()
      await expect(page.getByTestId(opener)).toBeFocused()
    })

    test(`closes with the close button (${mode})`, async ({ page }) => {
      await openAuthDialog(page, mode)
      await page.getByTestId('btn-auth-close').click()
      await expect(page.getByTestId('auth-dialog')).toBeHidden()
      await expect(page.getByTestId(opener)).toBeFocused()
    })
  }

  test('closes when the backdrop is clicked', async ({ page }) => {
    await openAuthDialog(page, 'login')
    await page.mouse.click(4, 4)
    await expect(page.getByTestId('auth-dialog')).toBeHidden()
  })

  test('starts empty each time it opens', async ({ page }) => {
    await openAuthDialog(page, 'login')
    await page.getByTestId('input-auth-email').fill('left-behind@example.com')
    await page.getByTestId('input-auth-password').fill('left-behind-1')
    await page.getByTestId('btn-auth-close').click()
    await openAuthDialog(page, 'login')
    await expect(page.getByTestId('input-auth-email')).toHaveValue('')
    await expect(page.getByTestId('input-auth-password')).toHaveValue('')
  })

  test('does not scroll the page behind it', async ({ page }) => {
    await openAuthDialog(page, 'login')
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
    await page.keyboard.press('Escape')
    expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden')
  })
})

test.describe('sign out', () => {
  test('returns the header to its signed-out state and ends the session', async ({
    page,
    context,
  }) => {
    await gotoApp(page)
    const user = newUser('out')
    await signUpViaUi(page, user)

    await signOutViaUi(page)
    await expect(toastWith(page, /Signed out/i)).toBeVisible()

    const me = await page.request.get('/api/auth/me')
    expect((await me.json()).user).toBeNull()
    const trips = await page.request.get('/api/trips')
    expect(trips.status()).toBe(401)
    expect((await context.cookies()).find((c) => c.name === 'sessionid')?.value ?? '').toBe('')
  })

  test('stays signed out after a reload', async ({ page }) => {
    await gotoApp(page)
    await signUpViaUi(page, newUser('reload'))
    await signOutViaUi(page)
    await page.reload()
    await expectSignedOut(page)
  })

  test('lets the same person sign back in', async ({ page }) => {
    await gotoApp(page)
    const user = newUser('again')
    await signUpViaUi(page, user)
    await signOutViaUi(page)
    await signInViaUi(page, user)
  })
})

test.describe('staying signed in', () => {
  test('survives a reload', async ({ page }) => {
    await gotoApp(page)
    const user = newUser('stay')
    await signUpViaUi(page, user)
    await page.reload()
    await expectSignedIn(page, user)
  })

  test('is shared by every tab in the same browser', async ({ page, context }) => {
    await gotoApp(page)
    const user = newUser('tabs')
    await signUpViaUi(page, user)
    const second = await context.newPage()
    await gotoApp(second)
    await expectSignedIn(second, user)
  })

  test('is not shared with another browser', async ({ page, openSession }) => {
    await gotoApp(page)
    await signUpViaUi(page, newUser('mine'))
    const other = await openSession()
    await gotoApp(other.page)
    await expectSignedOut(other.page)
  })
})

test.describe('account menu', () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page)
    await signUpViaUi(page, newUser('menu'))
  })

  test('opens and closes from the button', async ({ page }) => {
    await openAccountMenu(page)
    await expect(page.getByTestId('account-menu')).toHaveAttribute('aria-expanded', 'true')
    await page.getByTestId('account-menu').click()
    await expect(page.getByTestId('btn-sign-out')).toBeHidden()
  })

  test('closes on Escape and returns focus to the button', async ({ page }) => {
    await openAccountMenu(page)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('btn-sign-out')).toBeHidden()
    await expect(page.getByTestId('account-menu')).toBeFocused()
  })

  test('closes when the page outside it is clicked', async ({ page }) => {
    await openAccountMenu(page)
    await page.getByRole('heading', { level: 1 }).click()
    await expect(page.getByTestId('btn-sign-out')).toBeHidden()
  })

  test('moves between items with the arrow keys', async ({ page }) => {
    await openAccountMenu(page)
    await expect(page.getByTestId('btn-my-trips')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('btn-sign-out')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('btn-my-trips')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByTestId('btn-sign-out')).toBeFocused()
  })
})
