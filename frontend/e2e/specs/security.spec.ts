import type { APIRequestContext, APIResponse } from '@playwright/test'
import type { PlanRequest } from '../../src/api/types'
import { csrfToken, errorOf, loginViaApi, registerViaApi, send } from '../helpers/api'
import { isHttps, isRemote, origin, usePreview } from '../helpers/env'
import {
  expectSignedIn,
  newUser,
  openAccountMenu,
  signOutViaUi,
  signUpViaUi,
  signedInApp,
} from '../helpers/auth'
import {
  clickPlan,
  exampleRequest,
  field,
  gotoApp,
  openTab,
  openTripAndPlan,
  stopCards,
} from '../helpers/plan'
import { expect, test } from '../helpers/test'
import { openTripsDrawer, seedTrip, tripRow } from '../helpers/trips'
import {
  HOSTILE_IMG,
  HOSTILE_SCRIPT,
  toastWith,
  uniqueTitle,
  watchForInjection,
} from '../helpers/ui'

const JSON_HEADERS = { 'Content-Type': 'application/json', Origin: origin, Referer: `${origin}/` }

/** Sends text as the body, byte for byte, the way a hand-built request would. */
async function sendRaw(
  request: APIRequestContext,
  path: string,
  body: string,
): Promise<APIResponse> {
  const token = await csrfToken(request)
  return request.fetch(path, {
    method: 'POST',
    data: body,
    headers: { ...JSON_HEADERS, 'X-CSRFToken': token },
  })
}

const isJson = (response: APIResponse) =>
  (response.headers()['content-type'] ?? '').includes('application/json')

const isDjangoDebugPage = async (response: APIResponse) =>
  (await response.text()).includes('DEBUG = True')

