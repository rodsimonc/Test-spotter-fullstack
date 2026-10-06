import { describe, expect, it } from 'vitest'
import { EMPTY_HEADER } from '@/api/types'
import { sampleRequest } from '@/test/makePlan'
import { isValidTimeZone } from '@/lib/time'
import {
  createExampleState,
  createInitialState,
  hasAnyHeader,
  stateFromRequest,
  toPlanRequest,
} from './formState'

const NOW = new Date(2026, 9, 6, 9, 20)

describe('createInitialState', () => {
  it('starts empty with the next quarter hour and a valid zone', () => {
    const state = createInitialState(NOW)
    expect(state.current).toEqual({ text: '', place: null })
    expect(state.cycle).toBe('0')
    expect(state.departure).toBe('2026-10-06T09:30')
    expect(isValidTimeZone(state.timezone)).toBe(true)
    expect(state.header).toEqual(EMPTY_HEADER)
  })

  it('does not share the header object between states', () => {
    const a = createInitialState(NOW)
    const b = createInitialState(NOW)
    expect(a.header).not.toBe(b.header)
  })
})

describe('createExampleState', () => {
  it('is Dallas to Memphis to Denver at 24 hours, leaving at the next 06:00', () => {
    const state = createExampleState(NOW)
    expect(state.current.place).toMatchObject({ lat: 32.7767, lon: -96.797 })
    expect(state.pickup.place).toMatchObject({ lat: 35.1495, lon: -90.049 })
    expect(state.dropoff.place).toMatchObject({ lat: 39.7392, lon: -104.9903 })
    expect(state.current.text).toBe(state.current.place?.label)
    expect(state.cycle).toBe('24')
    expect(state.departure).toBe('2026-10-07T06:00')
  })
})

describe('request conversion', () => {
  it('turns a request into form state and back without loss', () => {
    expect(toPlanRequest(stateFromRequest(sampleRequest))).toEqual(sampleRequest)
  })

  it('trims header values and leaves empty ones out', () => {
    const state = stateFromRequest(sampleRequest)
    state.header = { ...EMPTY_HEADER, driver_name: '  Dana  ', carrier_name: '   ' }
    expect(toPlanRequest(state).header).toEqual({ driver_name: 'Dana' })
  })

  it('omits the header entirely when nothing is filled in', () => {
    expect(toPlanRequest(stateFromRequest(sampleRequest))).not.toHaveProperty('header')
  })

  it('sends cycle hours as a number', () => {
    const state = { ...stateFromRequest(sampleRequest), cycle: '12.25' }
    expect(toPlanRequest(state).cycle_used_hours).toBe(12.25)
  })

  it('fills a partial header from a saved request', () => {
    const state = stateFromRequest({ ...sampleRequest, header: { truck_number: '101' } })
    expect(state.header).toEqual({ ...EMPTY_HEADER, truck_number: '101' })
  })
})

describe('hasAnyHeader', () => {
  it('is false for blanks and whitespace', () => {
    expect(hasAnyHeader(EMPTY_HEADER)).toBe(false)
    expect(hasAnyHeader({ ...EMPTY_HEADER, shipper: '   ' })).toBe(false)
  })

  it('is true once any field has text', () => {
    expect(hasAnyHeader({ ...EMPTY_HEADER, shipper: 'Acme' })).toBe(true)
  })
})
