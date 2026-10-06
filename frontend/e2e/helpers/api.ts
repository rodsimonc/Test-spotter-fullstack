import { expect, type APIRequestContext, type APIResponse } from '@playwright/test'
import type { ApiErrorBody, PlanRequest, PlanResponse, Trip, User } from '../../src/api/types'
import { origin } from './env'

// Direct API calls that share cookies with the browser context they come from
// (`page.request` or `context.request`). Setup that is not under test goes through here
// because it is much faster than clicking through the UI.

/** Fetches a CSRF token. Also makes sure the csrftoken cookie is set. */
export async function csrfToken(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/csrf')
  expect(response.status()).toBe(200)
  const { csrf } = (await response.json()) as { csrf: string }
  return csrf
}

type Method = 'POST' | 'PATCH' | 'DELETE'

/**
 * Sends an unsafe request the way the SPA does. Django also checks Origin or Referer on HTTPS,
 * which a bare request context does not send, so both are added.
 */
export async function send(
  request: APIRequestContext,
  method: Method,
  path: string,
  data?: unknown,
  options: { csrf?: boolean } = {},
): Promise<APIResponse> {
  const headers: Record<string, string> = { Origin: origin, Referer: `${origin}/` }
  if (options.csrf !== false) headers['X-CSRFToken'] = await csrfToken(request)
  return request.fetch(path, { method, data, headers })
}

export async function errorOf(response: APIResponse): Promise<ApiErrorBody['error']> {
  return ((await response.json()) as ApiErrorBody).error
}

export async function planViaApi(
  request: APIRequestContext,
  body: PlanRequest,
): Promise<PlanResponse> {
  const response = await send(request, 'POST', '/api/plan', body)
  expect(response.status(), await response.text()).toBe(200)
  return (await response.json()) as PlanResponse
}

export interface Credentials {
  email: string
  password: string
  name?: string
}

export async function registerViaApi(
  request: APIRequestContext,
  credentials: Credentials,
): Promise<User> {
  const response = await send(request, 'POST', '/api/auth/register', credentials)
  expect(response.status(), await response.text()).toBe(201)
  return ((await response.json()) as { user: User }).user
}

export async function loginViaApi(
  request: APIRequestContext,
  credentials: Pick<Credentials, 'email' | 'password'>,
): Promise<User> {
  const response = await send(request, 'POST', '/api/auth/login', credentials)
  expect(response.status(), await response.text()).toBe(200)
  return ((await response.json()) as { user: User }).user
}

export async function logoutViaApi(request: APIRequestContext): Promise<void> {
  const response = await send(request, 'POST', '/api/auth/logout')
  expect(response.status()).toBe(204)
}

export async function saveTripViaApi(
  request: APIRequestContext,
  body: PlanRequest,
  title?: string,
): Promise<Trip> {
  const response = await send(request, 'POST', '/api/trips', { title, request: body })
  expect(response.status(), await response.text()).toBe(201)
  return (await response.json()) as Trip
}
