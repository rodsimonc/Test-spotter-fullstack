import { EMPTY_HEADER, type LogHeader, type Place, type PlanRequest } from '@/api/types'
import { isValidDatetimeLocal, isValidTimeZone } from '@/lib/time'

/** Query parameter that carries a trip: `/?trip=<base64url JSON of PlanRequest>`. */
export const SHARE_PARAM = 'trip'

const MAX_ENCODED_LENGTH = 8000
const MAX_LABEL = 200
const MAX_HEADER_VALUE = 120

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

function slimPlace(place: Place): Place {
  return { label: place.label, lat: roundCoord(place.lat), lon: roundCoord(place.lon) }
}

/** Drops empty header fields so links stay short. */
function slimHeader(header: Partial<LogHeader> | undefined): Partial<LogHeader> | undefined {
  if (!header) return undefined
  const kept = Object.entries(header).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
  return kept.length ? (Object.fromEntries(kept) as Partial<LogHeader>) : undefined
}

export function encodeTrip(request: PlanRequest): string {
  const slim: PlanRequest = {
    current: slimPlace(request.current),
    pickup: slimPlace(request.pickup),
    dropoff: slimPlace(request.dropoff),
    cycle_used_hours: request.cycle_used_hours,
    departure: request.departure,
    timezone: request.timezone,
  }
  const header = slimHeader(request.header)
  if (header) slim.header = header
  return toBase64Url(JSON.stringify(slim))
}

export function buildShareUrl(
  request: PlanRequest,
  location: Pick<Location, 'origin' | 'pathname'>,
): string {
  return `${location.origin}${location.pathname}?${SHARE_PARAM}=${encodeTrip(request)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePlace(value: unknown): Place | null {
  if (!isRecord(value)) return null
  const { label, lat, lon } = value
  if (typeof label !== 'string' || label.trim() === '' || label.length > MAX_LABEL) return null
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return null
  return { label, lat, lon }
}

function parseHeader(value: unknown): Partial<LogHeader> | undefined | null {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  const header: Partial<LogHeader> = {}
  for (const key of Object.keys(EMPTY_HEADER) as (keyof LogHeader)[]) {
    const entry = value[key]
    if (entry === undefined) continue
    if (typeof entry !== 'string' || entry.length > MAX_HEADER_VALUE) return null
    header[key] = entry
  }
  return header
}

/** Checks an untrusted object (a share link, say) and returns a clean PlanRequest or null. */
export function parsePlanRequest(value: unknown): PlanRequest | null {
  if (!isRecord(value)) return null
  const current = parsePlace(value.current)
  const pickup = parsePlace(value.pickup)
  const dropoff = parsePlace(value.dropoff)
  if (!current || !pickup || !dropoff) return null

  const cycle = value.cycle_used_hours
  if (typeof cycle !== 'number' || !Number.isFinite(cycle) || cycle < 0 || cycle > 70) return null

  const { departure, timezone } = value
  if (typeof departure !== 'string' || !isValidDatetimeLocal(departure)) return null
  if (typeof timezone !== 'string' || !isValidTimeZone(timezone)) return null

  const header = parseHeader(value.header)
  if (header === null) return null

  const request: PlanRequest = {
    current,
    pickup,
    dropoff,
    cycle_used_hours: cycle,
    departure,
    timezone,
  }
  if (header) request.header = header
  return request
}

/** Returns the trip carried by a share param, or null if it is missing or damaged. */
export function decodeTrip(encoded: string): PlanRequest | null {
  if (!encoded || encoded.length > MAX_ENCODED_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null
  }
  try {
    return parsePlanRequest(JSON.parse(fromBase64Url(encoded)))
  } catch {
    return null
  }
}

/** Reads `?trip=` from a search string. `null` means no param, `'invalid'` means it is damaged. */
export function readSharedTrip(search: string): PlanRequest | 'invalid' | null {
  const raw = new URLSearchParams(search).get(SHARE_PARAM)
  if (raw === null) return null
  return decodeTrip(raw) ?? 'invalid'
}
