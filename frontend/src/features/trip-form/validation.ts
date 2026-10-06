import { isValidDatetimeLocal, isValidTimeZone } from '@/lib/time'
import type { FormState, PlaceKey } from './formState'

/** Keys line up with the `form-error-<field>` test ids. */
export type FieldKey = PlaceKey | 'cycle' | 'departure' | 'timezone' | 'header'
export type FormErrors = Partial<Record<FieldKey, string>>

const MISSING: Record<PlaceKey, string> = {
  current: 'Add your current location.',
  pickup: 'Add the pickup location.',
  dropoff: 'Add the dropoff location.',
}

const NOT_PICKED = 'Pick a match from the list, or choose the spot on the map.'

export function validateForm(state: FormState): FormErrors {
  const errors: FormErrors = {}

  for (const key of ['current', 'pickup', 'dropoff'] as const) {
    const value = state[key]
    if (!value.place) errors[key] = value.text.trim() === '' ? MISSING[key] : NOT_PICKED
  }

  const { current, pickup, dropoff } = state
  if (current.place && pickup.place && dropoff.place) {
    const same = (a: typeof current.place, b: typeof current.place) =>
      Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6
    if (same(current.place, pickup.place) && same(pickup.place, dropoff.place)) {
      errors.dropoff = "Current, pickup and dropoff can't all be the same place."
    }
  }

  const cycleText = state.cycle.trim()
  const cycle = Number(cycleText)
  if (cycleText === '') errors.cycle = 'Enter the hours used so far, from 0 to 70.'
  else if (!Number.isFinite(cycle) || cycle < 0 || cycle > 70)
    errors.cycle = 'Use a number from 0 to 70.'

  if (state.departure.trim() === '') errors.departure = 'Pick a departure date and time.'
  else if (!isValidDatetimeLocal(state.departure))
    errors.departure = "That date and time isn't valid."

  if (!isValidTimeZone(state.timezone)) errors.timezone = 'Choose a time zone from the list.'

  return errors
}

/**
 * Maps API validation keys onto form fields. Keys the form has no field for come back in
 * `unmapped`, so the caller can still show them.
 */
export function mapServerErrors(fields: Record<string, string[]>): {
  errors: FormErrors
  unmapped: string[]
} {
  const errors: FormErrors = {}
  const unmapped: string[] = []
  for (const [key, messages] of Object.entries(fields)) {
    const message = messages.join(' ')
    const root = key.split('.')[0]
    if (root === 'current' || root === 'pickup' || root === 'dropoff') {
      errors[root] ??= message
    } else if (root === 'cycle_used_hours') errors.cycle ??= message
    else if (root === 'departure') errors.departure ??= message
    else if (root === 'timezone') errors.timezone ??= message
    else if (root === 'header') errors.header ??= message
    else unmapped.push(message)
  }
  return { errors, unmapped }
}
