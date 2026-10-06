import { useEffect, useMemo, useRef, type FormEvent } from 'react'
import { ArrowDownUp, Globe, RotateCcw, Sparkles, Truck } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '@/components/ui/Button'
import { FieldError, FieldLabel } from '@/components/ui/Field'
import { inputClasses } from '@/components/ui/inputClasses'
import { CycleField } from './CycleField'
import { LogDetails } from './LogDetails'
import { PlaceField } from './PlaceField'
import { buildZoneGroups } from './timeZones'
import type { PlaceKey } from './formState'
import type { TripFormApi } from './useTripForm'

interface TripFormProps {
  form: TripFormApi
  pending: boolean
  pickTarget: PlaceKey | null
  onTogglePick: (key: PlaceKey) => void
  onSubmit: () => void
}

const PLACES: { key: PlaceKey; label: string; placeholder: string; dot: string }[] = [
  {
    key: 'current',
    label: 'Current location',
    placeholder: 'City, address or place',
    dot: 'bg-coral-500',
  },
  { key: 'pickup', label: 'Pickup', placeholder: 'Where you load', dot: 'bg-teal-600' },
  { key: 'dropoff', label: 'Dropoff', placeholder: 'Where you unload', dot: 'bg-teal-950' },
]

export function TripForm({ form, pending, pickTarget, onTogglePick, onSubmit }: TripFormProps) {
  const { state, errors, errorStamp } = form
  const formRef = useRef<HTMLFormElement>(null)
  const zones = useMemo(() => buildZoneGroups(state.timezone), [state.timezone])

  // Send focus to the first bad field after a failed submit.
  useEffect(() => {
    if (errorStamp === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errorStamp])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form ref={formRef} noValidate onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-950 text-mint-200">
          <Truck aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 className="text-lg leading-6 font-bold text-teal-950">Plan a trip</h2>
          <p className="text-[13px] leading-snug text-ink-600">Where you start, load and unload.</p>
        </div>
      </div>

      <ol className="space-y-3">
        {PLACES.map((place, index) => (
          <li key={place.key} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3">
            <div aria-hidden="true">
              <span
                className={clsx(
                  'absolute top-[41px] left-[7px] z-10 size-3.5 rounded-full ring-4 ring-white',
                  place.dot,
                )}
              />
              {index < PLACES.length - 1 && (
                <span className="absolute top-[48px] left-[13px] h-[calc(100%+0.75rem)] border-l-2 border-dashed border-ink-300" />
              )}
            </div>
            {place.key === 'pickup' && (
              <button
                type="button"
                data-testid="btn-swap"
                aria-label="Swap pickup and dropoff"
                onClick={form.swap}
                className="absolute top-[71px] -left-1 z-20 inline-flex size-9 items-center justify-center rounded-full bg-white text-ink-700 shadow-sm ring-1 ring-ink-300 transition hover:text-teal-700 hover:ring-teal-600 active:scale-95"
              >
                <ArrowDownUp aria-hidden="true" className="size-3.5" />
              </button>
            )}
            <PlaceField
              field={place.key}
              label={place.label}
              placeholder={place.placeholder}
              value={state[place.key]}
              error={errors[place.key]}
              picking={pickTarget === place.key}
              onChange={(value) => form.setPlace(place.key, value)}
              onTogglePick={() => onTogglePick(place.key)}
            />
          </li>
        ))}
      </ol>

      <div className="h-px bg-ink-100" />

      <CycleField value={state.cycle} error={errors.cycle} onChange={form.setCycle} />

      <div className="grid gap-4">
        <div>
          <FieldLabel htmlFor="departure">Departure</FieldLabel>
          <input
            id="departure"
            data-testid="input-departure"
            type="datetime-local"
            value={state.departure}
            aria-invalid={errors.departure ? true : undefined}
            aria-describedby={errors.departure ? 'departure-error' : undefined}
            onChange={(event) => form.setDeparture(event.target.value)}
            className={inputClasses(Boolean(errors.departure), 'min-w-0')}
          />
          <FieldError id="departure-error" testId="form-error-departure">
            {errors.departure}
          </FieldError>
        </div>
        <div>
          <FieldLabel htmlFor="timezone">Home terminal time zone</FieldLabel>
          <div className="relative">
            <Globe
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-500"
            />
            <select
              id="timezone"
              data-testid="select-timezone"
              value={state.timezone}
              aria-invalid={errors.timezone ? true : undefined}
              aria-describedby={errors.timezone ? 'timezone-error' : 'timezone-hint'}
              onChange={(event) => form.setTimezone(event.target.value)}
              className={inputClasses(Boolean(errors.timezone), 'min-w-0 truncate pl-9')}
            >
              <optgroup label="United States">
                {zones.us.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All other zones">
                {zones.other.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <p id="timezone-hint" className="mt-1.5 text-[13px] text-ink-600">
            Departure and every log sheet use this zone.
          </p>
          <FieldError id="timezone-error" testId="form-error-timezone">
            {errors.timezone}
          </FieldError>
        </div>
      </div>

      <LogDetails header={state.header} error={errors.header} onChange={form.setHeader} />

      {/* On wide screens the sidebar scrolls on its own, so the actions stay in reach at the bottom. */}
      <div className="space-y-3 desk:sticky desk:bottom-0 desk:z-20 desk:-mx-5 desk:-mb-5 desk:bg-linear-to-t desk:from-white desk:from-80% desk:to-white/0 desk:px-5 desk:pt-4 desk:pb-5">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={pending}
          data-testid="btn-plan"
          className="w-full"
        >
          {pending ? 'Planning trip' : 'Plan trip'}
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            icon={<Sparkles aria-hidden="true" className="size-4 text-coral-600" />}
            data-testid="btn-example"
            onClick={form.loadExample}
          >
            Try an example
          </Button>
          <Button
            variant="ghost"
            icon={<RotateCcw aria-hidden="true" className="size-4" />}
            data-testid="btn-reset"
            onClick={form.reset}
          >
            Reset
          </Button>
        </div>
      </div>
    </form>
  )
}
