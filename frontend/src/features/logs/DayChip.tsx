import { forwardRef, type ComponentProps } from 'react'
import clsx from 'clsx'
import type { DailyLog, DutyStatus } from '@/api/types'
import { DUTY_STATUS_LABEL } from '@/api/types'
import { formatShortDate, wholeMiles } from './describe'
import { MINUTES_PER_DAY, ROW_ORDER, formatHours } from './geometry'

/** Fills for the mini day bars. They follow the app palette, not the ink on the sheet. */
const STATUS_FILL: Record<DutyStatus, string> = {
  off_duty: '#c3d3d7',
  sleeper: '#043d4c',
  driving: '#f84960',
  on_duty: '#008080',
}

/** The whole day as one bar, so a glance shows when the truck moved. */
export function DayBar({ log, className }: { log: DailyLog; className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${MINUTES_PER_DAY} 10`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={clsx('block h-2 w-full overflow-hidden rounded-[3px]', className)}
      shapeRendering="crispEdges"
    >
      <rect width={MINUTES_PER_DAY} height={10} fill={STATUS_FILL.off_duty} />
      {log.entries
        .filter((entry) => entry.end_min > entry.start_min && entry.status !== 'off_duty')
        .map((entry, i) => (
          <rect
            key={i}
            x={entry.start_min}
            width={entry.end_min - entry.start_min}
            height={10}
            fill={STATUS_FILL[entry.status]}
          />
        ))}
    </svg>
  )
}

/** The color key for the day bars. */
export function DayBarLegend({ className }: { className?: string }) {
  return (
    <ul
      aria-label="Color key for the day bars"
      className={clsx('flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600', className)}
    >
      {ROW_ORDER.map((status) => (
        <li key={status} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-[3px]"
            style={{ background: STATUS_FILL[status] }}
          />
          {DUTY_STATUS_LABEL[status]}
        </li>
      ))}
    </ul>
  )
}

interface DayChipProps extends Omit<ComponentProps<'button'>, 'children'> {
  log: DailyLog
  selected: boolean
}

/** One day in the strip: its number and date, a bar of the day, and the miles and driving hours. */
export const DayChip = forwardRef<HTMLButtonElement, DayChipProps>(function DayChip(
  { log, selected, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-testid={`day-chip-${log.day}`}
      className={clsx(
        'flex min-w-0 flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left transition-[background-color,box-shadow] duration-150',
        selected
          ? 'bg-teal-50 shadow-[inset_0_0_0_2px_var(--color-teal-600)]'
          : 'bg-white shadow-[inset_0_0_0_1px_var(--color-ink-200)] hover:bg-ink-25 hover:shadow-[inset_0_0_0_1px_var(--color-teal-400)]',
        className,
      )}
      {...rest}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold text-teal-950">Day {log.day}</span>
        <span className="truncate text-xs text-ink-600">{formatShortDate(log.date)}</span>
      </span>
      <DayBar log={log} />
      <span className="truncate text-xs text-ink-700">
        {wholeMiles(log.total_miles_driving)} mi, {formatHours(log.totals.driving)} h driving
      </span>
    </button>
  )
})
