import { ArrowUp, ChevronRight, Info, Route } from 'lucide-react'
import clsx from 'clsx'
import type { DirectionLeg, DirectionStep } from '@/api/types'
import { STOP_KIND_STYLE } from '@/features/map/stopKinds'
import type { MapPoint } from '@/features/map/TripMap'
import { formatMiles, formatNumber } from '@/lib/format'

interface DirectionsProps {
  /** Missing on trips saved before directions existed, so it is read defensively. */
  directions: DirectionLeg[] | undefined
  onSelectPoint: (point: MapPoint) => void
}

/** Degrees clockwise from north for each compass heading the API sends. */
const HEADING_DEGREES: Record<string, number> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
}

type RoadKind = 'interstate' | 'route' | 'street'

/** "I-40" is an interstate, "US-287" or "TX-183" a numbered route, anything else a street name. */
function roadKind(road: string): RoadKind {
  if (/^I-\d/.test(road)) return 'interstate'
  if (/^[A-Z]{2,3}-\d/.test(road)) return 'route'
  return 'street'
}

/** Under 10 miles the tenth matters ("1.4 mi"). Above that whole miles read better. */
function stepMiles(miles: number): string {
  if (miles >= 10) return formatMiles(miles)
  return `${Number(miles.toFixed(1))} mi`
}

function StepIcon({ step, leg }: { step: DirectionStep; leg: DirectionLeg }) {
  // Start and arrival wear the same badge as their map marker, so a line and its pin match.
  if (step.kind !== 'road') {
    const kind =
      step.kind === 'depart'
        ? leg.from === 'current'
          ? 'start'
          : 'pickup'
        : leg.to === 'pickup'
          ? 'pickup'
          : 'dropoff'
    const { color, Icon } = STOP_KIND_STYLE[kind]
    return (
      <span
        aria-hidden="true"
        data-testid="direction-icon"
        className="relative z-10 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white ring-4 ring-white"
        style={{ background: color }}
      >
        <Icon className="size-[18px]" strokeWidth={2.1} />
      </span>
    )
  }

  const degrees = HEADING_DEGREES[step.heading]
  return (
    <span
      aria-hidden="true"
      data-testid="direction-arrow"
      data-heading={step.heading}
      className="relative z-10 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-700 ring-4 ring-white"
    >
      {degrees === undefined ? (
        <Route className="size-[18px]" strokeWidth={2.1} />
      ) : (
        <ArrowUp
          className="size-[18px]"
          strokeWidth={2.4}
          style={{ transform: `rotate(${degrees}deg)` }}
        />
      )}
    </span>
  )
}

/** The road on its own line: a chip for numbered roads, quiet text for street names. */
function RoadLabel({ road }: { road: string }) {
  if (!road) return null
  const kind = roadKind(road)
  // The instruction already names the road, so a screen reader skips this copy of it.
  if (kind === 'street') {
    return (
      <span
        aria-hidden="true"
        data-road-kind="street"
        className="mt-0.5 block text-[13px] leading-snug break-words text-ink-500"
      >
        {road}
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      data-road-kind={kind}
      className={clsx(
        'mt-1 inline-flex rounded-md px-1.5 py-0.5 text-xs leading-none font-bold tabular-nums',
        kind === 'interstate'
          ? 'bg-teal-900 text-white'
          : 'bg-white text-ink-900 ring-1 ring-ink-500 ring-inset',
      )}
    >
      {road}
    </span>
  )
}

function StepLine({
  step,
  leg,
  legIndex,
  stepIndex,
  onSelect,
}: {
  step: DirectionStep
  leg: DirectionLeg
  legIndex: number
  stepIndex: number
  onSelect: (point: MapPoint) => void
}) {
  return (
    <button
      type="button"
      data-testid={`direction-step-${legIndex}-${stepIndex}`}
      data-kind={step.kind}
      onClick={() => onSelect({ lat: step.lat, lon: step.lon })}
      className="group grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-x-3 rounded-2xl p-2.5 text-left transition-colors duration-150 hover:bg-teal-50/70 focus-visible:bg-teal-50/70"
    >
      <StepIcon step={step} leg={leg} />
      <span className="min-w-0 pt-1">
        <span className="block text-[15px] leading-snug font-semibold break-words text-ink-900">
          {step.instruction}
        </span>
        <RoadLabel road={step.road} />
        <span className="sr-only">Show on map.</span>
      </span>
      <span className="flex items-start gap-1.5 pt-1">
        <span className="text-right whitespace-nowrap tabular-nums">
          {step.distance_miles > 0 && (
            <span className="block text-sm font-semibold text-ink-900">
              {stepMiles(step.distance_miles)}
            </span>
          )}
          <span className="block text-xs text-ink-500">mile {formatNumber(step.mile)}</span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="mt-0.5 hidden size-4 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-700 sm:block"
        />
      </span>
    </button>
  )
}

const LEG_LABEL: Record<DirectionLeg['to'], string> = {
  pickup: 'to the pickup',
  dropoff: 'to the dropoff',
}

export function Directions({ directions, onSelectPoint }: DirectionsProps) {
  // Indexes stay those of the API list, so a test id always names the same leg.
  const legs = (directions ?? [])
    .map((leg, legIndex) => ({ leg, legIndex }))
    .filter(({ leg }) => leg.steps.length > 0)

  if (legs.length === 0) {
    return (
      <div
        data-testid="directions-empty"
        className="flex items-start gap-3 rounded-2xl bg-ink-50 p-4 text-sm leading-snug text-ink-700 ring-1 ring-ink-200"
      >
        <Route aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-700" />
        <p>
          Road-by-road directions aren&apos;t available for this trip. The route on the map and the
          stops are unaffected.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <p className="flex items-start gap-2 text-[13px] leading-snug text-ink-600">
        <Info aria-hidden="true" className="mt-px size-4 shrink-0 text-teal-700" />
        <span>
          Short turns are folded into the road around them. Select a line to see it on the map.
        </span>
      </p>
      {legs.map(({ leg, legIndex }) => (
        <section
          key={`${leg.from}-${leg.to}`}
          data-testid={`direction-leg-${legIndex}`}
          aria-labelledby={`direction-leg-${legIndex}-title`}
          className="rounded-2xl ring-1 ring-ink-200"
        >
          <div className="border-b border-ink-100 px-4 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-xs font-semibold text-teal-700">
                Leg {legIndex + 1}, {LEG_LABEL[leg.to]}
              </p>
              <p className="text-sm font-semibold whitespace-nowrap text-ink-700 tabular-nums">
                {formatMiles(leg.distance_miles)}
              </p>
            </div>
            <h3
              id={`direction-leg-${legIndex}-title`}
              className="mt-0.5 text-base font-bold break-words text-teal-950"
            >
              {leg.title}
            </h3>
          </div>
          <ol className="relative p-2 before:absolute before:top-9 before:bottom-9 before:left-[1.9rem] before:border-l-2 before:border-dashed before:border-ink-300 before:content-['']">
            {leg.steps.map((step, stepIndex) => (
              <li key={stepIndex} className="relative">
                <StepLine
                  step={step}
                  leg={leg}
                  legIndex={legIndex}
                  stepIndex={stepIndex}
                  onSelect={onSelectPoint}
                />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}
