import { describe, expect, it } from 'vitest'
import { createExampleState, createInitialState, type FormState } from './formState'
import { mapServerErrors, validateForm } from './validation'

const NOW = new Date(2026, 9, 6, 9, 0)

function validState(): FormState {
  return createExampleState(NOW)
}

describe('validateForm', () => {
  it('passes the example trip', () => {
    expect(validateForm(validState())).toEqual({})
  })

  it('asks for every empty place by name', () => {
    const errors = validateForm(createInitialState(NOW))
    expect(errors.current).toBe('Add your current location.')
    expect(errors.pickup).toBe('Add the pickup location.')
    expect(errors.dropoff).toBe('Add the dropoff location.')
  })

  it('tells people to pick a match when text has no place behind it', () => {
    const state: FormState = { ...validState(), pickup: { text: 'Mem', place: null } }
    expect(validateForm(state).pickup).toBe(
      'Pick a match from the list, or choose the spot on the map.',
    )
  })

  it('treats whitespace as empty', () => {
    const state: FormState = { ...validState(), dropoff: { text: '   ', place: null } }
    expect(validateForm(state).dropoff).toBe('Add the dropoff location.')
  })

  it('rejects the same point for all three places', () => {
    const state = validState()
    const place = state.current.place!
    const same = { text: place.label, place }
    expect(validateForm({ ...state, pickup: same, dropoff: same }).dropoff).toBe(
      "Current, pickup and dropoff can't all be the same place.",
    )
  })

  it('allows two matching places when the third differs', () => {
    const state = validState()
    const place = state.current.place!
    const same = { text: place.label, place }
    expect(validateForm({ ...state, pickup: same })).toEqual({})
  })

  it.each([
    ['0', undefined],
    ['70', undefined],
    ['24.25', undefined],
    [' 12 ', undefined],
    ['', 'Enter the hours used so far, from 0 to 70.'],
    ['  ', 'Enter the hours used so far, from 0 to 70.'],
    ['-0.25', 'Use a number from 0 to 70.'],
    ['70.25', 'Use a number from 0 to 70.'],
    ['abc', 'Use a number from 0 to 70.'],
    ['Infinity', 'Use a number from 0 to 70.'],
    ['1e3', 'Use a number from 0 to 70.'],
  ])('checks cycle hours "%s"', (cycle, message) => {
    expect(validateForm({ ...validState(), cycle }).cycle).toBe(message)
  })

  it('needs a departure', () => {
    expect(validateForm({ ...validState(), departure: '' }).departure).toBe(
      'Pick a departure date and time.',
    )
  })

  it('rejects a departure that is not a real date', () => {
    expect(validateForm({ ...validState(), departure: '2026-02-30T10:00' }).departure).toBe(
      "That date and time isn't valid.",
    )
  })

  it('rejects an unknown time zone', () => {
    expect(validateForm({ ...validState(), timezone: 'Nowhere/Land' }).timezone).toBe(
      'Choose a time zone from the list.',
    )
  })

  it('reports several problems at once', () => {
    const errors = validateForm({ ...createInitialState(NOW), cycle: '99', departure: '' })
    expect(Object.keys(errors).sort()).toEqual([
      'current',
      'cycle',
      'departure',
      'dropoff',
      'pickup',
    ])
  })
})

describe('mapServerErrors', () => {
  it('maps API field names onto form fields', () => {
    const { errors, unmapped } = mapServerErrors({
      cycle_used_hours: ['Must be between 0 and 70.'],
      departure: ['Bad date.'],
      timezone: ['Unknown zone.'],
      'current.lat': ['Out of range.'],
      pickup: ['Required.'],
      'dropoff.label': ['Too long.'],
      'header.driver_name': ['Too long.'],
    })
    expect(errors).toEqual({
      cycle: 'Must be between 0 and 70.',
      departure: 'Bad date.',
      timezone: 'Unknown zone.',
      current: 'Out of range.',
      pickup: 'Required.',
      dropoff: 'Too long.',
      header: 'Too long.',
    })
    expect(unmapped).toEqual([])
  })

  it('joins several messages for one field', () => {
    const { errors } = mapServerErrors({ cycle_used_hours: ['One.', 'Two.'] })
    expect(errors.cycle).toBe('One. Two.')
  })

  it('keeps the first message when two keys land on one field', () => {
    const { errors } = mapServerErrors({
      'current.lat': ['Latitude.'],
      'current.lon': ['Longitude.'],
    })
    expect(errors.current).toBe('Latitude.')
  })

  it('returns messages for keys the form has no field for', () => {
    const { errors, unmapped } = mapServerErrors({
      non_field_errors: ['Current, pickup and dropoff must not all match.'],
    })
    expect(errors).toEqual({})
    expect(unmapped).toEqual(['Current, pickup and dropoff must not all match.'])
  })
})
