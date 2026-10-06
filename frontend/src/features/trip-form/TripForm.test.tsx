import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlanRequest } from '@/api/types'
import { browserTimeZone, isValidDatetimeLocal } from '@/lib/time'
import { geocodeHit, installApi } from '@/test/mockApi'
import { renderWithProviders } from '@/test/render'
import type { PlaceKey } from './formState'
import { TripForm } from './TripForm'
import { useTripForm } from './useTripForm'

interface HarnessProps {
  initial?: PlanRequest
  pending?: boolean
  onPlan?: (request: PlanRequest) => void
}

function Harness({ initial, pending = false, onPlan = () => {} }: HarnessProps) {
  const form = useTripForm(initial)
  const [pick, setPick] = useState<PlaceKey | null>(null)
  return (
    <>
      <TripForm
        form={form}
        pending={pending}
        pickTarget={pick}
        onTogglePick={(key) => setPick((current) => (current === key ? null : key))}
        onSubmit={() => {
          const request = form.validate()
          if (request) onPlan(request)
        }}
      />
      <output data-testid="pick-state">{pick ?? 'none'}</output>
    </>
  )
}

function setup(props: HarnessProps = {}) {
  installApi({
    'GET /api/geocode/search': (call) => ({
      body: {
        results: [
          geocodeHit(`${call.search.get('q')}ville, Texas, United States`, 31, -97, 'Texas'),
        ],
      },
    }),
  })
  renderWithProviders(<Harness {...props} />)
  return userEvent.setup()
}

const field = (key: string) => screen.getByTestId(`field-${key}`) as HTMLInputElement

