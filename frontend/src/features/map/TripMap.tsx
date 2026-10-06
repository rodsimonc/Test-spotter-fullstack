import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { latLngBounds, type LatLngExpression, type Marker as LeafletMarker } from 'leaflet'
import { MapContainer, Polyline, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import clsx from 'clsx'
import type { Place, PlanResponse } from '@/api/types'
import type { PlaceKey } from '@/features/trip-form/formState'
import { MapLegend } from './MapLegend'
import { EmptyOverlay, PickBanner, PlanningChip } from './MapOverlays'
import { PlacePin, StopMarker } from './StopMarker'
import { ROUTE_COLORS } from './stopKinds'

export interface StopFocusRequest {
  id: string
  /** Changes on every click so choosing the same stop twice still pans. */
  nonce: number
}

interface TripMapProps {
  /** Places currently in the form. Shown as pins until a plan covers them. */
  places: Record<PlaceKey, Place | null>
  plan: PlanResponse | null
  pickTarget: PlaceKey | null
  pickBusy: boolean
  onPick: (lat: number, lon: number) => void
  onCancelPick: () => void
  focus: StopFocusRequest | null
  planningMessage: string | null
  className?: string
}

const US_CENTER: LatLngExpression = [39.5, -98.35]
const PIN_KIND = { current: 'start', pickup: 'pickup', dropoff: 'dropoff' } as const

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function samePoint(a: Place, b: Place): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6
}

/** Keeps Leaflet's idea of the container size current when the layout changes around it. */
function SizeWatcher() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])
  return null
}

function FitToTrip({ plan, pins }: { plan: PlanResponse | null; pins: Place[] }) {
  const map = useMap()
  const pinKey = pins.map((p) => `${p.lat},${p.lon}`).join('|')

  useEffect(() => {
    if (!plan) return
    map.fitBounds(plan.route.bounds, { padding: [48, 48], animate: !prefersReducedMotion() })
  }, [map, plan])

  useEffect(() => {
    if (plan || pins.length === 0) return
    const animate = !prefersReducedMotion()
    if (pins.length === 1) {
      map.setView([pins[0].lat, pins[0].lon], Math.max(map.getZoom(), 8), { animate })
    } else {
      map.fitBounds(latLngBounds(pins.map((p) => [p.lat, p.lon] as [number, number])), {
        padding: [64, 64],
        animate,
      })
    }
    // `pinKey` stands in for the pins array, which is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, plan, pinKey])

  return null
}

function PickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (event) => onPick(event.latlng.lat, event.latlng.lng) })
  return null
}

