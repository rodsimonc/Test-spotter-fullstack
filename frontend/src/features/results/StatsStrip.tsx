import type { ReactNode } from 'react'
import { CalendarDays, Flag, Fuel, Gauge, Route, Timer } from 'lucide-react'
import type { PlanSummary } from '@/api/types'
import { formatDuration, formatNumber } from '@/lib/format'
import { formatClock, formatDayShort } from '@/lib/time'

function Stat({
  testId,
  label,
  icon,
  children,
  sub,
}: {
  testId: string
  label: string
  icon: ReactNode
  children: ReactNode
  sub?: string
}) {
  return (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-1 bg-white p-4">
      <dt className="flex items-center gap-1.5 text-[13px] font-medium text-ink-600">
        <span className="text-teal-700">{icon}</span>
        {label}
      </dt>
      <dd>
        <span className="block text-[22px] leading-7 font-bold tracking-tight text-teal-950 tabular-nums">
          {children}
        </span>
        {sub && <span className="mt-1 block text-[13px] leading-tight text-ink-600">{sub}</span>}
      </dd>
    </div>
  )
}

function stopSummary(summary: PlanSummary): string | undefined {
  const parts: string[] = []
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`)
  }
  add(summary.rests, 'rest', 'rests')
  add(summary.breaks, 'break', 'breaks')
  add(summary.restarts, 'restart', 'restarts')
  return parts.length ? `plus ${parts.join(', ')}` : undefined
}

export function StatsStrip({ summary }: { summary: PlanSummary }) {
  return (
    <dl
      data-testid="stats-strip"
      className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-ink-200 ring-1 ring-ink-200 sm:grid-cols-3 desk:grid-cols-6"
    >
      <Stat
        testId="stat-distance"
        label="Distance"
        icon={<Route aria-hidden="true" className="size-4" />}
      >
        {formatNumber(summary.distance_miles)}{' '}
        <span className="text-sm font-semibold text-ink-600">mi</span>
      </Stat>
      <Stat
        testId="stat-driving"
        label="Driving"
        icon={<Gauge aria-hidden="true" className="size-4" />}
      >
        {formatDuration(summary.driving_minutes)}
      </Stat>
      <Stat
        testId="stat-trip-time"
        label="Trip time"
        icon={<Timer aria-hidden="true" className="size-4" />}
      >
        {formatDuration(summary.elapsed_minutes)}
      </Stat>
      <Stat
        testId="stat-arrival"
        label="Arrival"
        icon={<Flag aria-hidden="true" className="size-4" />}
        sub={formatDayShort(summary.arrive_at)}
      >
        {formatClock(summary.arrive_at)}
      </Stat>
      <Stat
        testId="stat-days"
        label="Log days"
        icon={<CalendarDays aria-hidden="true" className="size-4" />}
      >
        {summary.days}
      </Stat>
      <Stat
        testId="stat-fuel"
        label="Fuel stops"
        icon={<Fuel aria-hidden="true" className="size-4" />}
        sub={stopSummary(summary)}
      >
        {summary.fuel_stops}
      </Stat>
    </dl>
  )
}
