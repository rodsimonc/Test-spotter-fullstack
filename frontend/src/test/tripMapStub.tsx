// Light stand-in for the Leaflet map in app-level tests. It reports what App passes down and
// lets a test click "the map". Use it with: vi.mock('@/features/map/TripMap', () => import('@/test/tripMapStub'))
import type { ComponentProps } from 'react'
import type { TripMap as RealTripMap } from '@/features/map/TripMap'

export const MAP_CLICK = { lat: 41.5, lon: -87.25 }

export function TripMap(props: ComponentProps<typeof RealTripMap>) {
  return (
    <div
      data-testid="map"
      data-pick={props.pickTarget ?? ''}
      data-pick-busy={String(props.pickBusy)}
      data-focus={props.focus?.id ?? ''}
      data-focus-point={
        props.focus?.point ? `${props.focus.point.lat},${props.focus.point.lon}` : ''
      }
      data-stops={props.plan?.stops.length ?? 0}
      data-planning={props.planningMessage ?? ''}
      data-places={Object.values(props.places)
        .map((p) => p?.label ?? '')
        .join('|')}
    >
      <button type="button" onClick={() => props.onPick(MAP_CLICK.lat, MAP_CLICK.lon)}>
        Click the map
      </button>
      <button type="button" onClick={props.onCancelPick}>
        Cancel pick
      </button>
    </div>
  )
}
