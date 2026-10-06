// A small fetch double for tests. Routes are keyed "METHOD /path" and every call is recorded,
// so tests can assert on what the app sent (headers, body, order) without a server.
import { vi } from 'vitest'
import type { User } from '@/api/types'

export interface RecordedCall {
  method: string
  path: string
  search: URLSearchParams
  body: unknown
  headers: Headers
  credentials: RequestCredentials | undefined
}

export interface Reply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  /** Sent as the body without JSON encoding, for malformed or empty responses. */
  raw?: string
  /** Makes fetch reject like a dropped connection. */
  networkError?: boolean
}

export type Handler = Reply | ((call: RecordedCall) => Reply | Promise<Reply>)

export interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function toResponse(reply: Reply): Response {
  const status = reply.status ?? 200
  const headers = new Headers(reply.headers)
  if (reply.raw !== undefined) return new Response(reply.raw, { status, headers })
  if (reply.body === undefined || status === 204) return new Response(null, { status, headers })
  headers.set('Content-Type', 'application/json')
  return new Response(JSON.stringify(reply.body), { status, headers })
}

export function installApi(routes: Record<string, Handler> = {}) {
  const table = new Map<string, Handler>(Object.entries(routes))
  const calls: RecordedCall[] = []

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init.method ?? 'GET').toUpperCase()
    const call: RecordedCall = {
      method,
      path: url.pathname,
      search: url.searchParams,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: new Headers(init.headers),
      credentials: init.credentials,
    }
    calls.push(call)

    // Like the real fetch: an already-aborted signal rejects before anything is sent.
    if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    const aborted = new Promise<never>((_, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      )
    })
    const handle = async (): Promise<Reply> => {
      const handler = table.get(`${method} ${url.pathname}`)
      if (!handler) {
        return {
          status: 404,
          body: { error: { code: 'not_found', message: `No mock for ${method} ${url.pathname}` } },
        }
      }
      return typeof handler === 'function' ? handler(call) : handler
    }

    const reply = await Promise.race([handle(), aborted])
    if (reply.networkError) throw new TypeError('Failed to fetch')
    return toResponse(reply)
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    calls,
    fetchMock,
    callsTo: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key),
    on: (key: string, handler: Handler) => {
      table.set(key, handler)
    },
  }
}

export type MockApi = ReturnType<typeof installApi>

/** The two calls every page load makes. */
export function sessionRoutes(user: User | null = null): Record<string, Handler> {
  return {
    'GET /api/auth/csrf': { body: { csrf: 'test-csrf' } },
    'GET /api/auth/me': { body: { user } },
  }
}

export function apiError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
): Reply {
  return { status, body: { error: { code, message, ...(fields ? { fields } : {}) } } }
}

export function geocodeHit(label: string, lat: number, lon: number, detail = '') {
  return { label, lat, lon, detail }
}
