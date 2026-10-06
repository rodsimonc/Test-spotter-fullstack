import { useId, type CSSProperties } from 'react'
import clsx from 'clsx'
import { FieldError } from '@/components/ui/Field'
import { formatHours } from '@/lib/format'

const CYCLE_LIMIT = 70
const LOW_REMAINING_HOURS = 10

interface CycleFieldProps {
  value: string
  error?: string
  onChange: (value: string) => void
}

export function CycleField({ value, error, onChange }: CycleFieldProps) {
  const id = useId()
  const errorId = `${id}-error`
  const parsed = Number(value)
  const valid = value.trim() !== '' && Number.isFinite(parsed)
  const used = valid ? Math.min(Math.max(parsed, 0), CYCLE_LIMIT) : 0
  const left = CYCLE_LIMIT - used
  const low = valid && left <= LOW_REMAINING_HOURS

  const sliderStyle = {
    '--fill': `${(used / CYCLE_LIMIT) * 100}%`,
    '--range-color': low ? 'var(--color-coral-600)' : 'var(--color-teal-600)',
  } as CSSProperties

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={`${id}-number`} className="text-[13px] font-semibold text-ink-800">
          Cycle hours used
        </label>
        <div className="relative w-24">
          <input
            id={`${id}-number`}
            data-testid="input-cycle"
            type="number"
            inputMode="decimal"
            min={0}
            max={CYCLE_LIMIT}
            step={0.25}
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange(event.target.value)}
            className={clsx(
              'block h-9 w-full rounded-lg bg-white pr-7 pl-2.5 text-right text-base font-semibold sm:text-sm text-ink-900 tabular-nums',
              'ring-1 ring-inset hover:ring-ink-400 focus:ring-2 focus:ring-teal-600 focus:outline-none',
              error ? 'ring-coral-500 focus:ring-coral-600' : 'ring-ink-300',
            )}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-ink-500"
          >
            h
          </span>
        </div>
      </div>
      <input
        data-testid="slider-cycle"
        type="range"
        className="range"
        min={0}
        max={CYCLE_LIMIT}
        step={0.25}
        value={used}
        style={sliderStyle}
        aria-label="Cycle hours used, slider"
        aria-valuetext={`${formatHours(used)} of ${CYCLE_LIMIT} hours used, ${formatHours(left)} left`}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="mt-0.5 flex items-baseline justify-between text-[13px]">
        <span className="font-medium text-ink-700 tabular-nums">
          {formatHours(used)} of {CYCLE_LIMIT} h used
        </span>
        <span
          className={clsx('font-semibold tabular-nums', low ? 'text-coral-700' : 'text-teal-700')}
        >
          {formatHours(left)} h left
        </span>
      </div>
      <FieldError id={errorId} testId="form-error-cycle">
        {error}
      </FieldError>
    </div>
  )
}
