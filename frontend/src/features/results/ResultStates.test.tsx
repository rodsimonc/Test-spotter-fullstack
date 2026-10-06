import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanError, ResultsLoading } from './ResultStates'
import { usePlanningMessage } from './usePlanningMessage'

describe('PlanError', () => {
  it('is an alert with the message', () => {
    render(<PlanError message="No route between those places." />)
    const banner = screen.getByTestId('error-banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent("We couldn't plan that trip")
    expect(banner).toHaveTextContent('No route between those places.')
  })

  it('has no retry button when retrying cannot help', () => {
    render(<PlanError message="Fix the cycle hours." />)
    expect(screen.queryByTestId('btn-retry')).not.toBeInTheDocument()
  })

  it('retries on click', async () => {
    const onRetry = vi.fn()
    render(<PlanError message="The route service is down." onRetry={onRetry} />)
    await userEvent.setup().click(screen.getByTestId('btn-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('btn-retry')).toHaveAccessibleName('Retry')
  })
})

describe('ResultsLoading', () => {
  it('is a polite busy region that says what is happening', () => {
    render(<ResultsLoading message="Finding the route" />)
    const region = screen.getByTestId('loading')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveTextContent('Finding the route')
  })

  it('hides the skeleton blocks from assistive tech', () => {
    render(<ResultsLoading message="Finding the route" />)
    const hidden = screen.getByTestId('loading').querySelectorAll('[aria-hidden="true"]')
    expect(hidden.length).toBeGreaterThan(6)
  })
})

describe('usePlanningMessage', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is null while nothing is planning', () => {
    const { result } = renderHook(() => usePlanningMessage(false))
    expect(result.current).toBeNull()
  })

  it('walks through the steps and stays on the last one', () => {
    const { result } = renderHook(() => usePlanningMessage(true))
    expect(result.current).toBe('Finding the route')
    act(() => void vi.advanceTimersByTime(2200))
    expect(result.current).toBe('Working out drive time')
    act(() => void vi.advanceTimersByTime(2200))
    expect(result.current).toBe('Placing fuel stops and rests')
    act(() => void vi.advanceTimersByTime(2200))
    expect(result.current).toBe('Filling in the log sheets')
    act(() => void vi.advanceTimersByTime(22000))
    expect(result.current).toBe('Filling in the log sheets')
  })

  it('starts over the next time planning begins', () => {
    const { result, rerender } = renderHook(({ active }) => usePlanningMessage(active), {
      initialProps: { active: true },
    })
    act(() => void vi.advanceTimersByTime(4400))
    rerender({ active: false })
    expect(result.current).toBeNull()
    rerender({ active: true })
    expect(result.current).toBe('Finding the route')
  })
})
