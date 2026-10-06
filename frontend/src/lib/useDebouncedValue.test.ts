import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts with the first value at once', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 300))
    expect(result.current).toBe('a')
  })

  it('waits for the delay before taking a new value', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    act(() => void vi.advanceTimersByTime(299))
    expect(result.current).toBe('a')
    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe('b')
  })

  it('restarts the wait on every change, so only the last value lands', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    })
    rerender({ value: 'b' })
    act(() => void vi.advanceTimersByTime(200))
    rerender({ value: 'c' })
    act(() => void vi.advanceTimersByTime(200))
    expect(result.current).toBe('a')
    act(() => void vi.advanceTimersByTime(100))
    expect(result.current).toBe('c')
  })
})
