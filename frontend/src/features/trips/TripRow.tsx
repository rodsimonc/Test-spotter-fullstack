import { useState, type KeyboardEvent } from 'react'
import { ArrowRight, Check, FolderOpen, Pencil, Trash, X } from 'lucide-react'
import type { TripSummary } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { formatMiles, placeCity } from '@/lib/format'
import { formatRelative } from '@/lib/time'

interface TripRowProps {
  trip: TripSummary
  opening: boolean
  /** Another row is opening, so this one waits. */
  disabled: boolean
  renaming: boolean
  renameBusy: boolean
  confirmingDelete: boolean
  deleteBusy: boolean
  onOpen: () => void
  onStartRename: () => void
  onCancelRename: () => void
  onSaveRename: (title: string) => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
}

function RenameForm({
  trip,
  busy,
  onSave,
  onCancel,
}: {
  trip: TripSummary
  busy: boolean
  onSave: (title: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(trip.title)

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    }
  }

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        onSave(draft)
      }}
    >
      <input
        autoFocus
        data-testid={`input-rename-trip-${trip.id}`}
        aria-label="Trip name"
        value={draft}
        maxLength={120}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onFocus={(event) => event.currentTarget.select()}
        className="h-9 min-w-0 flex-1 rounded-lg bg-white px-3 text-base font-semibold sm:text-[15px] text-ink-900 ring-2 ring-teal-600 focus:outline-none"
      />
      <IconButton
        type="submit"
        aria-label="Save name"
        disabled={busy || draft.trim() === ''}
        className="bg-teal-600 text-white hover:bg-teal-700 hover:text-white"
      >
        <Check aria-hidden="true" className="size-4" />
      </IconButton>
      <IconButton aria-label="Cancel rename" onClick={onCancel}>
        <X aria-hidden="true" className="size-4" />
      </IconButton>
    </form>
  )
}

export function TripRow({
  trip,
  opening,
  disabled,
  renaming,
  renameBusy,
  confirmingDelete,
  deleteBusy,
  onOpen,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: TripRowProps) {
  const places = [trip.current_label, trip.pickup_label, trip.dropoff_label].map(placeCity)

  return (
    <li
      data-testid={`trip-row-${trip.id}`}
      className="animate-rise-in rounded-2xl bg-white p-4 shadow-sm ring-1 ring-ink-200 transition-shadow hover:shadow-[var(--shadow-card)]"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameForm
              trip={trip}
              busy={renameBusy}
              onSave={onSaveRename}
              onCancel={onCancelRename}
            />
          ) : (
            <h3
              className="truncate text-[15px] leading-9 font-bold text-teal-950"
              title={trip.title}
            >
              {trip.title}
            </h3>
          )}
        </div>
        {!renaming && (
          <div className="-mt-0.5 -mr-1 flex shrink-0 gap-0.5">
            <IconButton
              aria-label={`Rename ${trip.title}`}
              data-testid={`btn-rename-trip-${trip.id}`}
              onClick={onStartRename}
            >
              <Pencil aria-hidden="true" className="size-4" />
            </IconButton>
            <IconButton
              tone="danger"
              aria-label={`Delete ${trip.title}`}
              data-testid={`btn-delete-trip-${trip.id}`}
              onClick={onAskDelete}
            >
              <Trash aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        )}
      </div>

      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-ink-700">
        {places.map((place, index) => (
          <span key={index} className="inline-flex items-center gap-1.5">
            {index > 0 && (
              <>
                <ArrowRight aria-hidden="true" className="size-3.5 text-ink-400" />
                <span className="sr-only">to</span>
              </>
            )}
            {place}
          </span>
        ))}
      </p>
      <p className="mt-1.5 text-[13px] text-ink-600 tabular-nums">
        {formatMiles(trip.distance_miles)} &middot; {trip.days} {trip.days === 1 ? 'day' : 'days'}{' '}
        &middot; Saved {formatRelative(trip.created_at)}
      </p>

      {confirmingDelete ? (
        <div
          role="alertdialog"
          aria-label={`Delete ${trip.title}?`}
          className="mt-3.5 rounded-xl bg-coral-50 p-3 ring-1 ring-coral-200"
        >
          <p className="text-sm font-semibold text-coral-800">Delete this trip?</p>
          <p className="mt-0.5 text-[13px] text-coral-800">This can't be undone.</p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              data-testid="btn-cancel-delete"
              onClick={onCancelDelete}
            >
              Keep it
            </Button>
            <Button
              size="sm"
              variant="danger"
              data-testid="btn-confirm-delete"
              loading={deleteBusy}
              onClick={onConfirmDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5">
          <Button
            size="sm"
            variant="dark"
            data-testid={`btn-open-trip-${trip.id}`}
            loading={opening}
            disabled={disabled || renaming}
            icon={<FolderOpen aria-hidden="true" className="size-4" />}
            onClick={onOpen}
          >
            Open
          </Button>
        </div>
      )}
    </li>
  )
}
