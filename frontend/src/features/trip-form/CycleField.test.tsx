import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CycleField } from './CycleField'

function setup(value: string, error?: string) {
  const onChange = vi.fn()
  render(<CycleField value={value} error={error} onChange={onChange} />)
  return {
    onChange,
    number: screen.getByTestId('input-cycle') as HTMLInputElement,
    slider: screen.getByTestId('slider-cycle') as HTMLInputElement,
  }
}

describe('CycleField', () => {
  it('shows the same value in the number box and the slider', () => {
    const { number, slider } = setup('24')
    expect(number).toHaveValue(24)
    expect(slider).toHaveValue('24')
    expect(number).toHaveAccessibleName('Cycle hours used')
    expect(slider).toHaveAccessibleName('Cycle hours used, slider')
  })

  it('allows quarter-hour steps from 0 to 70', () => {
    const { number, slider } = setup('0')
    for (const input of [number, slider]) {
      expect(input).toHaveAttribute('min', '0')
      expect(input).toHaveAttribute('max', '70')
      expect(input).toHaveAttribute('step', '0.25')
    }
  })

  it('writes used and remaining hours', () => {
    setup('24')
    expect(screen.getByText('24 of 70 h used')).toBeInTheDocument()
    expect(screen.getByText('46 h left')).toBeInTheDocument()
  })

  it('trims trailing zeros in decimals', () => {
    setup('0.25')
    expect(screen.getByText('0.25 of 70 h used')).toBeInTheDocument()
    expect(screen.getByText('69.75 h left')).toBeInTheDocument()
  })

  it('gives screen readers one sentence for the slider', () => {
    const { slider } = setup('24.5')
    expect(slider).toHaveAttribute('aria-valuetext', '24.5 of 70 hours used, 45.5 left')
  })

  it('reports typing in the number box as text', () => {
    const { number, onChange } = setup('0')
    fireEvent.change(number, { target: { value: '30.5' } })
    expect(onChange).toHaveBeenCalledWith('30.5')
  })

  it('reports slider moves as text', () => {
    const { slider, onChange } = setup('0')
    fireEvent.change(slider, { target: { value: '30.25' } })
    expect(onChange).toHaveBeenCalledWith('30.25')
  })

  it('pins the slider and the meter at the limits for out-of-range text', () => {
    const { slider } = setup('80')
    expect(slider).toHaveValue('70')
    expect(screen.getByText('70 of 70 h used')).toBeInTheDocument()
    expect(screen.getByText('0 h left')).toBeInTheDocument()
  })

  it('falls back to zero for an empty box', () => {
    const { number, slider } = setup('')
    expect(number).toHaveValue(null)
    expect(slider).toHaveValue('0')
    expect(screen.getByText('0 of 70 h used')).toBeInTheDocument()
  })

  it('flags low remaining hours', () => {
    setup('62')
    expect(screen.getByText('8 h left')).toHaveClass('text-coral-700')
  })

  it('uses the calm color when plenty is left', () => {
    setup('10')
    expect(screen.getByText('60 h left')).toHaveClass('text-teal-700')
  })

  it('ties an error to the number box', () => {
    const { number } = setup('99', 'Use a number from 0 to 70.')
    const message = screen.getByTestId('form-error-cycle')
    expect(message).toHaveTextContent('Use a number from 0 to 70.')
    expect(number).toHaveAttribute('aria-invalid', 'true')
    expect(number.getAttribute('aria-describedby')).toBe(message.id)
  })
})