function StopFocus({
  focus,
  plan,
  markers,
}: {
  focus: StopFocusRequest | null
  plan: PlanResponse | null
  markers: RefObject<Map<string, LeafletMarker>>
}) {
  const map = useMap()

  useEffect(() => {
    if (!focus || !plan) return
    const stop = plan.stops.find((s) => s.id === focus.id)
    if (!stop) return
    // The end of the trip shares the dropoff's spot, so it borrows that marker.
    const markerStop =
      stop.kind === 'end' ? (plan.stops.find((s) => s.kind === 'dropoff') ?? stop) : stop
    const marker = markers.current.get(markerStop.id)
    if (!marker) return

    const target = marker.getLatLng()
    const zoom = Math.max(map.getZoom(), 9)
    const animate = !prefersReducedMotion()
    const open = () => marker.openPopup()
    const alreadyThere = map.getZoom() === zoom && map.getCenter().distanceTo(target) < 25

    if (alreadyThere) {
      open()
      return
    }
    // Close the old popup now, so it doesn't ride along while the map pans to the new stop.
    map.closePopup()
    // Open the new one once the map stops moving, or its auto-pan would fight the move.
    map.once('moveend', open)
    map.setView(target, zoom, { animate })
    return () => {
      map.off('moveend', open)
    }
    // Only a new click should move the map, not a re-render of the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce])

  return null
}

export function TripMap({
  places,
  plan,
  pickTarget,
  pickBusy,
  onPick,
  onCancelPick,
  focus,
  planningMessage,
  className,
}: TripMapProps) {
  const markers = useRef(new Map<string, LeafletMarker>())

  const pins = useMemo(() => {
    const keys: PlaceKey[] = ['current', 'pickup', 'dropoff']
    return keys.flatMap((key) => {
      const place = places[key]
      if (!place) return []
      if (plan && samePoint(place, plan.request[key])) return []
      return [{ key, place }]
    })
  }, [places, plan])

  const pinPlaces = useMemo(() => pins.map((p) => p.place), [pins])

  const legs = useMemo(() => {
    if (!plan) return null
    const { geometry, leg_end_indices: ends } = plan.route
    return {
      toPickup: geometry.slice(0, ends[0] + 1),
      loaded: geometry.slice(ends[0], ends[1] + 1),
    }
  }, [plan])

  // Numbers follow the itinerary order. The closing "end" stop sits on the dropoff and has no marker.
  const numbered = useMemo(() => {
    if (!plan) return []
    return plan.stops
      .filter((s) => s.kind !== 'end')
      .map((stop, index) => ({ stop, number: index + 1 }))
  }, [plan])

  const showEmpty = !plan && pins.length === 0 && !pickTarget && !planningMessage

  function registerMarker(id: string, marker: LeafletMarker | null) {
    if (marker) markers.current.set(id, marker)
    else markers.current.delete(id)
  }

  return (
    <div
      data-testid="map"
      role="region"
      aria-label="Route map"
      className={clsx('trip-map relative overflow-hidden', pickTarget && 'is-picking', className)}
    >
      <MapContainer center={US_CENTER} zoom={4} minZoom={2} zoomControl={false} worldCopyJump>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          subdomains="abc"
          maxZoom={19}
        />
        <ZoomControl position="topright" />
        <SizeWatcher />
        <FitToTrip plan={plan} pins={pinPlaces} />
        {pickTarget && <PickHandler onPick={onPick} />}

        {legs && (
          <>
            {/* White casing first so each line stays readable over roads and labels. */}
            <Polyline
              positions={legs.toPickup}
              pathOptions={{
                color: '#ffffff',
                weight: 9,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              interactive={false}
            />
            <Polyline
              positions={legs.loaded}
              pathOptions={{
                color: '#ffffff',
                weight: 9,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              interactive={false}
            />
            <Polyline
              positions={legs.toPickup}
              pathOptions={{
                color: ROUTE_COLORS.toPickup,
                weight: 5,
                dashArray: '2 10',
                lineCap: 'round',
                lineJoin: 'round',
              }}
              interactive={false}
            />
            <Polyline
              positions={legs.loaded}
              pathOptions={{
                color: ROUTE_COLORS.loaded,
                weight: 5,
                lineCap: 'round',
                lineJoin: 'round',
              }}
              interactive={false}
            />
          </>
        )}

        {/* Leaflet reads a marker's title once, so the key carries what the title says. */}
        {pins.map(({ key, place }) => (
          <PlacePin
            key={`${key}:${place.label}:${place.lat}:${place.lon}`}
            kind={PIN_KIND[key]}
            label={place.label}
            lat={place.lat}
            lon={place.lon}
          />
        ))}
        {numbered.map(({ stop, number }) => (
          <StopMarker
            key={`${stop.id}:${stop.title}:${stop.place}:${stop.lat}:${stop.lon}`}
            stop={stop}
            number={number}
            onMarker={registerMarker}
          />
        ))}
        <StopFocus focus={focus} plan={plan} markers={markers} />
      </MapContainer>

      {plan && !planningMessage && <MapLegend />}
      {pickTarget && <PickBanner target={pickTarget} busy={pickBusy} onCancel={onCancelPick} />}
      {planningMessage && <PlanningChip message={planningMessage} />}
      {showEmpty && <EmptyOverlay />}
    </div>
  )
}
