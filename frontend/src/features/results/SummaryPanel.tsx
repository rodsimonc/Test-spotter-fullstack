import { ListChecks, RotateCcw } from 'lucide-react'
import type { LegSummary, PlanResponse } from '@/api/types'
import { formatDuration, formatHours, formatMiles, placeCity } from '@/lib/format'

const CYCLE_LIMIT = 70

function CycleMeter({ plan }: { plan: PlanResponse }) {
  const { cycle_used_start_hours: start, cycle_used_end_hours: end, restarts } = plan.summary
  const pct = (hours: number) => `${Math.min(100, Math.max(0, (hours / CYCLE_LIMIT) * 100))}%`
  const added = end >= start
  const left = Math.max(0, CYCLE_LIMIT - end)

  return (
    <section
      data-testid="cycle-meter"
      aria-labelledby="cycle-meter-title"
      className="rounded-2xl bg-white p-5 ring-1 ring-ink-200"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="cycle-meter-title" className="text-base font-bold text-teal-950">
          70-hour cycle
        </h3>
        <p className="text-sm font-semibold text-teal-700 tabular-nums">
          {formatHours(left)} h left at arrival
        </p>
      </div>

      <div
        role="meter"
        aria-label="Cycle hours used at arrival"
        aria-valuemin={0}
        aria-valuemax={CYCLE_LIMIT}
        aria-valuenow={Math.min(end, CYCLE_LIMIT)}
        aria-valuetext={`${formatHours(end)} of ${CYCLE_LIMIT} hours used`}
        className="relative mt-4 h-4 overflow-hidden rounded-full bg-ink-100"
      >
        {added && (
          <span className="absolute inset-y-0 left-0 bg-teal-200" style={{ width: pct(start) }} />
        )}
        <span
          className="absolute inset-y-0 rounded-full bg-teal-600"
          style={
            added
              ? { left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }
              : { left: 0, width: pct(end) }
          }
        />
      </div>
      <div
        aria-hidden="true"
        className="mt-1.5 flex justify-between text-xs text-ink-500 tabular-nums"
      >
        <span>0</span>
        <span>35</span>
        <span>70 h</span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="flex items-center gap-1.5 text-ink-600">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full bg-teal-200 ring-1 ring-teal-300"
            />
            At start
          </dt>
          <dd className="mt-0.5 text-lg font-bold text-teal-950 tabular-nums">
            {formatHours(start)} h
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-ink-600">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-teal-600" />
            At arrival
          </dt>
          <dd className="mt-0.5 text-lg font-bold text-teal-950 tabular-nums">
            {formatHours(end)} h
          </dd>
        </div>
        <div>
          <dt className="text-ink-600">Left</dt>
          <dd className="mt-0.5 text-lg font-bold text-teal-950 tabular-nums">
            {formatHours(left)} h
          </dd>
        </div>
      </dl>

      {restarts > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-teal-50 p-3 text-[13px] leading-snug text-teal-950">
          <RotateCcw aria-hidden="true" className="mt-px size-4 shrink-0 text-teal-700" />
          <span>
            A 34-hour restart reset the cycle during this trip, so the arrival figure counts only
            the hours since the restart.
          </span>
        </p>
      )}
    </section>
  )
}

function legName(leg: LegSummary, plan: PlanResponse): string {
  const labels = {
    current: plan.request.current.label,
    pickup: plan.request.pickup.label,
    dropoff: plan.request.dropoff.label,
  }
  return `${placeCity(labels[leg.from])} to ${placeCity(labels[leg.to])}`
}

function LegTable({ plan }: { plan: PlanResponse }) {
  const { legs } = plan.summary
  const totalPlanner = legs.reduce((sum, l) => sum + l.duration_minutes, 0)
  const totalOsrm = legs.reduce((sum, l) => sum + l.osrm_duration_minutes, 0)
  const totalMiles = legs.reduce((sum, l) => sum + l.distance_miles, 0)

  return (
    <section aria-labelledby="legs-title" className="rounded-2xl bg-white p-5 ring-1 ring-ink-200">
      <h3 id="legs-title" className="text-base font-bold text-teal-950">
        Legs
      </h3>
      <div className="-mx-1 mt-3 overflow-x-auto px-1">
        <table className="w-full min-w-[440px] text-sm [&_td]:whitespace-nowrap [&_thead_th]:whitespace-nowrap">
          <thead>
            <tr className="border-b border-ink-200 text-left text-[13px] text-ink-600">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Leg
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Distance
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                OSRM time
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Planner time
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {legs.map((leg) => (
              <tr key={`${leg.from}-${leg.to}`} className="border-b border-ink-100">
                <th scope="row" className="py-2.5 pr-3 text-left font-medium text-ink-900">
                  {legName(leg, plan)}
                </th>
                <td className="py-2.5 pr-3 text-right">{formatMiles(leg.distance_miles)}</td>
                <td className="py-2.5 pr-3 text-right">
                  {formatDuration(leg.osrm_duration_minutes)}
                </td>
                <td className="py-2.5 text-right font-semibold text-teal-950">
                  {formatDuration(leg.duration_minutes)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="tabular-nums">
            <tr className="font-semibold text-teal-950">
              <th scope="row" className="py-2.5 pr-3 text-left">
                Total
              </th>
              <td className="py-2.5 pr-3 text-right">{formatMiles(totalMiles)}</td>
              <td className="py-2.5 pr-3 text-right">{formatDuration(totalOsrm)}</td>
              <td className="py-2.5 text-right">{formatDuration(totalPlanner)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-[13px] leading-snug text-ink-600">
        Planner time is the slower of the OSRM estimate and the distance at 60 mph. OSRM times a
        car, not a loaded truck.
      </p>
    </section>
  )
}

export function SummaryPanel({ plan }: { plan: PlanResponse }) {
  return (
    <div className="@container space-y-5">
      {/* Sized by the panel, not the window: the legs table needs room for four columns. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <CycleMeter plan={plan} />
        <LegTable plan={plan} />
      </div>
      <section
        data-testid="assumptions"
        aria-labelledby="assumptions-title"
        className="rounded-2xl bg-white p-5 ring-1 ring-ink-200"
      >
        <h3
          id="assumptions-title"
          className="flex items-center gap-2 text-base font-bold text-teal-950"
        >
          <ListChecks aria-hidden="true" className="size-5 text-teal-700" />
          Assumptions
        </h3>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-700">
          {plan.assumptions.map((line) => (
            <li key={line} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-600"
              />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
