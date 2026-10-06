import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Crosshair, MapPin, SearchX, TriangleAlert, X } from 'lucide-react'
import clsx from 'clsx'
import { usePlaceSearch } from '@/api/hooks'
import type { GeocodeResult } from '@/api/types'
import { FieldError, FieldLabel } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { placeCity } from '@/lib/format'
import type { PlaceKey, PlaceValue } from './formState'

export const SEARCH_DELAY_MS = 300
export const MIN_QUERY_LENGTH = 2

interface PlaceFieldProps {
  field: PlaceKey
  label: string
  placeholder: string
  value: PlaceValue
  error?: string
  picking: boolean
  onChange: (value: PlaceValue) => void
  onTogglePick: () => void
}

function optionKey(result: GeocodeResult): string {
  return `${result.lat},${result.lon},${result.label}`
}

/** Second line of a suggestion: the API's detail, or the label minus its first part. */
function secondary(result: GeocodeResult): string {
  if (result.detail) return result.detail
  return result.label.split(',').slice(1).join(',').trim()
}

export function PlaceField({
  field,
  label,
  placeholder,
  value,
  error,
  picking,
  onChange,
  onTogglePick,
}: PlaceFieldProps) {
  const baseId = useId()
  const inputId = `${baseId}-input`
  const listId = `${baseId}-list`
  const errorId = `${baseId}-error`
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const text = value.text
  const trimmed = text.trim()
  const debounced = useDebouncedValue(trimmed, SEARCH_DELAY_MS)
  const wantsSearch = open && !value.place && trimmed.length >= MIN_QUERY_LENGTH
  const search = usePlaceSearch(debounced, wantsSearch)
  const settled = debounced === trimmed
  const results = wantsSearch ? (search.data ?? []) : []
  const pending = wantsSearch && (!settled || search.isFetching)
  const hasResults = results.length > 0
  const loading = pending && !hasResults
  const failed = wantsSearch && settled && search.isError
  const empty = wantsSearch && settled && search.isSuccess && !pending && !hasResults
  const showPanel = hasResults || loading || failed || empty
  const activeIndex = results.findIndex((result) => optionKey(result) === activeKey)

  function choose(result: GeocodeResult) {
    onChange({
      text: result.label,
      place: { label: result.label, lat: result.lat, lon: result.lon },
    })
    setOpen(false)
    setActiveKey(null)
    inputRef.current?.focus()
  }

  function clear() {
    onChange({ text: '', place: null })
    setActiveKey(null)
    inputRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open && trimmed.length >= MIN_QUERY_LENGTH && !value.place) setOpen(true)
      if (!hasResults) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const from = activeIndex === -1 ? (step === 1 ? -1 : 0) : activeIndex
      const next = (from + step + results.length) % results.length
      setActiveKey(optionKey(results[next]))
    } else if (event.key === 'Enter' && hasResults) {
      // With nothing highlighted, Enter takes the top match.
      event.preventDefault()
      choose(results[activeIndex >= 0 ? activeIndex : 0])
    } else if (event.key === 'Escape' && showPanel) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      setActiveKey(null)
    }
  }

  const status = loading
    ? 'Searching places'
    : failed
      ? 'Search is unavailable'
      : empty
        ? 'No matches'
        : hasResults
          ? `${results.length} ${results.length === 1 ? 'match' : 'matches'} available`
          : ''

  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={inputId} className="mb-1.5">
        {label}
      </FieldLabel>
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          data-testid={`field-${field}`}
          type="text"
          role="combobox"
          aria-expanded={hasResults}
          aria-controls={hasResults ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${baseId}-opt-${activeIndex}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={text}
          maxLength={200}
          title={value.place ? value.place.label : undefined}
          onChange={(event) => {
            onChange({ text: event.target.value, place: null })
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setOpen(false)
            setActiveKey(null)
          }}
          onKeyDown={onKeyDown}
          className={clsx(
            'block h-11 w-full truncate rounded-xl bg-white pr-[4.75rem] pl-3.5 text-base text-ink-900 sm:text-[15px]',
            'ring-1 ring-inset transition-shadow duration-150 placeholder:text-ink-500',
            'hover:ring-ink-400 focus:ring-2 focus:ring-teal-600 focus:outline-none',
            error ? 'ring-coral-500 hover:ring-coral-600 focus:ring-coral-600' : 'ring-ink-300',
            picking && 'ring-2 ring-coral-500',
          )}
        />
        <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
          {text !== '' && (
            <IconButton
              size="sm"
              aria-label={`Clear ${label.toLowerCase()}`}
              data-testid={`btn-clear-${field}`}
              onClick={clear}
            >
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          )}
          <IconButton
            size="sm"
            aria-label={`Pick ${label.toLowerCase()} on the map`}
            aria-pressed={picking}
            data-testid={`btn-pick-${field}`}
            onClick={onTogglePick}
            className={clsx(
              picking && 'bg-coral-600 text-white hover:bg-coral-700 hover:text-white',
            )}
          >
            <Crosshair aria-hidden="true" className="size-[18px]" />
          </IconButton>
        </div>

        {showPanel && (
          <div
            className="absolute inset-x-0 top-full z-30 mt-1.5 animate-pop-in overflow-hidden rounded-xl bg-white shadow-[var(--shadow-pop)] ring-1 ring-ink-200"
            // Keeps the input focused while the pointer is on the panel, so a click can land.
            onMouseDown={(event) => event.preventDefault()}
          >
            {hasResults ? (
              <ul
                id={listId}
                role="listbox"
                aria-label={`${label} suggestions`}
                className="max-h-72 overflow-y-auto py-1"
              >
                {results.map((result, index) => (
                  <li
                    key={optionKey(result)}
                    id={`${baseId}-opt-${index}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-testid="suggestion"
                    onMouseEnter={() => setActiveKey(optionKey(result))}
                    onClick={() => choose(result)}
                    className={clsx(
                      'flex cursor-pointer items-start gap-3 px-3 py-2.5',
                      index === activeIndex ? 'bg-teal-50' : 'bg-white',
                    )}
                  >
                    <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-teal-700" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink-900">
                        {placeCity(result.label)}
                      </span>
                      {secondary(result) && (
                        <span className="block truncate text-[13px] text-ink-600">
                          {secondary(result)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2.5 px-3 py-3 text-sm text-ink-600">
                {loading && (
                  <>
                    <Spinner className="size-4 text-teal-600" />
                    Searching places
                  </>
                )}
                {failed && (
                  <>
                    <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-coral-600" />
                    Search is unavailable right now. Pick on the map instead.
                  </>
                )}
                {empty && (
                  <>
                    <SearchX aria-hidden="true" className="size-4 shrink-0 text-ink-500" />
                    No matches. Try a city name or a street address.
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
      <FieldError id={errorId} testId={`form-error-${field}`}>
        {error}
      </FieldError>
    </div>
  )
}
