import { describe, expect, it } from 'vitest'
import type { PlanRequest } from '@/api/types'
import { sampleRequest } from '@/test/makePlan'
import {
  buildShareUrl,
  decodeTrip,
  encodeTrip,
  parsePlanRequest,
  readSharedTrip,
  SHARE_PARAM,
} from './share'

function b64url(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function encodeRaw(value: unknown): string {
  return b64url(JSON.stringify(value))
}

function withChange(change: Record<string, unknown>): string {
  return encodeRaw({ ...sampleRequest, ...change })
}

describe('share link round trip', () => {
  it('decodes what it encoded', () => {
    expect(decodeTrip(encodeTrip(sampleRequest))).toEqual(sampleRequest)
  })

  it('keeps unicode place names intact', () => {
    const request: PlanRequest = {
      ...sampleRequest,
      current: { label: 'São Paulo, Brasil', lat: -23.55052, lon: -46.63331 },
      dropoff: { label: '北京, 中国', lat: 39.9042, lon: 116.4074 },
    }
    expect(decodeTrip(encodeTrip(request))).toEqual(request)
  })

  it('carries filled header fields and drops empty ones', () => {
    const request: PlanRequest = {
      ...sampleRequest,
      header: { driver_name: 'Dana Driver', carrier_name: '  ', truck_number: '101' },
    }
    const decoded = decodeTrip(encodeTrip(request))
    expect(decoded?.header).toEqual({ driver_name: 'Dana Driver', truck_number: '101' })
  })

  it('leaves the header out when nothing is filled in', () => {
    const decoded = decodeTrip(encodeTrip({ ...sampleRequest, header: { driver_name: '' } }))
    expect(decoded).not.toBeNull()
    expect(decoded).not.toHaveProperty('header')
  })

  it('rounds coordinates to five decimals so links stay short', () => {
    const request: PlanRequest = {
      ...sampleRequest,
      current: { label: 'Dallas', lat: 32.776664123, lon: -96.796987654 },
    }
    expect(decodeTrip(encodeTrip(request))?.current).toEqual({
      label: 'Dallas',
      lat: 32.77666,
      lon: -96.79699,
    })
  })

  it('uses only URL-safe characters', () => {
    const request = {
      ...sampleRequest,
      current: { ...sampleRequest.current, label: '???>>>~~~ ÿÿÿ' },
    }
    expect(encodeTrip(request)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('builds a link on the current origin and path', () => {
    const url = buildShareUrl(sampleRequest, { origin: 'https://planner.example', pathname: '/' })
    expect(url.startsWith(`https://planner.example/?${SHARE_PARAM}=`)).toBe(true)
    const param = new URL(url).searchParams.get(SHARE_PARAM)
    expect(decodeTrip(param ?? '')).toEqual(sampleRequest)
  })
})

describe('share link with hostile or broken input', () => {
  it.each([
    ['an empty string', ''],
    ['characters outside base64url', 'abc+def/ghi=='],
    ['markup', '<script>alert(1)</script>'],
    ['a path traversal', '../../etc/passwd'],
    ['plain text that is valid base64url', 'aGVsbG8'],
    ['input over the length cap', 'A'.repeat(8001)],
  ])('rejects %s', (_name, value) => {
    expect(decodeTrip(value)).toBeNull()
  })

  it('rejects bytes that are not valid UTF-8', () => {
    const bad = btoa(String.fromCharCode(0xff, 0xfe, 0xfd)).replace(/=+$/, '')
    expect(decodeTrip(bad)).toBeNull()
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'hello'],
    ['a number', 42],
  ])('rejects JSON that is %s', (_name, value) => {
    expect(decodeTrip(encodeRaw(value))).toBeNull()
  })

  it('rejects a request with a missing place', () => {
    const { pickup: _pickup, ...rest } = sampleRequest
    expect(decodeTrip(encodeRaw(rest))).toBeNull()
  })

  it.each([
    ['latitude above 90', { current: { label: 'X', lat: 91, lon: 0 } }],
    ['latitude below -90', { current: { label: 'X', lat: -90.5, lon: 0 } }],
    ['longitude above 180', { pickup: { label: 'X', lat: 0, lon: 181 } }],
    ['a string latitude', { dropoff: { label: 'X', lat: '10', lon: 0 } }],
    ['an empty label', { current: { label: '  ', lat: 1, lon: 1 } }],
    ['a label over 200 characters', { current: { label: 'x'.repeat(201), lat: 1, lon: 1 } }],
    ['a numeric label', { current: { label: 5, lat: 1, lon: 1 } }],
    ['a place that is a string', { current: 'Dallas' }],
    ['cycle hours above 70', { cycle_used_hours: 70.25 }],
    ['negative cycle hours', { cycle_used_hours: -1 }],
    ['cycle hours as text', { cycle_used_hours: '24' }],
    ['a departure that is not a date', { departure: 'tomorrow' }],
    ['a departure on February 30', { departure: '2026-02-30T10:00' }],
    ['a departure with an offset', { departure: '2026-10-07T06:00:00-05:00' }],
    ['an unknown time zone', { timezone: 'Mars/Olympus_Mons' }],
    ['an empty time zone', { timezone: '' }],
    ['a header that is a list', { header: ['driver'] }],
    ['a header value that is a number', { header: { driver_name: 5 } }],
    ['a header value over 120 characters', { header: { driver_name: 'd'.repeat(121) } }],
  ])('rejects %s', (_name, change) => {
    expect(decodeTrip(withChange(change))).toBeNull()
  })

  it('accepts the cycle limits exactly', () => {
    expect(decodeTrip(withChange({ cycle_used_hours: 0 }))?.cycle_used_hours).toBe(0)
    expect(decodeTrip(withChange({ cycle_used_hours: 70 }))?.cycle_used_hours).toBe(70)
  })

  it('drops keys it does not know', () => {
    const decoded = decodeTrip(withChange({ is_admin: true, extra: { deep: 1 } }))
    expect(decoded).not.toBeNull()
    expect(Object.keys(decoded ?? {}).sort()).toEqual(
      ['current', 'cycle_used_hours', 'departure', 'dropoff', 'pickup', 'timezone'].sort(),
    )
  })

  it('does not let a __proto__ key reach Object.prototype', () => {
    const payload = `{"__proto__":{"polluted":true},"current":${JSON.stringify(sampleRequest.current)},"pickup":${JSON.stringify(sampleRequest.pickup)},"dropoff":${JSON.stringify(sampleRequest.dropoff)},"cycle_used_hours":10,"departure":"2026-10-07T06:00","timezone":"America/Chicago","header":{"__proto__":{"polluted":true}}}`
    const decoded = decodeTrip(b64url(payload))
    expect(decoded).not.toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(decoded).not.toHaveProperty('polluted')
  })

  it('keeps markup in a label as a plain string for React to escape', () => {
    const label = '<img src=x onerror=alert(1)>'
    const decoded = decodeTrip(withChange({ current: { label, lat: 1, lon: 1 } }))
    expect(decoded?.current.label).toBe(label)
  })
})

describe('parsePlanRequest', () => {
  it('returns a clean copy of a valid request', () => {
    expect(parsePlanRequest(sampleRequest)).toEqual(sampleRequest)
  })

  it('rejects a non-object', () => {
    expect(parsePlanRequest(undefined)).toBeNull()
  })
})

describe('readSharedTrip', () => {
  it('returns null when there is no trip parameter', () => {
    expect(readSharedTrip('')).toBeNull()
    expect(readSharedTrip('?other=1')).toBeNull()
  })

  it('returns the request for a good link', () => {
    expect(readSharedTrip(`?trip=${encodeTrip(sampleRequest)}`)).toEqual(sampleRequest)
  })

  it('flags a damaged or empty parameter as invalid', () => {
    expect(readSharedTrip('?trip=%%%')).toBe('invalid')
    expect(readSharedTrip('?trip=')).toBe('invalid')
    expect(readSharedTrip('?trip=aGVsbG8')).toBe('invalid')
  })
})
