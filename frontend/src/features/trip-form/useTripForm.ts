import { useCallback, useMemo, useReducer, useState } from 'react'
import type { LogHeader, PlanRequest } from '@/api/types'
import {
  createExampleState,
  createInitialState,
  stateFromRequest,
  toPlanRequest,
  type FormState,
  type PlaceKey,
  type PlaceValue,
} from './formState'
import { mapServerErrors, validateForm, type FieldKey, type FormErrors } from './validation'

type Action =
  | { type: 'place'; key: PlaceKey; value: PlaceValue }
  | { type: 'cycle'; value: string }
  | { type: 'departure'; value: string }
  | { type: 'timezone'; value: string }
  | { type: 'header'; key: keyof LogHeader; value: string }
  | { type: 'swap' }
  | { type: 'replace'; state: FormState }

function reducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case 'place':
      return { ...state, [action.key]: action.value }
    case 'cycle':
      return { ...state, cycle: action.value }
    case 'departure':
      return { ...state, departure: action.value }
    case 'timezone':
      return { ...state, timezone: action.value }
    case 'header':
      return { ...state, header: { ...state.header, [action.key]: action.value } }
    case 'swap':
      return { ...state, pickup: state.dropoff, dropoff: state.pickup }
    case 'replace':
      return action.state
  }
}

export interface TripFormApi {
  state: FormState
  errors: FormErrors
  /** Bumps whenever errors are set, so the form can move focus to the first bad field. */
  errorStamp: number
  setPlace: (key: PlaceKey, value: PlaceValue) => void
  setCycle: (value: string) => void
  setDeparture: (value: string) => void
  setTimezone: (value: string) => void
  setHeader: (key: keyof LogHeader, value: string) => void
  swap: () => void
  reset: () => void
  loadExample: () => void
  loadRequest: (request: PlanRequest) => void
  /** Returns the request when the form is valid. Otherwise records errors and returns null. */
  validate: () => PlanRequest | null
  /** Shows API field errors on the form. Returns messages that match no field. */
  applyServerErrors: (fields: Record<string, string[]>) => string[]
}

export function useTripForm(initial?: PlanRequest): TripFormApi {
  const [state, dispatch] = useReducer(reducer, initial, (request) =>
    request ? stateFromRequest(request) : createInitialState(),
  )
  const [errors, setErrors] = useState<FormErrors>({})
  const [errorStamp, setErrorStamp] = useState(0)

  const clearError = useCallback((key: FieldKey) => {
    setErrors((current) => {
      if (!(key in current)) return current
      const { [key]: _removed, ...rest } = current
      return rest
    })
  }, [])

  const replace = useCallback((next: FormState) => {
    dispatch({ type: 'replace', state: next })
    setErrors({})
  }, [])

  return useMemo<TripFormApi>(
    () => ({
      state,
      errors,
      errorStamp,
      setPlace: (key, value) => {
        dispatch({ type: 'place', key, value })
        clearError(key)
        if (key === 'pickup' || key === 'current') clearError('dropoff')
      },
      setCycle: (value) => {
        dispatch({ type: 'cycle', value })
        clearError('cycle')
      },
      setDeparture: (value) => {
        dispatch({ type: 'departure', value })
        clearError('departure')
      },
      setTimezone: (value) => {
        dispatch({ type: 'timezone', value })
        clearError('timezone')
      },
      setHeader: (key, value) => {
        dispatch({ type: 'header', key, value })
        clearError('header')
      },
      swap: () => {
        dispatch({ type: 'swap' })
        clearError('pickup')
        clearError('dropoff')
      },
      reset: () => replace(createInitialState()),
      loadExample: () => replace(createExampleState()),
      loadRequest: (request) => replace(stateFromRequest(request)),
      validate: () => {
        const found = validateForm(state)
        setErrors(found)
        if (Object.keys(found).length > 0) {
          setErrorStamp((n) => n + 1)
          return null
        }
        return toPlanRequest(state)
      },
      applyServerErrors: (fields) => {
        const { errors: mapped, unmapped } = mapServerErrors(fields)
        setErrors(mapped)
        if (Object.keys(mapped).length > 0) setErrorStamp((n) => n + 1)
        return unmapped
      },
    }),
    [state, errors, errorStamp, clearError, replace],
  )
}
