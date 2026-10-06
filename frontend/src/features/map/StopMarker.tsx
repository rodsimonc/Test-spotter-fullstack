import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { divIcon, type Marker as LeafletMarker } from 'leaflet'
import { Marker, Popup } from 'react-leaflet'
import type { Stop, StopKind } from '@/api/types'
import { formatDuration, formatMiles } from '@/lib/format'
import { formatDateTime, formatRange } from '@/lib/time'
import { STOP_KIND_STYLE } from './stopKinds'

const SIZE = 38

/** Round badge with the kind's icon and an optional stop number. Static markup only. */
export function MarkerBadge({ kind, number }: { kind: StopKind; number?: number }) {
  const { color, Icon } = STOP_KIND_STYLE[kind]
  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <div
        className="grid size-full place-items-center rounded-full shadow-[0_4px_10px_rgb(4_61_76/0.4)] ring-[3px] ring-white transition-transform duration-150 hover:scale-110"
        style={{ background: color }}
      >
        <Icon aria-hidden="true" className="size-[18px] text-white" strokeWidth={2.25} />
      </div>
      {number !== undefined && (
        <span className="absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-white px-1 text-[10px] leading-none font-bold text-teal-950 shadow ring-1 ring-ink-300">
          {number}
        </span>
      )}
    </div>
  )
}

/**
 * A Leaflet marker whose face is a React tree. The icon is a detached element that React fills
 * through a portal, so nothing from the API ever passes through innerHTML.
 */
function useBadgeIcon() {
  const [element] = useState(() => document.createElement('div'))
  const icon = useMemo(
    () =>
      divIcon({
        html: element,
        className: 'stop-marker',
        iconSize: [SIZE, SIZE],
        iconAnchor: [SIZE / 2, SIZE / 2],
        popupAnchor: [0, -SIZE / 2],
      }),
    [element],
  )
  return { element, icon }
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-ink-600">{label}</dt>
      <dd className="text-right font-medium text-ink-900 tabular-nums">{children}</dd>
    </div>
  )
}

export function StopPopup({ stop }: { stop: Stop }) {
  const { color, Icon } = STOP_KIND_STYLE[stop.kind]
  const timed = stop.duration_minutes > 0
  return (
    <div className="w-[250px] p-4">
      <div className="flex items-start gap-3 pr-5">
        <span
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-white"
          style={{ background: color }}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm leading-tight font-bold text-ink-900">{stop.title}</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink-600">{stop.place}</p>
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 border-t border-ink-100 pt-3 text-[13px]">
        {timed ? (
          <>
            <Row label="Time">{formatRange(stop.arrive_at, stop.depart_at)}</Row>
            <Row label="Duration">{formatDuration(stop.duration_minutes)}</Row>
          </>
        ) : (
          <Row label="Time">{formatDateTime(stop.arrive_at)}</Row>
        )}
        <Row label="Trip mile">{formatMiles(stop.mile)}</Row>
      </dl>
      {stop.note && <p className="mt-2.5 text-[13px] leading-snug text-ink-700">{stop.note}</p>}
    </div>
  )
}

interface StopMarkerProps {
  stop: Stop
  number?: number
  onMarker: (id: string, marker: LeafletMarker | null) => void
}

const RAISED: StopKind[] = ['start', 'pickup', 'dropoff', 'end']

export function StopMarker({ stop, number, onMarker }: StopMarkerProps) {
  const { element, icon } = useBadgeIcon()
  return (
    <>
      <Marker
        position={[stop.lat, stop.lon]}
        icon={icon}
        title={`${stop.title}, ${stop.place}`}
        zIndexOffset={RAISED.includes(stop.kind) ? 600 : 0}
        riseOnHover
        ref={(marker) => onMarker(stop.id, marker)}
        eventHandlers={{
          add: (event) => {
            // Set through the DOM API so the id is never parsed as markup.
            ;(event.target as LeafletMarker)
              .getElement()
              ?.setAttribute('data-testid', `marker-${stop.id}`)
          },
        }}
      >
        <Popup minWidth={250} maxWidth={250} autoPanPadding={[24, 24]}>
          <StopPopup stop={stop} />
        </Popup>
      </Marker>
      {createPortal(<MarkerBadge kind={stop.kind} number={number} />, element)}
    </>
  )
}

interface PlacePinProps {
  kind: Extract<StopKind, 'start' | 'pickup' | 'dropoff'>
  label: string
  lat: number
  lon: number
}

/** Marker for a chosen place before the trip is planned. */
export function PlacePin({ kind, label, lat, lon }: PlacePinProps) {
  const { element, icon } = useBadgeIcon()
  return (
    <>
      <Marker position={[lat, lon]} icon={icon} title={label} keyboard={false} />
      {createPortal(<MarkerBadge kind={kind} />, element)}
    </>
  )
}
