import { describe, expect, it } from 'vitest'
import { ApiError, api, refreshCsrf, resetCsrfForTests } from './client'
import { apiError, deferred, installApi, sessionRoutes } from '@/test/mockApi'

const CSRF_ROUTE = { 'GET /api/auth/csrf': { body: { csrf: 'token-from-api' } } }

describe('requests', () => {
  it('sends same-origin credentials and asks for JSON', async () => {
    const mock = installApi({ 'GET /api/health': { body: { status: 'ok' } } })
    await api.get('/api/health')
    const [call] = mock.calls
    expect(call.credentials).toBe('same-origin')
    expect(call.headers.get('Accept')).toBe('application/json')
  })

  it('leaves the CSRF header and content type off a plain GET', async () => {
    const mock = installApi({ 'GET /api/health': { body: {} } })
    await api.get('/api/health')
    expect(mock.calls[0].headers.has('X-CSRFToken')).toBe(false)
    expect(mock.calls[0].headers.has('Content-Type')).toBe(false)
  })

  it('sends a JSON body with a content type', async () => {
    const mock = installApi({ ...CSRF_ROUTE, 'POST /api/plan': { body: { ok: true } } })
    await api.post('/api/plan', { a: 1 })
    const post = mock.callsTo('POST /api/plan')[0]
    expect(post.headers.get('Content-Type')).toBe('application/json')
    expect(post.body).toEqual({ a: 1 })
  })

  it('returns undefined for 204', async () => {
    installApi({ ...CSRF_ROUTE, 'POST /api/auth/logout': { status: 204 } })
    await expect(api.post('/api/auth/logout')).resolves.toBeUndefined()
  })
})

describe('CSRF', () => {
  it.each([
    ['POST', (p: string) => api.post(p, {})],
    ['PATCH', (p: string) => api.patch(p, {})],
    ['DELETE', (p: string) => api.delete(p)],
  ])('adds the token header on %s, fetched once from the API', async (method, run) => {
    const mock = installApi({
      ...CSRF_ROUTE,
      [`${method} /api/thing`]: { body: {} },
    })
    await run('/api/thing')
    await run('/api/thing')
    expect(mock.callsTo(`${method} /api/thing`).map((c) => c.headers.get('X-CSRFToken'))).toEqual([
      'token-from-api',
      'token-from-api',
    ])
    expect(mock.callsTo('GET /api/auth/csrf')).toHaveLength(1)
  })

  it('prefers the cookie, because Django rotates the token on login', async () => {
    document.cookie = 'csrftoken=cookie%20value; path=/'
    const mock = installApi({ 'POST /api/plan': { body: {} } })
    await api.post('/api/plan', {})
    expect(mock.calls[0].headers.get('X-CSRFToken')).toBe('cookie value')
    expect(mock.callsTo('GET /api/auth/csrf')).toHaveLength(0)
  })

  it('does not put the token on safe methods even when it has one', async () => {
    document.cookie = 'csrftoken=abc; path=/'
    const mock = installApi({ 'GET /api/trips': { body: { results: [], count: 0 } } })
    await api.get('/api/trips')
    expect(mock.calls[0].headers.has('X-CSRFToken')).toBe(false)
  })

  it('refreshes the token and retries once after a 403', async () => {
    let tokens = 0
    let posts = 0
    const mock = installApi({
      'GET /api/auth/csrf': () => ({ body: { csrf: `token-${++tokens}` } }),
      'POST /api/plan': (call) => {
        posts += 1
        return call.headers.get('X-CSRFToken') === 'token-2'
          ? { body: { ok: true } }
          : apiError(403, 'forbidden', 'CSRF check failed.')
      },
    })
    await expect(api.post('/api/plan', {})).resolves.toEqual({ ok: true })
    expect(posts).toBe(2)
    expect(mock.callsTo('GET /api/auth/csrf')).toHaveLength(2)
  })

  it('gives up after one retry', async () => {
    const mock = installApi({
      ...CSRF_ROUTE,
      'POST /api/plan': apiError(403, 'forbidden', 'CSRF check failed.'),
    })
    await expect(api.post('/api/plan', {})).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    })
    expect(mock.callsTo('POST /api/plan')).toHaveLength(2)
  })

  it('does not retry a 403 on a GET', async () => {
    const mock = installApi({ 'GET /api/trips': apiError(403, 'forbidden', 'No.') })
    await expect(api.get('/api/trips')).rejects.toMatchObject({ status: 403 })
    expect(mock.calls).toHaveLength(1)
  })

  it('exposes refreshCsrf for the page-load handshake', async () => {
    installApi(CSRF_ROUTE)
    await expect(refreshCsrf()).resolves.toBe('token-from-api')
  })

  it('forgets a cached token when asked', async () => {
    const mock = installApi({ ...CSRF_ROUTE, 'POST /api/plan': { body: {} } })
    await api.post('/api/plan', {})
    resetCsrfForTests()
    await api.post('/api/plan', {})
    expect(mock.callsTo('GET /api/auth/csrf')).toHaveLength(2)
  })
})