describe('TripForm', () => {
  it('shows the three places, the hours, the departure and the actions', () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Plan a trip' })).toBeInTheDocument()
    expect(field('current')).toHaveAccessibleName('Current location')
    expect(field('pickup')).toHaveAccessibleName('Pickup')
    expect(field('dropoff')).toHaveAccessibleName('Dropoff')
    expect(screen.getByTestId('input-cycle')).toHaveValue(0)
    expect(screen.getByTestId('slider-cycle')).toBeInTheDocument()
    expect(
      isValidDatetimeLocal((screen.getByTestId('input-departure') as HTMLInputElement).value),
    ).toBe(true)
    expect(screen.getByTestId('btn-plan')).toHaveAttribute('type', 'submit')
    expect(screen.getByTestId('btn-example')).toHaveTextContent('Try an example')
    expect(screen.getByTestId('btn-reset')).toHaveTextContent('Reset')
    expect(screen.getByTestId('btn-swap')).toHaveAccessibleName('Swap pickup and dropoff')
  })

  it('defaults the time zone to the browser zone and lists US zones first', () => {
    setup()
    const select = screen.getByTestId('select-timezone') as HTMLSelectElement
    expect(select.value).toBe(browserTimeZone())
    const groups = select.querySelectorAll('optgroup')
    expect(groups[0]).toHaveAttribute('label', 'United States')
    expect(
      within(groups[0] as HTMLElement).getByRole('option', { name: 'Central (America/Chicago)' }),
    ).toBeInTheDocument()
    // A zone listed under United States is not repeated in the long list.
    expect(within(select).queryAllByRole('option', { name: 'America/Chicago' })).toHaveLength(0)
  })

  it('sends the chosen time zone with the request', async () => {
    const onPlan = vi.fn()
    const user = setup({ onPlan })
    await user.click(screen.getByTestId('btn-example'))
    await user.selectOptions(screen.getByTestId('select-timezone'), 'America/Denver')
    await user.click(screen.getByTestId('btn-plan'))
    expect(onPlan).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'America/Denver' }))
  })

  describe('example trip', () => {
    it('fills Dallas, Memphis and Denver with 24 hours used', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-example'))
      expect(field('current')).toHaveValue('Dallas, Texas, United States')
      expect(field('pickup')).toHaveValue('Memphis, Tennessee, United States')
      expect(field('dropoff')).toHaveValue('Denver, Colorado, United States')
      expect(screen.getByTestId('input-cycle')).toHaveValue(24)
      expect((screen.getByTestId('input-departure') as HTMLInputElement).value).toMatch(/T06:00$/)
    })

    it('plans with exactly those coordinates', async () => {
      const onPlan = vi.fn()
      const user = setup({ onPlan })
      await user.click(screen.getByTestId('btn-example'))
      await user.click(screen.getByTestId('btn-plan'))
      expect(onPlan).toHaveBeenCalledTimes(1)
      const request = onPlan.mock.calls[0][0] as PlanRequest
      expect(request.current).toEqual({
        label: 'Dallas, Texas, United States',
        lat: 32.7767,
        lon: -96.797,
      })
      expect(request.pickup).toMatchObject({ lat: 35.1495, lon: -90.049 })
      expect(request.dropoff).toMatchObject({ lat: 39.7392, lon: -104.9903 })
      expect(request.cycle_used_hours).toBe(24)
      expect(request.departure).toMatch(/^\d{4}-\d{2}-\d{2}T06:00$/)
      expect(request).not.toHaveProperty('header')
    })

    it('clears earlier errors', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-plan'))
      expect(screen.getByTestId('form-error-current')).toBeInTheDocument()
      await user.click(screen.getByTestId('btn-example'))
      expect(screen.queryByTestId('form-error-current')).not.toBeInTheDocument()
    })
  })

  describe('validation', () => {
    it('shows an inline message for each empty place and does not plan', async () => {
      const onPlan = vi.fn()
      const user = setup({ onPlan })
      await user.click(screen.getByTestId('btn-plan'))
      expect(screen.getByTestId('form-error-current')).toHaveTextContent(
        'Add your current location.',
      )
      expect(screen.getByTestId('form-error-pickup')).toHaveTextContent('Add the pickup location.')
      expect(screen.getByTestId('form-error-dropoff')).toHaveTextContent(
        'Add the dropoff location.',
      )
      expect(onPlan).not.toHaveBeenCalled()
    })

    it('moves focus to the first invalid field', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-plan'))
      expect(field('current')).toHaveFocus()
      expect(field('current')).toHaveAttribute('aria-invalid', 'true')
    })

    it('skips fields that are fine and lands on the first bad one', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-example'))
      const cycle = screen.getByTestId('input-cycle')
      await user.clear(cycle)
      await user.type(cycle, '80')
      await user.click(screen.getByTestId('btn-plan'))
      expect(screen.getByTestId('form-error-cycle')).toHaveTextContent('Use a number from 0 to 70.')
      expect(cycle).toHaveFocus()
    })

    it('rejects an empty departure', async () => {
      const onPlan = vi.fn()
      const user = setup({ onPlan })
      await user.click(screen.getByTestId('btn-example'))
      const departure = screen.getByTestId('input-departure')
      fireEvent.change(departure, { target: { value: '' } })
      await user.click(screen.getByTestId('btn-plan'))
      expect(screen.getByTestId('form-error-departure')).toHaveTextContent(
        'Pick a departure date and time.',
      )
      expect(departure).toHaveFocus()
      expect(onPlan).not.toHaveBeenCalled()
    })

    it('asks for a pick when text was typed but no match was chosen', async () => {
      const user = setup()
      await user.type(field('current'), 'Dal')
      await user.keyboard('{Escape}')
      await user.click(screen.getByTestId('btn-plan'))
      expect(screen.getByTestId('form-error-current')).toHaveTextContent(
        'Pick a match from the list, or choose the spot on the map.',
      )
    })

    it('clears a place error as soon as the place changes', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-plan'))
      await user.type(field('current'), 'Da')
      expect(screen.queryByTestId('form-error-current')).not.toBeInTheDocument()
      expect(screen.getByTestId('form-error-pickup')).toBeInTheDocument()
    })

    it('submits from the keyboard with Enter inside a field', async () => {
      const onPlan = vi.fn()
      const user = setup({ onPlan })
      await user.click(screen.getByTestId('btn-example'))
      await user.type(screen.getByTestId('input-cycle'), '{Enter}')
      expect(onPlan).toHaveBeenCalledTimes(1)
    })
  })

  describe('actions', () => {
    it('resets every field', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-example'))
      await user.click(screen.getByTestId('btn-log-details'))
      await user.type(screen.getByTestId('input-driver-name'), 'Dana')
      await user.click(screen.getByTestId('btn-reset'))
      expect(field('current')).toHaveValue('')
      expect(field('pickup')).toHaveValue('')
      expect(field('dropoff')).toHaveValue('')
      expect(screen.getByTestId('input-cycle')).toHaveValue(0)
      expect(screen.getByTestId('input-driver-name')).toHaveValue('')
    })

    it('swaps pickup and dropoff', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-example'))
      await user.click(screen.getByTestId('btn-swap'))
      expect(field('pickup')).toHaveValue('Denver, Colorado, United States')
      expect(field('dropoff')).toHaveValue('Memphis, Tennessee, United States')
    })

    it.each(['current', 'pickup', 'dropoff'] as const)('clears the %s place', async (key) => {
      const user = setup()
      await user.click(screen.getByTestId('btn-example'))
      await user.click(screen.getByTestId(`btn-clear-${key}`))
      expect(field(key)).toHaveValue('')
      expect(field(key)).toHaveFocus()
    })

    it.each(['current', 'pickup', 'dropoff'] as const)(
      'toggles pick-on-map for %s',
      async (key) => {
        const user = setup()
        const button = screen.getByTestId(`btn-pick-${key}`)
        await user.click(button)
        expect(screen.getByTestId('pick-state')).toHaveTextContent(key)
        expect(button).toHaveAttribute('aria-pressed', 'true')
        await user.click(button)
        expect(screen.getByTestId('pick-state')).toHaveTextContent('none')
        expect(button).toHaveAttribute('aria-pressed', 'false')
      },
    )

    it('switches pick mode from one field to another', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-pick-current'))
      await user.click(screen.getByTestId('btn-pick-dropoff'))
      expect(screen.getByTestId('pick-state')).toHaveTextContent('dropoff')
      expect(screen.getByTestId('btn-pick-current')).toHaveAttribute('aria-pressed', 'false')
    })
  })

  describe('pending state', () => {
    it('disables the plan button and says what is happening', () => {
      setup({ pending: true })
      const plan = screen.getByTestId('btn-plan')
      expect(plan).toBeDisabled()
      expect(plan).toHaveAttribute('aria-busy', 'true')
      expect(plan).toHaveTextContent('Planning trip')
    })
  })

  describe('log details', () => {
    it('starts collapsed and opens on click', async () => {
      const user = setup()
      const toggle = screen.getByTestId('btn-log-details')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByTestId('input-driver-name').closest('[inert]')).not.toBeNull()
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('input-driver-name').closest('[inert]')).toBeNull()
      await user.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
    })

    it('has every header field from the spec', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-log-details'))
      for (const id of [
        'input-driver-name',
        'input-co-driver-name',
        'input-carrier-name',
        'input-main-office',
        'input-home-terminal',
        'input-truck-number',
        'input-trailer-number',
        'input-shipper',
        'input-commodity',
        'input-doc-no',
      ]) {
        expect(screen.getByTestId(id)).toBeInTheDocument()
      }
    })

    it('counts filled fields in the summary and sends them trimmed', async () => {
      const onPlan = vi.fn()
      const user = setup({ onPlan })
      await user.click(screen.getByTestId('btn-example'))
      expect(screen.getByTestId('btn-log-details')).toHaveTextContent(
        'Driver, carrier, truck and shipping info',
      )

      await user.click(screen.getByTestId('btn-log-details'))
      await user.type(screen.getByTestId('input-driver-name'), '  Dana Driver ')
      await user.type(screen.getByTestId('input-truck-number'), '101')
      expect(screen.getByTestId('btn-log-details')).toHaveTextContent('2 fields filled in')

      await user.click(screen.getByTestId('btn-plan'))
      expect((onPlan.mock.calls[0][0] as PlanRequest).header).toEqual({
        driver_name: 'Dana Driver',
        truck_number: '101',
      })
    })

    it('uses the singular for one field', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-log-details'))
      await user.type(screen.getByTestId('input-shipper'), 'Acme')
      expect(screen.getByTestId('btn-log-details')).toHaveTextContent('1 field filled in')
    })

    it('caps each field at 120 characters', async () => {
      const user = setup()
      await user.click(screen.getByTestId('btn-log-details'))
      expect(screen.getByTestId('input-carrier-name')).toHaveAttribute('maxlength', '120')
    })
  })
})