test.describe('hostile text stays text', () => {
  test('place names in a share link are shown, not run', async ({ page }) => {
    const injection = watchForInjection(page)
    const current = `${HOSTILE_IMG}Pwned Plains, ${HOSTILE_SCRIPT}Texas`
    await openTripAndPlan(
      page,
      exampleRequest({
        current: { label: current, lat: 32.95, lon: -97.2 },
        pickup: { label: `${HOSTILE_IMG} Memphis`, lat: 35.1495, lon: -90.049 },
        dropoff: { label: '"><svg onload="window.__xss=1"> Denver', lat: 39.7392, lon: -104.9903 },
      }),
    )

    await expect(field(page, 'current')).toHaveValue(current)
    await expect(page.locator('#results-title')).toContainText(HOSTILE_IMG)
    for (const tab of ['logs', 'summary', 'itinerary'] as const) {
      await openTab(page, tab)
      await injection.expectClean()
    }
    await stopCards(page).nth(1).click()
    await injection.expectClean()
  })

  test('a place name from the search box is shown, not run', { tag: '@fake' }, async ({ page }) => {
    const injection = watchForInjection(page)
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    const input = field(page, 'current')
    await input.clear()
    await input.pressSequentially('Pwned', { delay: 15 })
    const option = page.getByTestId('suggestion').first()
    await expect(option).toContainText('Pwned Plains')
    await option.click()
    await clickPlan(page)
    await expect(page.locator('#results-title')).toContainText('Pwned Plains')
    await injection.expectClean()
  })

  test('a share link with extra and prototype keys cannot change the page', async ({ page }) => {
    const injection = watchForInjection(page)
    const raw = JSON.stringify(exampleRequest()).replace(
      /^\{/,
      '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"isAdmin":true,',
    )
    await page.goto(`/?trip=${Buffer.from(raw, 'utf8').toString('base64url')}`)
    await expect(page.getByTestId('stats-strip')).toBeVisible()
    const polluted = await page.evaluate(() => (({}) as { polluted?: unknown }).polluted)
    expect(polluted, 'Object.prototype should be untouched').toBeUndefined()
    await injection.expectClean()
  })

  test('a trip title with markup is shown as text in the list, the label and the toast', async ({
    page,
  }) => {
    const injection = watchForInjection(page)
    await signedInApp(page)
    const title = `${HOSTILE_IMG}<b>Boom</b>`
    const trip = await seedTrip(page.request, title)

    await openTripsDrawer(page)
    const row = tripRow(page, trip.id)
    await expect(row).toContainText(title)
    await expect(row.locator('b')).toHaveCount(0)
    await expect(page.getByTestId(`btn-rename-trip-${trip.id}`)).toHaveAccessibleName(
      `Rename ${title}`,
    )

    await page.getByTestId(`btn-open-trip-${trip.id}`).click()
    await expect(toastWith(page, 'Opened')).toContainText(title)
    await injection.expectClean()
  })

  test('a title typed into the rename box is stored and returned as plain text', async ({
    page,
  }) => {
    const injection = watchForInjection(page)
    await signedInApp(page)
    const trip = await seedTrip(page.request, uniqueTitle('Plain'))
    const hostile = `${HOSTILE_SCRIPT}${HOSTILE_IMG}`

    await openTripsDrawer(page)
    await page.getByTestId(`btn-rename-trip-${trip.id}`).click()
    await page.getByTestId(`input-rename-trip-${trip.id}`).fill(hostile)
    await page.getByTestId(`input-rename-trip-${trip.id}`).press('Enter')
    await expect(tripRow(page, trip.id)).toContainText(hostile)

    const stored = await page.request.get(`/api/trips/${trip.id}`)
    expect((await stored.json()).title).toBe(hostile)
    expect(stored.headers()['content-type']).toContain('application/json')
    await injection.expectClean()
  })

  test('the default title built from a hostile place name is plain text', async ({ page }) => {
    const injection = watchForInjection(page)
    await signedInApp(page)
    const label = `${HOSTILE_IMG}Pwned Plains`
    await openTripAndPlan(page, exampleRequest({ current: { label, lat: 32.95, lon: -97.2 } }))
    await page.getByTestId('btn-save').click()
    await expect(page.getByTestId('btn-save')).toContainText('Saved')

    await openTripsDrawer(page)
    await expect(page.locator('[data-testid^="trip-row-"]').first()).toContainText(label)
    await injection.expectClean()
  })

  test('an account name with markup is shown as text in the header and the menu', async ({
    page,
  }) => {
    const injection = watchForInjection(page)
    const user = { ...newUser('xss'), name: `${HOSTILE_IMG}Pat` }
    await registerViaApi(page.request, user)
    await gotoApp(page)
    await expectSignedIn(page, user)
    await expect(page.getByTestId('account-menu')).toContainText(user.name)
    await openAccountMenu(page)
    await expect(page.getByRole('menu', { name: 'Account' })).toContainText(user.name)
    await injection.expectClean()
  })

  test('the API returns markup, quotes and SQL as the same text it was given', async ({
    request,
  }) => {
    const labels = [
      `Robert'); DROP TABLE trips;--`,
      '<script>alert(1)</script>',
      '"><img src=x onerror=alert(1)>',
      'Zürich 北京 😀 العربية',
      '${7*7} {{7*7}} %s %(name)s',
    ]
    for (const label of labels) {
      const body = exampleRequest({ current: { label, lat: 32.7767, lon: -96.797 } })
      const response = await send(request, 'POST', '/api/plan', body)
      expect(response.status(), label).toBe(200)
      expect(isJson(response)).toBe(true)
      expect((await response.json()).request.current.label, label).toBe(label)
    }
  })
})

test.describe('cookies', () => {
  test('sets a CSRF cookie that the page can read and that stays on this site', async ({
    page,
    context,
  }) => {
    await gotoApp(page)
    const cookie = (await context.cookies()).find((c) => c.name === 'csrftoken')
    expect(cookie, 'csrftoken cookie').toBeDefined()
    expect(cookie!.value.length).toBeGreaterThanOrEqual(32)
    expect(cookie!.httpOnly, 'the page needs to read this one').toBe(false)
    expect(cookie!.sameSite).toBe('Lax')
    expect(cookie!.path).toBe('/')
    expect(cookie!.domain.startsWith('.'), 'host-only, not shared with subdomains').toBe(false)
    if (isHttps) expect(cookie!.secure).toBe(true)
    expect(await page.evaluate(() => document.cookie)).toContain('csrftoken=')
  })

  test('hands out a CSRF token that matches the cookie', async ({ request }) => {
    const response = await request.get('/api/auth/csrf')
    expect(response.status()).toBe(200)
    const { csrf } = await response.json()
    expect(typeof csrf).toBe('string')
    expect(csrf.length).toBeGreaterThanOrEqual(32)
    const cookies = (await request.storageState()).cookies
    expect(cookies.map((c) => c.name)).toContain('csrftoken')
  })

  test('marks the session cookie HttpOnly, SameSite and, on HTTPS, Secure', async ({
    page,
    context,
  }) => {
    await gotoApp(page)
    expect((await context.cookies()).map((c) => c.name)).not.toContain('sessionid')
    await signUpViaUi(page, newUser('flags'))

    const session = (await context.cookies()).find((c) => c.name === 'sessionid')
    expect(session, 'sessionid cookie').toBeDefined()
    expect(session!.httpOnly).toBe(true)
    expect(session!.sameSite).toBe('Lax')
    expect(session!.path).toBe('/')
    expect(session!.domain.startsWith('.'), 'host-only, not shared with subdomains').toBe(false)
    expect(session!.value.length).toBeGreaterThanOrEqual(20)
    if (isHttps) expect(session!.secure).toBe(true)
    expect(
      await page.evaluate(() => document.cookie),
      'scripts cannot read the session',
    ).not.toContain('sessionid')
  })

  test('does not give anonymous visitors a session', async ({ page, context }) => {
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await page.getByTestId('btn-plan').click()
    await expect(page.getByTestId('stats-strip')).toBeVisible()
    expect((await context.cookies()).map((c) => c.name)).not.toContain('sessionid')
  })

  test('issues a new session id at sign in and ignores one the client made up', async ({
    page,
    context,
    request,
  }) => {
    const user = newUser('fixation')
    await registerViaApi(request, user)
    const planted = 'planted0by0an0attacker0123456789abcdef'
    await context.addCookies([{ name: 'sessionid', value: planted, url: origin, httpOnly: true }])

    await loginViaApi(page.request, user)
    const issued = (await context.cookies()).filter((c) => c.name === 'sessionid')
    expect(issued).toHaveLength(1)
    expect(issued[0].value).not.toBe(planted)
  })

  test('ends the session on the server at sign out, not only in the browser', async ({
    page,
    context,
    openSession,
  }) => {
    await signedInApp(page)
    const old = (await context.cookies()).find((c) => c.name === 'sessionid')!
    await signOutViaUi(page)

    const replay = await openSession()
    await replay.context.addCookies([
      { name: 'sessionid', value: old.value, url: origin, httpOnly: true },
    ])
    const me = await replay.page.request.get('/api/auth/me')
    expect((await me.json()).user).toBeNull()
    expect((await replay.page.request.get('/api/trips')).status()).toBe(401)
  })
})

test.describe('CSRF', () => {
  const body = () => ({ email: newUser('csrf').email, password: 'Roadside-Ledger-2026!' })

  test('sign in and create account refuse a request with no token', async ({ request }) => {
    await csrfToken(request)
    for (const path of ['/api/auth/login', '/api/auth/register']) {
      const response = await send(request, 'POST', path, body(), { csrf: false })
      expect(response.status(), path).toBe(403)
      expect(isJson(response), `${path} answers in JSON`).toBe(true)
      expect((await errorOf(response)).code).toBe('forbidden')
    }
  })

  test('refuses a token that is not the one that was issued', async ({ request }) => {
    await csrfToken(request)
    const response = await request.fetch('/api/auth/login', {
      method: 'POST',
      data: body(),
      headers: { ...JSON_HEADERS, 'X-CSRFToken': 'A'.repeat(64) },
    })
    expect(response.status()).toBe(403)
  })

  test('refuses a good token sent from another site', async ({ request }) => {
    const token = await csrfToken(request)
    const response = await request.fetch('/api/auth/login', {
      method: 'POST',
      data: body(),
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
        'X-CSRFToken': token,
      },
    })
    expect(response.status()).toBe(403)
  })

  test('refuses to save, rename or delete a trip without a token', async ({ page }) => {
    await signedInApp(page)
    const title = uniqueTitle('Guarded')
    const trip = await seedTrip(page.request, title)

    const save = await send(
      page.request,
      'POST',
      '/api/trips',
      { request: exampleRequest() },
      { csrf: false },
    )
    expect(save.status()).toBe(403)
    const rename = await send(
      page.request,
      'PATCH',
      `/api/trips/${trip.id}`,
      { title: 'Hijacked' },
      { csrf: false },
    )
    expect(rename.status()).toBe(403)
    const remove = await send(page.request, 'DELETE', `/api/trips/${trip.id}`, undefined, {
      csrf: false,
    })
    expect(remove.status()).toBe(403)

    const stored = await page.request.get(`/api/trips/${trip.id}`)
    expect((await stored.json()).title).toBe(title)
    const list = await (await page.request.get('/api/trips')).json()
    expect(list.count).toBe(1)
  })

  test('refuses to sign the person out without a token', async ({ page }) => {
    await signedInApp(page)
    const response = await send(page.request, 'POST', '/api/auth/logout', undefined, {
      csrf: false,
    })
    expect(response.status()).toBe(403)
    expect(
      ((await (await page.request.get('/api/auth/me')).json()) as { user: unknown }).user,
    ).not.toBeNull()
  })
})

