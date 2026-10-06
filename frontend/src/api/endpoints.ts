import { api, refreshCsrf } from './client'
import type {
  GeocodeResult,
  Place,
  PlanRequest,
  PlanResponse,
  Trip,
  TripSummary,
  User,
} from './types'

// Leans typeahead results toward the middle of the contiguous US without filtering anything out.
const SEARCH_BIAS = { lat: 39.5, lon: -98.35 }
const PLAN_TIMEOUT_MS = 45_000

export async function bootstrapSession(): Promise<User | null> {
  await refreshCsrf()
  const data = await api.get<{ user: User | null }>('/api/auth/me')
  return data.user
}

export async function login(input: { email: string; password: string }): Promise<User> {
  const data = await api.post<{ user: User }>('/api/auth/login', input)
  return data.user
}

export async function register(input: {
  email: string
  password: string
  name?: string
}): Promise<User> {
  const data = await api.post<{ user: User }>('/api/auth/register', input)
  return data.user
}

export function logout(): Promise<void> {
  return api.post<void>('/api/auth/logout')
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: '6',
    lat: String(SEARCH_BIAS.lat),
    lon: String(SEARCH_BIAS.lon),
  })
  const data = await api.get<{ results: GeocodeResult[] }>(`/api/geocode/search?${params}`, {
    signal,
  })
  return data.results
}

export async function reversePlace(lat: number, lon: number): Promise<Place> {
  const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6) })
  const data = await api.get<{ place: Place }>(`/api/geocode/reverse?${params}`)
  return data.place
}

export function planTrip(request: PlanRequest, signal?: AbortSignal): Promise<PlanResponse> {
  return api.post<PlanResponse>('/api/plan', request, { signal, timeoutMs: PLAN_TIMEOUT_MS })
}

export async function listTrips(): Promise<{ results: TripSummary[]; count: number }> {
  return api.get('/api/trips?limit=100')
}

export function getTrip(id: string): Promise<Trip> {
  return api.get<Trip>(`/api/trips/${encodeURIComponent(id)}`)
}

export function createTrip(input: { title?: string; request: PlanRequest }): Promise<Trip> {
  return api.post<Trip>('/api/trips', input, { timeoutMs: PLAN_TIMEOUT_MS })
}

export function renameTrip(id: string, title: string): Promise<Trip> {
  return api.patch<Trip>(`/api/trips/${encodeURIComponent(id)}`, { title })
}

export function deleteTrip(id: string): Promise<void> {
  return api.delete(`/api/trips/${encodeURIComponent(id)}`)
}