describe('error bodies', () => {
  it('parses the documented error shape, fields included', async () => {
    installApi({
      'GET /api/x': apiError(400, 'validation_error', 'Check the highlighted fields.', {
        cycle_used_hours: ['Must be between 0 and 70.'],
      }),
    })
    const error = await api.get('/api/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'validation_error',
      message: 'Check the highlighted fields.',
      fields: { cycle_used_hours: ['Must be between 0 and 70.'] },
      retryAfter: null,
    })
  })

  it('treats 401 as an ApiError the caller can branch on', async () => {
    installApi({
      'GET /api/trips': apiError(401, 'not_authenticated', 'Sign in to see your trips.'),
    })
    await expect(api.get('/api/trips')).rejects.toMatchObject({
      status: 401,
      code: 'not_authenticated',
      message: 'Sign in to see your trips.',
    })
  })

  it('reads Retry-After from a throttled response', async () => {
    installApi({
      'GET /api/x': {
        status: 429,
        headers: { 'Retry-After': '17' },
        body: { error: { code: 'throttled', message: 'Slow down.' } },
      },
    })
    await expect(api.get('/api/x')).rejects.toMatchObject({
      status: 429,
      code: 'throttled',
      retryAfter: 17,
    })
  })

  it('ignores a Retry-After it cannot use', async () => {
    installApi({
      'GET /api/x': {
        status: 429,
        headers: { 'Retry-After': 'soon' },
        body: { error: { code: 'throttled', message: 'Slow.' } },
      },
    })
    await expect(api.get('/api/x')).rejects.toMatchObject({ retryAfter: null })
  })

  it('writes a plain message for an HTML 500 page', async () => {
    installApi({ 'GET /api/x': { status: 500, raw: '<html>Server Error</html>' } })
    const error = (await api.get('/api/x').catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('server_error')
    expect(error.status).toBe(500)
    expect(error.message).toBe('The server hit a problem. Try again in a moment.')
    expect(error.message).not.toContain('html')
  })

  it('writes a plain message for a non-JSON 4xx', async () => {
    installApi({ 'GET /api/x': { status: 413, raw: 'too big' } })
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'request_failed', status: 413 })
  })

  it('rejects an error body missing the code or message', async () => {
    installApi({ 'GET /api/x': { status: 400, body: { error: { code: 5 } } } })
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'request_failed' })
  })

  it('reports an unreadable success body', async () => {
    installApi({ 'GET /api/x': { status: 200, raw: 'not json' } })
    await expect(api.get('/api/x')).rejects.toMatchObject({ code: 'bad_response' })
  })
})

describe('network trouble', () => {
  it('reports a dropped connection with status 0', async () => {
    installApi({ 'GET /api/x': { networkError: true } })
    await expect(api.get('/api/x')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('reports a timeout', async () => {
    const never = deferred<never>()
    installApi({ 'GET /api/x': () => never.promise })
    await expect(api.get('/api/x', { timeoutMs: 20 })).rejects.toMatchObject({
      status: 0,
      code: 'timeout',
    })
  })

  it('passes a caller abort through as an AbortError, not an ApiError', async () => {
    const never = deferred<never>()
    installApi({ 'GET /api/x': () => never.promise })
    const controller = new AbortController()
    const pending = api.get('/api/x', { signal: controller.signal })
    controller.abort()
    const error = await pending.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DOMException)
    expect(error).toMatchObject({ name: 'AbortError' })
  })

  it('rejects at once when the signal is already aborted', async () => {
    installApi({ 'GET /api/x': { body: {} } })
    const controller = new AbortController()
    controller.abort()
    await expect(api.get('/api/x', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

describe('session routes', () => {
  it('are available to other tests', async () => {
    installApi(sessionRoutes({ id: 1, email: 'a@b.co', name: '' }))
    await expect(api.get('/api/auth/me')).resolves.toEqual({
      user: { id: 1, email: 'a@b.co', name: '' },
    })
  })
})
