import { EMPTY_HEADER, type LogHeader, type Place, type PlanRequest } from '@/api/types'
import { browserTimeZone, nextQuarterHour, nextSixAm } from '@/lib/time'

export type PlaceKey = 'current' | 'pickup' | 'dropoff'
export const PLACE_KEYS: PlaceKey[] = ['current', 'pickup', 'dropoff']

/** What the user sees in a place field, and the place behind it once they pick a match. */
export interface PlaceValue {
  text: string
  place: Place | null
}

export interface FormState {
  current: PlaceValue
  pickup: PlaceValue
  dropoff: PlaceValue
  /** Kept as text so the field can be empty or half-typed. */
  cycle: string
  /** `datetime-local` value, wall-clock time at the home terminal. */
  departure: string
  timezone: string
  header: LogHeader
}

export const EMPTY_PLACE: PlaceValue = { text: '', place: null }

export function createInitialState(now: Date = new Date()): FormState {
  return {
    current: EMPTY_PLACE,
    pickup: EMPTY_PLACE,
    dropoff: EMPTY_PLACE,
    cycle: '0',
    departure: nextQuarterHour(now),
    timezone: browserTimeZone(),
    header: { ...EMPTY_HEADER },
  }
}

function pickedPlace(place: Place): PlaceValue {
  return { text: place.label, place }
}

/** Dallas to Memphis to Denver, 24 hours into the cycle, leaving at the next 06:00. */
export function createExampleState(now: Date = new Date()): FormState {
  return {
    ...createInitialState(now),
    current: pickedPlace({ label: 'Dallas, Texas, United States', lat: 32.7767, lon: -96.797 }),
    pickup: pickedPlace({ label: 'Memphis, Tennessee, United States', lat: 35.1495, lon: -90.049 }),
    dropoff: pickedPlace({
      label: 'Denver, Colorado, United States',
      lat: 39.7392,
      lon: -104.9903,
    }),
    cycle: '24',
    departure: nextSixAm(now),
  }
}

export function stateFromRequest(request: PlanRequest): FormState {
  return {
    current: pickedPlace(request.current),
    pickup: pickedPlace(request.pickup),
    dropoff: pickedPlace(request.dropoff),
    cycle: String(request.cycle_used_hours),
    departure: request.departure,
    timezone: request.timezone,
    header: { ...EMPTY_HEADER, ...request.header },
  }
}

/** Builds the API body. Call it only after validation passed. */
export function toPlanRequest(state: FormState): PlanRequest {
  const header = Object.fromEntries(
    Object.entries(state.header)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value !== ''),
  ) as Partial<LogHeader>

  const request: PlanRequest = {
    current: state.current.place!,
    pickup: state.pickup.place!,
    dropoff: state.dropoff.place!,
    cycle_used_hours: Number(state.cycle),
    departure: state.departure,
    timezone: state.timezone,
  }
  if (Object.keys(header).length > 0) request.header = header
  return request
}

export function hasAnyHeader(header: LogHeader): boolean {
  return Object.values(header).some((value) => value.trim() !== '')
}