test.describe('who can see what', () => {
  test('answers 401 to every trips call from someone who is not signed in', async ({ page }) => {
    await gotoApp(page)
    const id = '3f0b6f3c-8f55-4d57-9d5e-2b9b0a9d2f11'

    const list = await page.request.get('/api/trips')
    expect(list.status()).toBe(401)
    expect((await errorOf(list)).code).toBe('not_authenticated')
    expect((await page.request.get(`/api/trips/${id}`)).status()).toBe(401)
    expect(
      (await send(page.request, 'POST', '/api/trips', { request: exampleRequest() })).status(),
    ).toBe(401)
    expect((await send(page.request, 'PATCH', `/api/trips/${id}`, { title: 'x' })).status()).toBe(
      401,
    )
    expect((await send(page.request, 'DELETE', `/api/trips/${id}`)).status()).toBe(401)
  })

  test('answers who-am-I with a null user when no one is signed in', async ({ request }) => {
    const response = await request.get('/api/auth/me')
    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ user: null })
  })

  test('hides one person trip from another, whether they read, rename or delete it', async ({
    page,
    openSession,
  }) => {
    await signedInApp(page, 'owner')
    const title = uniqueTitle('Mine')
    const trip = await seedTrip(page.request, title)

    const stranger = await openSession()
    await registerViaApi(stranger.page.request, newUser('stranger'))
    const theirs = stranger.page.request

    const read = await theirs.get(`/api/trips/${trip.id}`)
    expect(read.status(), 'read').toBe(404)
    expect((await errorOf(read)).code).toBe('not_found')
    const rename = await send(theirs, 'PATCH', `/api/trips/${trip.id}`, { title: 'Hijacked' })
    expect(rename.status(), 'rename').toBe(404)
    const remove = await send(theirs, 'DELETE', `/api/trips/${trip.id}`)
    expect(remove.status(), 'delete').toBe(404)

    const list = await (await theirs.get('/api/trips')).json()
    expect(list.count).toBe(0)
    expect(JSON.stringify(list)).not.toContain(trip.id)

    const mine = await (await page.request.get(`/api/trips/${trip.id}`)).json()
    expect(mine.title, 'the owner still has it, unchanged').toBe(title)
  })

  test('gives the same answer for a trip that exists and one that does not', async ({
    page,
    openSession,
  }) => {
    await signedInApp(page, 'owner')
    const trip = await seedTrip(page.request, uniqueTitle('Exists'))

    const stranger = await openSession()
    await registerViaApi(stranger.page.request, newUser('prober'))
    const foreign = await stranger.page.request.get(`/api/trips/${trip.id}`)
    const missing = await stranger.page.request.get(
      '/api/trips/6c1f2f0e-0a41-4e0d-8a6e-7c1d1b5f9a10',
    )
    expect(foreign.status()).toBe(missing.status())
    expect(await foreign.json()).toEqual(await missing.json())
  })

  test('answers odd trip ids with a clean 4xx', async ({ page }) => {
    await signedInApp(page)
    for (const id of [
      'not-a-uuid',
      '1',
      '00000000-0000-0000-0000-000000000000',
      "'%20OR%201=1--",
      '%00',
    ]) {
      const response = await page.request.get(`/api/trips/${id}`)
      expect(response.status(), id).toBeGreaterThanOrEqual(400)
      expect(response.status(), id).toBeLessThan(500)
      // Local runs use DJANGO_DEBUG=1, where Django answers unmatched URLs with an HTML page.
      if (!(await isDjangoDebugPage(response))) {
        expect(isJson(response), `${id} answers in JSON`).toBe(true)
      }
    }
  })

  test('returns only id, email and name for the signed-in person', async ({ page }) => {
    const user = await signedInApp(page)
    const me = await (await page.request.get('/api/auth/me')).json()
    expect(Object.keys(me.user).sort()).toEqual(['email', 'id', 'name'])
    expect(JSON.stringify(me)).not.toContain(user.password)
  })

  test('never sends the password back, on sign up or sign in', async ({ request }) => {
    const user = newUser('echo')
    const created = await send(request, 'POST', '/api/auth/register', user)
    expect(await created.text()).not.toContain(user.password)
    await send(request, 'POST', '/api/auth/logout')
    const signedIn = await send(request, 'POST', '/api/auth/login', user)
    expect(await signedIn.text()).not.toContain(user.password)
  })

  test('does not reveal whether an email has an account when sign in fails', async ({
    request,
  }) => {
    const user = newUser('enumerate')
    await registerViaApi(request, user)
    await send(request, 'POST', '/api/auth/logout')

    const wrongPassword = await send(request, 'POST', '/api/auth/login', {
      ...user,
      password: 'Not-The-Password-1!',
    })
    const unknownEmail = await send(request, 'POST', '/api/auth/login', newUser('unknown'))
    expect(wrongPassword.status()).toBe(unknownEmail.status())
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json())
  })
})

