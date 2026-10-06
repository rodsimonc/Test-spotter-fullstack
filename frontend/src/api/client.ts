import type { ApiErrorBody } from './types'

/** Error from the API or from reaching it. `status` is 0 when the request never got an answer. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields: Record<string, string[]>
  readonly retryAfter: number | null

  constructor(
    status: number,
    code: string,
    message: string,
    fields: Record<string, string[]> = {},
    retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
    this.retryAfter = retryAfter
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CSRF_COOKIE = 'csrftoken'
const CSRF_HEADER = 'X-CSRFToken'
const DEFAULT_TIMEOUT_MS = 30_000

let csrfToken: string | null = null

function readCsrfCookie(): string | null {
  const entry = document.cookie.split('; ').find((c) => c.startsWith(`${CSRF_COOKIE}=`))
  return entry ? decodeURIComponent(entry.slice(CSRF_COOKIE.length + 1)) : null
}

/** Forget the cached token. Tests use this; the app never needs to. */
export function resetCsrfForTests(): void {
  csrfToken = null
}

/** Fetches `/api/auth/csrf`, which also sets the cookie Django checks the header against. */
export async function refreshCsrf(): Promise<string> {
  const data = await send<{ csrf: string }>('GET', '/api/auth/csrf')
  csrfToken = data.csrf
  return data.csrf
}

async function currentCsrf(): Promise<string> {
  // Django rotates the token on login, so the cookie is the freshest copy.
  return readCsrfCookie() ?? csrfToken ?? (await refreshCsrf())
}

function networkError(): ApiError {
  return new ApiError(
    0,
    'network_error',
    "Can't reach the server. Check your connection and try again.",
  )
}

async function parseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as Partial<ApiErrorBody> | null
  const retryHeader = Number(response.headers.get('Retry-After'))
  const retryAfter = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : null
  const error = body?.error
  if (error && typeof error.code === 'string' && typeof error.message === 'string') {
    return new ApiError(response.status, error.code, error.message, error.fields ?? {}, retryAfter)
  }
  const code = response.status >= 500 ? 'server_error' : 'request_failed'
  const message =
    response.status >= 500
      ? 'The server hit a problem. Try again in a moment.'
      : 'The request failed. Try again.'
  return new ApiError(response.status, code, message, {}, retryAfter)
}

interface SendOptions {
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}

async function send<T>(
  method: string,
  path: string,
  { body, signal, timeoutMs = DEFAULT_TIMEOUT_MS }: SendOptions = {},
  retriedCsrf = false,
): Promise<T> {
  const unsafe = UNSAFE_METHODS.has(method)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (unsafe) headers[CSRF_HEADER] = await currentCsrf()

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  if (signal?.aborted) controller.abort()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new ApiError(0, 'timeout', 'The server took too long to answer. Try again.')
    }
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw networkError()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  if (!response.ok) {
    const apiError = await parseError(response)
    // A stale CSRF token is the one 403 worth a single quiet retry.
    if (unsafe && response.status === 403 && !retriedCsrf) {
      csrfToken = null
      await refreshCsrf()
      return send<T>(method, path, { body, signal, timeoutMs }, true)
    }
    throw apiError
  }

  if (response.status === 204) return undefined as T
  try {
    return (await response.json()) as T
  } catch {
    throw new ApiError(
      response.status,
      'bad_response',
      'The server sent something unexpected. Try again.',
    )
  }
}

export const api = {
  get: <T>(path: string, options?: SendOptions) => send<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: SendOptions) =>
    send<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: SendOptions) =>
    send<T>('PATCH', path, { ...options, body }),
  delete: <T = void>(path: string, options?: SendOptions) => send<T>('DELETE', path, options),
}
