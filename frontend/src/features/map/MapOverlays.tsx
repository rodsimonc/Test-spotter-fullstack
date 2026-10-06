import { Crosshair, ListChecks, MapPinned, Route, X } from 'lucide-react'
import type { PlaceKey } from '@/features/trip-form/formState'
import { Spinner } from '@/components/ui/Spinner'

const PLACE_NAME: Record<PlaceKey, string> = {
  current: 'your current location',
  pickup: 'the pickup',
  dropoff: 'the dropoff',
}

export function PickBanner({
  target,
  busy,
  onCancel,
}: {
  target: PlaceKey
  busy: boolean
  onCancel: () => void
}) {
  return (
    <div
      data-testid="pick-banner"
      role="status"
      className="absolute top-3 left-1/2 z-[600] flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl bg-teal-950 py-2.5 pr-2.5 pl-4 text-sm text-white shadow-[var(--shadow-pop)]"
    >
      {busy ? (
        <Spinner className="size-5 shrink-0 text-mint-200" />
      ) : (
        <Crosshair aria-hidden="true" className="size-5 shrink-0 text-coral-400" />
      )}
      <p className="min-w-0 flex-1 leading-snug">
        {busy ? (
          'Looking up that spot'
        ) : (
          <>
            Click the map to set <strong className="font-semibold">{PLACE_NAME[target]}</strong>.{' '}
            <span className="text-white/75">Esc cancels.</span>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="on-dark inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-white/12 px-2.5 text-[13px] font-semibold hover:bg-white/22"
      >
        <X aria-hidden="true" className="size-3.5" />
        Cancel
      </button>
    </div>
  )
}

const STEPS = [
  {
    Icon: MapPinned,
    title: 'Choose three places',
    body: 'Where you are, where you load, where you unload.',
  },
  {
    Icon: ListChecks,
    title: 'Set your hours',
    body: 'Cycle hours used so far and your departure time.',
  },
  {
    Icon: Route,
    title: 'Get the plan',
    body: 'Route, fuel stops, rests and filled-out log sheets.',
  },
]

/** First-run card laid over the map. It leaves the map usable around the edges. */
export function EmptyOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-3 sm:p-6">
      <div
        data-testid="empty-state"
        className="pointer-events-auto w-full max-w-2xl animate-rise-in rounded-3xl bg-white/95 p-5 shadow-[var(--shadow-pop)] ring-1 ring-ink-200 backdrop-blur sm:p-7"
      >
        <h2 className="text-xl font-bold text-teal-950 sm:text-2xl">Plan a trip to see it here</h2>
        <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-600 sm:text-[15px]">
          Add your places, press Plan trip, and the route appears with every fuel stop and rest.
          Daily log sheets are filled out for each day.
        </p>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ Icon, title, body }, index) => (
            <li
              key={title}
              className="flex items-start gap-3 rounded-2xl bg-ink-50 p-3.5 sm:flex-col sm:gap-2.5"
            >
              <span className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-950 text-mint-200">
                <Icon aria-hidden="true" className="size-5" />
                <span className="absolute -top-1.5 -right-1.5 inline-flex size-5 items-center justify-center rounded-full bg-coral-600 text-[11px] font-bold text-white ring-2 ring-white">
                  {index + 1}
                </span>
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">{title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-ink-600">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export function PlanningChip({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 z-[600] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-teal-950 py-2 pr-4 pl-3 text-sm font-medium text-white shadow-[var(--shadow-pop)]"
    >
      <Spinner className="size-4 text-mint-200" />
      {message}
    </div>
  )
}
