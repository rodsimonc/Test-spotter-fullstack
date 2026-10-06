import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { EMPTY_HEADER } from '@/api/types'
import { sampleRequest } from '@/test/makePlan'
import { useTripForm } from './useTripForm'

describe('useTripForm', () => {
  it('starts from a request when one is given', () => {
    const { result } = renderHook(() => useTripForm(sampleRequest))
    expect(result.current.state.current.place).toEqual(sampleRequest.current)
    expect(result.current.state.cycle).toBe('24')
  })

  it('returns null and records errors when the form is invalid', () => {
    const { result } = renderHook(() => useTripForm())
    let request: unknown
    act(() => {
      request = result.current.validate()
    })
    expect(request).toBeNull()
    expect(Object.keys(result.current.errors).sort()).toEqual(['current', 'dropoff', 'pickup'])
    expect(result.current.errorStamp).toBe(1)
  })

  it('returns the request when the form is valid and leaves the stamp alone', () => {
    const { result } = renderHook(() => useTripForm(sampleRequest))
    let request: unknown
    act(() => {
      request = result.current.validate()
    })
    expect(request).toEqual(sampleRequest)
    expect(result.current.errors).toEqual({})
    expect(result.current.errorStamp).toBe(0)
  })

  it('bumps the stamp on every failed validation so focus moves each time', () => {
    const { result } = renderHook(() => useTripForm())
    act(() => void result.current.validate())
    act(() => void result.current.validate())
    expect(result.current.errorStamp).toBe(2)
  })

  it('clears one field error when that field changes', () => {
    const { result } = renderHook(() => useTripForm())
    act(() => void result.current.validate())
    act(() => result.current.setPlace('pickup', { text: 'Mem', place: null }))
    expect(result.current.errors.pickup).toBeUndefined()
    expect(result.current.errors.current).toBeDefined()
  })

  it('clears the dropoff error when the current or pickup place changes', () => {
    const { result } = renderHook(() => useTripForm())
    act(() => void result.current.validate())
    act(() => result.current.setPlace('current', { text: 'Dal', place: null }))
    expect(result.current.errors.dropoff).toBeUndefined()
  })

  it('clears cycle, departure, time zone and header errors on edit', () => {
    const { result } = renderHook(() => useTripForm(sampleRequest))
    act(() => {
      result.current.applyServerErrors({
        cycle_used_hours: ['bad'],
        departure: ['bad'],
        timezone: ['bad'],
        header: ['bad'],
      })
    })
    expect(Object.keys(result.current.errors)).toHaveLength(4)
    act(() => result.current.setCycle('10'))
    act(() => result.current.setDeparture('2026-10-08T06:00'))
    act(() => result.current.setTimezone('America/Denver'))
    act(() => result.current.setHeader('driver_name', 'Dana'))
    expect(result.current.errors).toEqual({})
    expect(result.current.state.header.driver_name).toBe('Dana')
  })

  it('swaps pickup and dropoff and clears both errors', () => {
    const { result } = renderHook(() => useTripForm(sampleRequest))
    act(() => void result.current.applyServerErrors({ pickup: ['x'], dropoff: ['y'] }))
    act(() => result.current.swap())
    expect(result.current.state.pickup.place).toEqual(sampleRequest.dropoff)
    expect(result.current.state.dropoff.place).toEqual(sampleRequest.pickup)
    expect(result.current.errors).toEqual({})
  })

  it('shows API field errors and hands back the ones with no field', () => {
    const { result } = renderHook(() => useTripForm(sampleRequest))
    let unmapped: string[] = []
    act(() => {
      unmapped = result.current.applyServerErrors({
        cycle_used_hours: ['Too high.'],
        other: ['Odd.'],
      })
    })
    expect(result.current.errors.cycle).toBe('Too high.')
    expect(result.current.errorStamp).toBe(1)
    expect(unmapped).toEqual(['Odd.'])
  })

  it('does not move focus when no message maps to a field', () => {
    const { result } = renderHook(() => useTripForm(sampleRequest))
    act(() => void result.current.applyServerErrors({ other: ['Odd.'] }))
    expect(result.current.errorStamp).toBe(0)
  })

  it('loads a saved request and drops old errors', () => {
    const { result } = renderHook(() => useTripForm())
    act(() => void result.current.validate())
    act(() => result.current.loadRequest(sampleRequest))
    expect(result.current.errors).toEqual({})
    expect(result.current.state.dropoff.place).toEqual(sampleRequest.dropoff)
  })

  it('resets to an empty form', () => {
    const { result } = renderHook(() => useTripForm(sampleRequest))
    act(() => result.current.reset())
    expect(result.current.state.current.place).toBeNull()
    expect(result.current.state.cycle).toBe('0')
    expect(result.current.state.header).toEqual(EMPTY_HEADER)
  })

  it('fills the example', () => {
    const { result } = renderHook(() => useTripForm())
    act(() => result.current.loadExample())
    expect(result.current.state.current.text).toContain('Dallas')
    expect(result.current.state.cycle).toBe('24')
  })
})
