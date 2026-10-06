import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { planTrip, reversePlace } from '@/api/endpoints'
import { useSaveTrip, useSession, useSignOut } from '@/api/hooks'
import type { PlanRequest, PlanResponse, Trip, User } from '@/api/types'
import { AppFooter } from '@/components/layout/AppFooter'
import { AppHeader } from '@/components/layout/AppHeader'
import { useToast } from '@/components/ui/Toast'
import { AuthDialog, type AuthMode } from '@/features/auth/AuthDialog'
import { TripMap, type StopFocusRequest } from '@/features/map/TripMap'
import { PlanError, ResultsLoading } from '@/features/results/ResultStates'
import { Results, type ResultsTab } from '@/features/results/Results'
import { usePlanningMessage } from '@/features/results/usePlanningMessage'
import type { PlaceKey } from '@/features/trip-form/formState'
import { TripForm } from '@/features/trip-form/TripForm'
import { useTripForm } from '@/features/trip-form/useTripForm'
import { TripsDrawer } from '@/features/trips/TripsDrawer'
import { placeCity } from '@/lib/format'
import { readSharedTrip } from '@/lib/share'
import clsx from 'clsx'

function matches(query: string): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

const isDesktop = () => matches('(min-width: 1100px)')

function scrollOptions(block: ScrollLogicalPosition): ScrollIntoViewOptions {
  return { block, behavior: matches('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth' }
}

function defaultTitle(request: PlanRequest): string {
  return `${placeCity(request.current.label)} to ${placeCity(request.dropoff.label)}`
}

function planErrorMessage(error: ApiError, unmapped: string[]): string {
  if (error.code === 'validation_error') {
    return [error.message, ...unmapped].join(' ')
  }
  return error.message
}

export function App() {
  const toast = useToast()
  const session = useSession()
  const signOut = useSignOut()
  const saveTrip = useSaveTrip()
  const [shared] = useState(() => readSharedTrip(window.location.search))
  const form = useTripForm(shared && shared !== 'invalid' ? shared : undefined)

  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planFailure, setPlanFailure] = useState<{ message: string; retryable: boolean } | null>(
    null,
  )
  const [savedTripId, setSavedTripId] = useState<string | null>(null)
  const [tab, setTab] = useState<ResultsTab>('itinerary')
  const [pickTarget, setPickTarget] = useState<PlaceKey | null>(null)
  const [focus, setFocus] = useState<StopFocusRequest | null>(null)
  const [auth, setAuth] = useState<{ mode: AuthMode; reason?: string } | null>(null)
  const [tripsOpen, setTripsOpen] = useState(false)
  const mapPanelRef = useRef<HTMLDivElement>(null)
  const pendingSave = useRef(false)
  const openedLink = useRef(false)

  const planning = useMutation({
    mutationFn: (request: PlanRequest) => planTrip(request),
    onMutate: () => setPlanFailure(null),
    onSuccess: (result) => {
      setPlan(result)
      setSavedTripId(null)
      setTab('itinerary')
      setFocus(null)
      if (!isDesktop()) {
        mapPanelRef.current?.scrollIntoView(scrollOptions('start'))
      }
    },
    onError: (error) => {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(0, 'unknown', 'Something went wrong. Try again.')
      const unmapped =
        apiError.code === 'validation_error' ? form.applyServerErrors(apiError.fields) : []
      setPlanFailure({
        message: planErrorMessage(apiError, unmapped),
        retryable: apiError.code !== 'validation_error',
      })
    },
  })

  const reverse = useMutation({
    mutationFn: (point: { lat: number; lon: number }) => reversePlace(point.lat, point.lon),
  })
  const planningMessage = usePlanningMessage(planning.isPending)

  function submit() {
    setPickTarget(null)
    const request = form.validate()
    if (request) planning.mutate(request)
  }

  // A share link carries the whole request, so plan it straight away. The form already holds it.
  useEffect(() => {
    if (openedLink.current) return
    openedLink.current = true
    if (shared === 'invalid') {
      toast.show("That share link is damaged, so it couldn't be opened.", 'error')
    } else if (shared) {
      planning.mutate(shared)
    }
    // Runs once on load. The helpers it calls are not stable and must not retrigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape leaves pick mode. The place combobox stops its own Escape from reaching here.
  useEffect(() => {
    if (!pickTarget) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickTarget(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pickTarget])

  function togglePick(key: PlaceKey) {
    const next = pickTarget === key ? null : key
    setPickTarget(next)
    if (next) mapPanelRef.current?.scrollIntoView(scrollOptions('nearest'))
  }

  function handlePick(lat: number, lon: number) {
    if (!pickTarget || reverse.isPending) return
    const key = pickTarget
    reverse.mutate(
      { lat, lon },
      {
        onSuccess: (place) => {
          form.setPlace(key, { text: place.label, place })
          setPickTarget(null)
        },
        onError: () =>
          toast.show("Couldn't name that spot. Click somewhere else on the map.", 'error'),
      },
    )
  }

  function selectStop(id: string) {
    setFocus((current) => ({ id, nonce: (current?.nonce ?? 0) + 1 }))
    mapPanelRef.current?.scrollIntoView(scrollOptions('nearest'))
  }

  function saveCurrentPlan() {
    if (!plan) return
    saveTrip.mutate(
      { title: defaultTitle(plan.request), request: plan.request },
      {
        onSuccess: (trip) => {
          setSavedTripId(trip.id)
          toast.show('Trip saved. Find it under My trips.')
        },
        onError: (error) =>
          toast.show(
            error instanceof ApiError ? error.message : "Couldn't save the trip. Try again.",
            'error',
          ),
      },
    )
  }

  function onSave() {
    if (!session.user) {
      pendingSave.current = true
      setAuth({ mode: 'login', reason: 'Sign in or create an account to save this trip.' })
      return
    }
    saveCurrentPlan()
  }

  function onAuthSuccess(user: User, mode: AuthMode) {
    setAuth(null)
    toast.show(
      mode === 'register'
        ? 'Account created. You are signed in.'
        : `Signed in as ${user.name || user.email}.`,
    )
    if (pendingSave.current) {
      pendingSave.current = false
      saveCurrentPlan()
    }
  }

  function closeAuth() {
    pendingSave.current = false
    setAuth(null)
  }

  function onSignOut() {
    signOut.mutate(undefined, {
      onSuccess: () => {
        setTripsOpen(false)
        setSavedTripId(null)
        toast.show('Signed out.')
      },
      onError: () => toast.show("Couldn't sign out. Try again.", 'error'),
    })
  }

  function openSavedTrip(trip: Trip) {
    form.loadRequest(trip.request)
    setPlan(trip.result)
    planning.reset()
    setPlanFailure(null)
    setSavedTripId(trip.id)
    setTab('itinerary')
    setFocus(null)
    setTripsOpen(false)
    toast.show(`Opened "${trip.title}".`)
  }

  const places = {
    current: form.state.current.place,
    pickup: form.state.pickup.place,
    dropoff: form.state.dropoff.place,
  }
  const hasResults = plan !== null && !planning.isPending
  const lastRequest = planning.variables

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader
        user={session.user}
        sessionReady={session.ready}
        onOpenAuth={(mode) => setAuth({ mode })}
        onOpenTrips={() => setTripsOpen(true)}
        onSignOut={onSignOut}
      />

      <main className="relative z-10 mx-auto -mt-10 w-full max-w-[1760px] flex-1 px-4 pb-10 sm:-mt-12 sm:px-6 desk:px-8">
        {/* minmax(0, 1fr) lets the column shrink below its widest child. The time zone select would
            otherwise hold the whole page wider than a phone. */}
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 desk:grid-cols-[400px_minmax(0,1fr)] desk:gap-6">
          <aside
            aria-label="Trip details"
            className="rounded-3xl bg-white p-5 shadow-[var(--shadow-card)] ring-1 ring-ink-200 sm:p-6 desk:sticky desk:p-5 desk:top-4 desk:max-h-[calc(100dvh-2rem)] desk:overflow-y-auto print:hidden"
          >
            <TripForm
              form={form}
              pending={planning.isPending}
              pickTarget={pickTarget}
              onTogglePick={togglePick}
              onSubmit={submit}
            />
          </aside>

          <div className="min-w-0 space-y-5">
            <div
              ref={mapPanelRef}
              className="scroll-mt-4 overflow-hidden rounded-3xl bg-white shadow-[var(--shadow-card)] ring-1 ring-ink-200 print:hidden"
            >
              <TripMap
                places={places}
                plan={plan}
                pickTarget={pickTarget}
                pickBusy={reverse.isPending}
                onPick={handlePick}
                onCancelPick={() => setPickTarget(null)}
                focus={focus}
                planningMessage={planningMessage}
                className={clsx(
                  plan || planning.isPending
                    ? 'h-[clamp(360px,58vh,600px)]'
                    : 'h-[clamp(440px,72vh,760px)]',
                )}
              />
            </div>

            {planFailure && !planning.isPending && (
              <PlanError
                message={planFailure.message}
                onRetry={
                  planFailure.retryable && lastRequest
                    ? () => planning.mutate(lastRequest)
                    : undefined
                }
              />
            )}

            {planning.isPending && (
              <ResultsLoading message={planningMessage ?? 'Planning your trip'} />
            )}

            {hasResults && (
              <Results
                plan={plan}
                tab={tab}
                onTabChange={setTab}
                onSelectStop={selectStop}
                saving={saveTrip.isPending}
                saved={savedTripId !== null}
                onSave={onSave}
              />
            )}
          </div>
        </div>
      </main>

      <AppFooter />

      {auth && (
        <AuthDialog
          mode={auth.mode}
          reason={auth.reason}
          onModeChange={(mode) => setAuth((current) => (current ? { ...current, mode } : current))}
          onClose={closeAuth}
          onSuccess={onAuthSuccess}
        />
      )}
      {tripsOpen && session.user && (
        <TripsDrawer onClose={() => setTripsOpen(false)} onOpenTrip={openSavedTrip} />
      )}
    </div>
  )
}
