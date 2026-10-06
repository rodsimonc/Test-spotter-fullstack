import { Fragment, useMemo } from 'react'
import { ChevronRight, Info } from 'lucide-react'
import type { PlanResponse, Stop } from '@/api/types'
import { STOP_KIND_STYLE } from '@/features/map/stopKinds'
import { formatDuration, formatMiles, formatNumber } from '@/lib/format'
import { formatDayLong, formatRange, zoneAbbreviation } from '@/lib/time'

interface ItineraryProps {
  plan: PlanResponse
  onSelectStop: (id: string) => void
}

interface Leg {
  minutes: number
  miles: number
}

/** Driving between two stops, read from the segment list. */
function driveBetween(plan: PlanResponse, from: Stop, to: Stop): Leg {
  const minutes = plan.segments
    .filter((s) => s.kind === 'drive' && s.start_at >= from.depart_at && s.end_at <= to.arrive_at)
    .reduce((sum, s) => sum + s.minutes, 0)
  return { minutes, miles: Math.max(0, to.mile - from.mile) }
}

function StopCard({
  stop,
  number,
  onSelect,
}: {
  stop: Stop
  number: number | null
  onSelect: (id: string) => void
}) {
  const { color, Icon } = STOP_KIND_STYLE[stop.kind]
  return (
    <button
      type="button"
      data-testid={`stop-card-${stop.id}`}
      onClick={() => onSelect(stop.id)}
      className="group flex w-full items-start gap-3.5 rounded-2xl p-3 text-left transition-colors duration-150 hover:bg-teal-50/70 focus-visible:bg-teal-50/70"
    >
      <span
        className="relative z-10 inline-flex size-10 shrink-0 items-center justify-center rounded-full text-white shadow-[0_3px_8px_rgb(4_61_76/0.25)] ring-4 ring-white transition-transform duration-150 group-hover:scale-105"
        style={{ background: color }}
      >
        <Icon aria-hidden="true" className="size-5" strokeWidth={2.1} />
        {number !== null && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-white px-1 text-[10px] leading-none font-bold text-teal-950 ring-1 ring-ink-300"
          >
            {number}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="text-[15px] font-semibold text-ink-900">{stop.title}</span>
          <span className="text-[13px] font-medium text-ink-700 tabular-nums">
            {formatRange(stop.arrive_at, stop.depart_at)}
          </span>
        </span>
        <span className="mt-0.5 block text-sm text-ink-600">{stop.place}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {stop.duration_minutes > 0 && (
            <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
              {formatDuration(stop.duration_minutes)}
            </span>
          )}
          <span className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-semibold text-ink-700 tabular-nums">
            Mile {formatNumber(stop.mile)}
          </span>
        </span>
        {stop.note && (
          <span className="mt-2 block text-[13px] leading-snug text-ink-600">{stop.note}</span>
        )}
        <span className="sr-only">Show on map.</span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="mt-2.5 size-4 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700"
      />
    </button>
  )
}

function DriveConnector({ leg }: { leg: Leg }) {
  return (
    <li className="flex h-9 items-center pl-[3.25rem]">
      <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-ink-600 ring-1 ring-ink-200">
        Drive {formatDuration(leg.minutes)} &middot; {formatMiles(leg.miles)}
      </span>
    </li>
  )
}

export function Itinerary({ plan, onSelectStop }: ItineraryProps) {
  const { groups, numberOf } = useMemo(() => {
    // Numbers match the map markers. The closing "end" stop shares the dropoff's marker.
    const numbers = new Map<string, number>()
    plan.stops
      .filter((s) => s.kind !== 'end')
      .forEach((stop, index) => numbers.set(stop.id, index + 1))

    const days = [...new Set(plan.stops.map((s) => s.day))].sort((a, b) => a - b)
    return {
      numberOf: numbers,
      groups: days.map((day) => ({
        day,
        log: plan.logs.find((l) => l.day === day),
        stops: plan.stops
          .map((stop, index) => ({ stop, index }))
          .filter(({ stop }) => stop.day === day),
      })),
    }
  }, [plan])

  const zone = plan.request.timezone
  const abbreviation = zoneAbbreviation(zone, plan.summary.depart_at)

  return (
    <div className="space-y-7">
      <p className="flex items-start gap-2 text-[13px] leading-snug text-ink-600">
        <Info aria-hidden="true" className="mt-px size-4 shrink-0 text-teal-700" />
        <span>
          Times are home terminal time ({abbreviation}, {zone}). Select a stop to see it on the map.
        </span>
      </p>
      {groups.map(({ day, stops, log }) => (
        <section key={day} data-testid={`day-group-${day}`} aria-labelledby={`day-${day}-title`}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 id={`day-${day}-title`} className="text-base font-bold text-teal-950">
              Day {day}
              {log && (
                <span className="ml-2 font-medium text-ink-600">{formatDayLong(log.date)}</span>
              )}
            </h3>
            {log && log.totals.driving > 0 && (
              <p className="text-[13px] font-medium text-ink-600 tabular-nums">
                Driving {formatDuration(log.totals.driving)} &middot;{' '}
                {formatMiles(log.total_miles_driving)}
              </p>
            )}
          </div>
          <ol className="relative before:absolute before:top-6 before:bottom-6 before:left-[1.78rem] before:border-l-2 before:border-dashed before:border-ink-300 before:content-['']">
            {stops.map(({ stop, index }) => {
              const previous = index > 0 ? plan.stops[index - 1] : null
              const leg = previous ? driveBetween(plan, previous, stop) : null
              return (
                <Fragment key={stop.id}>
                  {leg && leg.minutes > 0 && <DriveConnector leg={leg} />}
                  <li className="relative">
                    <StopCard
                      stop={stop}
                      number={numberOf.get(stop.id) ?? null}
                      onSelect={onSelectStop}
                    />
                  </li>
                </Fragment>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
