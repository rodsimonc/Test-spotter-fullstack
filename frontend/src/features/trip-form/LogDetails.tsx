import { useId, useState } from 'react'
import { ChevronDown, NotebookPen } from 'lucide-react'
import clsx from 'clsx'
import type { LogHeader } from '@/api/types'
import { FieldError, TextField } from '@/components/ui/Field'
import { hasAnyHeader } from './formState'

interface LogDetailsProps {
  header: LogHeader
  error?: string
  onChange: (key: keyof LogHeader, value: string) => void
}

const MAX = 120

interface FieldSpec {
  key: keyof LogHeader
  label: string
  testId: string
  span?: 'full'
  autoComplete?: string
}

const FIELDS: FieldSpec[] = [
  { key: 'driver_name', label: 'Driver', testId: 'input-driver-name', autoComplete: 'name' },
  { key: 'co_driver_name', label: 'Co-driver', testId: 'input-co-driver-name' },
  { key: 'carrier_name', label: 'Carrier', testId: 'input-carrier-name', span: 'full' },
  {
    key: 'main_office_address',
    label: 'Main office address',
    testId: 'input-main-office',
    span: 'full',
  },
  {
    key: 'home_terminal_address',
    label: 'Home terminal address',
    testId: 'input-home-terminal',
    span: 'full',
  },
  { key: 'truck_number', label: 'Truck number', testId: 'input-truck-number' },
  { key: 'trailer_number', label: 'Trailer number', testId: 'input-trailer-number' },
  { key: 'shipper', label: 'Shipper', testId: 'input-shipper' },
  { key: 'commodity', label: 'Commodity', testId: 'input-commodity' },
  { key: 'shipping_doc_no', label: 'Shipping document no.', testId: 'input-doc-no', span: 'full' },
]

export function LogDetails({ header, error, onChange }: LogDetailsProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const expanded = open || Boolean(error)
  const filled = Object.values(header).filter((v) => v.trim() !== '').length

  return (
    <section aria-label="Log details" className="rounded-2xl bg-ink-25 ring-1 ring-ink-200">
      <button
        type="button"
        data-testid="btn-log-details"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-teal-50/70"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-teal-700 ring-1 ring-ink-200">
          <NotebookPen aria-hidden="true" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink-900">Log details</span>
          <span className="block truncate text-[13px] text-ink-600">
            {hasAnyHeader(header)
              ? `${filled} ${filled === 1 ? 'field' : 'fields'} filled in`
              : 'Driver, carrier, truck and shipping info for the sheet header'}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={clsx(
            'size-5 shrink-0 text-ink-500 transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>
      <div
        id={id}
        className={clsx(
          'grid transition-[grid-template-rows] duration-250 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="overflow-hidden" inert={!expanded}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 px-3.5 pt-1 pb-4">
            {FIELDS.map((field) => (
              <TextField
                key={field.key}
                id={`${id}-${field.key}`}
                data-testid={field.testId}
                label={field.label}
                value={header[field.key]}
                maxLength={MAX}
                autoComplete={field.autoComplete ?? 'off'}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={field.span === 'full' ? 'col-span-2' : undefined}
              />
            ))}
            <div className="col-span-2 -mt-1">
              <FieldError id={`${id}-error`} testId="form-error-header">
                {error}
              </FieldError>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