test.describe('what the API accepts', () => {
  const base = () => exampleRequest()
  const cases: [string, (r: PlanRequest) => unknown][] = [
    ['a latitude above 90', (r) => ({ ...r, current: { ...r.current, lat: 91 } })],
    ['a longitude below -180', (r) => ({ ...r, pickup: { ...r.pickup, lon: -181 } })],
    ['more than 70 cycle hours', (r) => ({ ...r, cycle_used_hours: 70.01 })],
    ['negative cycle hours', (r) => ({ ...r, cycle_used_hours: -0.25 })],
    ['cycle hours as text', (r) => ({ ...r, cycle_used_hours: 'twelve' })],
    ['a departure that is not a date', (r) => ({ ...r, departure: 'tomorrow morning' })],
    ['a time zone that does not exist', (r) => ({ ...r, timezone: 'Mars/Olympus_Mons' })],
    [
      'a label over 200 characters',
      (r) => ({ ...r, dropoff: { ...r.dropoff, label: 'x'.repeat(201) } }),
    ],
    [
      'a header field over 120 characters',
      (r) => ({ ...r, header: { carrier_name: 'x'.repeat(121) } }),
    ],
    ['all three places at one point', (r) => ({ ...r, pickup: r.current, dropoff: r.current })],
    ['no pickup', (r) => ({ ...r, pickup: undefined })],
    ['a list instead of an object', () => []],
    ['an empty object', () => ({})],
  ]

  for (const [name, mutate] of cases) {
    test(`rejects ${name} with a 400 that names the problem`, async ({ request }) => {
      const response = await send(request, 'POST', '/api/plan', mutate(base()))
      expect(response.status()).toBe(400)
      expect(isJson(response)).toBe(true)
      const error = await errorOf(response)
      expect(error.code).toBe('validation_error')
      expect(typeof error.message).toBe('string')
      expect(
        Object.keys(error.fields ?? {}).length,
        'fields should say what is wrong',
      ).toBeGreaterThan(0)
    })
  }

  for (const [name, value] of [
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['a number too big for a double', '1e999'],
  ] as const) {
    test(`rejects ${name} as cycle hours`, async ({ request }) => {
      const raw = JSON.stringify(base()).replace(
        /"cycle_used_hours":[^,}]+/,
        `"cycle_used_hours":${value}`,
      )
      const response = await sendRaw(request, '/api/plan', raw)
      expect(response.status()).toBe(400)
      expect(isJson(response)).toBe(true)
    })
  }

  test('rejects a body that is not JSON', async ({ request }) => {
    const response = await sendRaw(request, '/api/plan', '{"current": ')
    expect(response.status()).toBe(400)
    expect(isJson(response)).toBe(true)
    expect((await errorOf(response)).code).toMatch(/\S/)
  })

  test('rejects a body that is far too large', async ({ request }) => {
    const huge = JSON.stringify({ ...base(), header: { carrier_name: 'x'.repeat(300_000) } })
    const response = await sendRaw(request, '/api/plan', huge)
    expect([400, 413]).toContain(response.status())
    expect(isJson(response)).toBe(true)
  })

  test('answers an unknown path in JSON', async ({ request }) => {
    const missing = await request.get('/api/does-not-exist')
    expect(missing.status()).toBe(404)
    test.skip(
      await isDjangoDebugPage(missing),
      'Local runs use DJANGO_DEBUG=1, and Django swaps in its own HTML 404 page for unknown URLs then. Deployed sites answer in JSON.',
    )
    expect(isJson(missing)).toBe(true)
    expect((await errorOf(missing)).code).toBe('not_found')
  })

  test('answers a wrong method in JSON', async ({ request }) => {
    const wrongMethod = await request.get('/api/plan')
    expect(wrongMethod.status()).toBe(405)
    expect(isJson(wrongMethod)).toBe(true)
  })

  test('never puts a stack trace or a file path in an error', async ({ request }) => {
    const answers = [
      await request.get('/api/does-not-exist'),
      await request.get('/api/trips'),
      await send(request, 'POST', '/api/plan', {}),
      await send(request, 'POST', '/api/auth/login', { email: 'x', password: 'y' }),
      await send(request, 'POST', '/api/auth/login', {}, { csrf: false }),
    ]
    for (const response of answers) {
      // Django's own debug 404 page shows up only when a local run has DJANGO_DEBUG=1.
      if (await isDjangoDebugPage(response)) continue
      const text = await response.text()
      expect(text, `${response.url()} (${response.status()})`).not.toMatch(
        /Traceback|File "|\.py\b|django\.|<html|<!doctype|SECRET_KEY|DEBUG/i,
      )
    }
  })

  test('refuses a trip longer than it will plan', async ({ request }) => {
    // Pole to equator to pole. The API caps trip length, so this must not be a 200 and must not hang.
    const far = exampleRequest({
      current: { label: 'North of everything', lat: 89.9, lon: 0 },
      pickup: { label: 'Middle', lat: 0, lon: 90 },
      dropoff: { label: 'South of everything', lat: -89.9, lon: 180 },
    })
    const response = await send(request, 'POST', '/api/plan', far)
    expect([400, 422, 502]).toContain(response.status())
    expect(isJson(response)).toBe(true)
  })
})

