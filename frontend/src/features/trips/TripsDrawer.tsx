import { useId, useRef, useState } from 'react'
import { Bookmark, RotateCw, X } from 'lucide-react'
import { ApiError } from '@/api/client'
import { useDeleteTrip, useRenameTrip, useTrips } from '@/api/hooks'
import { getTrip } from '@/api/endpoints'
import type { Trip } from '@/api/types'
import { Banner } from '@/components/ui/Banner'
import { Button, IconButton } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Skeleton } from '@/components/ui/Skeleton'
import { useToast } from '@/components/ui/Toast'
import { TripRow } from './TripRow'

interface TripsDrawerProps {
  onClose: () => void
  /** Called with the full trip once it has loaded. The caller closes the drawer. */
  onOpenTrip: (trip: Trip) => void
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export function TripsDrawer({ onClose, onOpenTrip }: TripsDrawerProps) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const toast = useToast()
  const trips = useTrips(true)
  const rename = useRenameTrip()
  const remove = useDeleteTrip()
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const rows = trips.data?.results ?? []

  async function open(id: string) {
    setOpeningId(id)
    try {
      onOpenTrip(await getTrip(id))
    } catch (error) {
      toast.show(errorText(error, "Couldn't open that trip. Try again."), 'error')
      setOpeningId(null)
    }
  }

  function saveName(id: string, title: string) {
    const clean = title.trim()
    if (!clean) return
    rename.mutate(
      { id, title: clean },
      {
        onSuccess: () => {
          setRenamingId(null)
          toast.show('Trip renamed.')
        },
        onError: (error) => toast.show(errorText(error, "Couldn't rename that trip."), 'error'),
      },
    )
  }

  function confirmDelete(id: string) {
    remove.mutate(id, {
      onSuccess: () => {
        setConfirmingId(null)
        toast.show('Trip deleted.')
      },
      onError: (error) => toast.show(errorText(error, "Couldn't delete that trip."), 'error'),
    })
  }

  return (
    <Modal
      variant="drawer"
      onClose={onClose}
      labelledBy={titleId}
      testId="trips-drawer"
      initialFocus={closeRef}
    >
      <div className="flex items-center justify-between gap-4 border-b border-ink-100 px-6 py-5">
        <div>
          <h2 id={titleId} className="text-xl font-bold text-teal-950">
            My trips
          </h2>
          {trips.data && rows.length > 0 && (
            <p className="mt-0.5 text-sm text-ink-600">{trips.data.count} saved, newest first</p>
          )}
        </div>
        <IconButton
          ref={closeRef}
          aria-label="Close my trips"
          data-testid="btn-close-trips"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-5" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-ink-25 px-4 py-4 sm:px-5">
        {trips.isPending && (
          <div role="status" aria-busy="true" aria-label="Loading your trips" className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-3 rounded-2xl bg-white p-4 ring-1 ring-ink-200">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-8 w-24" />
              </div>
            ))}
          </div>
        )}

        {trips.isError && (
          <Banner
            tone="error"
            role="alert"
            title="We couldn't load your trips"
            action={
              <Button
                size="sm"
                variant="secondary"
                data-testid="btn-retry-trips"
                loading={trips.isFetching}
                icon={<RotateCw aria-hidden="true" className="size-4" />}
                onClick={() => void trips.refetch()}
              >
                Retry
              </Button>
            }
          >
            <p className="mt-0.5">
              {errorText(trips.error, 'Check your connection and try again.')}
            </p>
          </Banner>
        )}

        {trips.isSuccess && rows.length === 0 && (
          <div
            data-testid="trips-empty"
            className="mt-6 flex flex-col items-center rounded-3xl bg-white px-6 py-10 text-center ring-1 ring-ink-200"
          >
            <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
              <Bookmark aria-hidden="true" className="size-7" />
            </span>
            <p className="mt-4 text-base font-bold text-teal-950">No saved trips yet</p>
            <p className="mt-1 max-w-[18rem] text-sm leading-relaxed text-ink-600">
              Plan a trip, then press Save trip. It will wait for you here.
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((trip) => (
              <TripRow
                key={trip.id}
                trip={trip}
                opening={openingId === trip.id}
                disabled={openingId !== null && openingId !== trip.id}
                renaming={renamingId === trip.id}
                renameBusy={rename.isPending}
                confirmingDelete={confirmingId === trip.id}
                deleteBusy={remove.isPending}
                onOpen={() => void open(trip.id)}
                onStartRename={() => {
                  setConfirmingId(null)
                  setRenamingId(trip.id)
                }}
                onCancelRename={() => setRenamingId(null)}
                onSaveRename={(title) => saveName(trip.id, title)}
                onAskDelete={() => {
                  setRenamingId(null)
                  setConfirmingId(trip.id)
                }}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={() => confirmDelete(trip.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