test.describe('limits', () => {
  test('slows down a flood of sign in attempts from one address', async ({ request }) => {
    test.skip(
      isRemote,
      'This would lock the shared address of a deployed run out of sign in for a minute.',
    )
    const attempt = () => send(request, 'POST', '/api/auth/login', newUser('flood'))
    const statuses: number[] = []
    let blocked: APIResponse | undefined
    for (let i = 0; i < 14 && !blocked; i++) {
      const response = await attempt()
      statuses.push(response.status())
      if (response.status() === 429) blocked = response
    }
    expect(blocked, `statuses: ${statuses.join(' ')}`).toBeDefined()
    expect(statuses.length, 'the first few attempts are allowed').toBeGreaterThanOrEqual(8)
    expect(Number(blocked!.headers()['retry-after'])).toBeGreaterThan(0)
    expect((await errorOf(blocked!)).code).toBe('throttled')
  })
})

test.describe('response headers', () => {
  test('API answers say not to sniff content types and not to be framed', async ({ request }) => {
    const response = await request.get('/api/health')
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    expect(response.headers()['x-frame-options']).toBe('DENY')
    expect(response.headers()['content-type']).toContain('application/json')
  })

  test('HTTPS answers pin HTTPS with HSTS', async ({ request }) => {
    test.skip(!isHttps, 'Needs a deployed site over HTTPS.')
    const response = await request.get('/api/health')
    expect(response.headers()['strict-transport-security']).toMatch(/max-age=\d{7,}/)
  })

  test('the app page carries the production content security policy', async ({ request }) => {
    test.skip(
      !usePreview && !isRemote,
      'The dev server sends no policy. Run with E2E_PREVIEW=1 or E2E_BASE_URL.',
    )
    const response = await request.get('/')
    const headers = response.headers()
    const policy = headers['content-security-policy'] ?? ''
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("script-src 'self'")
    expect(policy, 'no inline or eval scripts').not.toMatch(
      /script-src[^;]*('unsafe-inline'|'unsafe-eval')/,
    )
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain('https://*.tile.openstreetmap.org')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBeTruthy()
    expect(headers['permissions-policy']).toMatch(/geolocation=\(\)/)
  })

  test('the app runs under that policy without a violation', async ({ page }) => {
    test.skip(
      !usePreview && !isRemote,
      'The dev server sends no policy. Run with E2E_PREVIEW=1 or E2E_BASE_URL.',
    )
    await gotoApp(page)
    await page.getByTestId('btn-example').click()
    await clickPlan(page)
    await openTab(page, 'logs')
    // The page fixture fails the test on any CSP violation logged to the console.
    await expect(page.getByTestId('panel-logs')).toBeVisible()
  })
})

test.describe('saving as someone else', () => {
  test('cannot plant a result: the server plans again from the request', async ({ page }) => {
    await signedInApp(page)
    const tampered = {
      request: exampleRequest(),
      title: 'Planted',
      result: { summary: { distance_miles: 1, days: 1 }, logs: [] },
    }
    const response = await send(page.request, 'POST', '/api/trips', tampered)
    // Either the extra field is ignored (201) or the body is refused (400). It is never used.
    expect([201, 400]).toContain(response.status())
    if (response.status() === 201) {
      const trip = await response.json()
      expect(trip.result.summary.distance_miles).toBeGreaterThan(100)
      expect(trip.result.logs.length).toBeGreaterThan(0)
    }
  })
})
