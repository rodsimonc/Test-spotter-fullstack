import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Place, PlanResponse } from '@/api/types'
import { makePlan } from '@/test/makePlan'
import { TripMap } from './TripMap'

// jsdom has no layout, and Leaflet divides by the container size. Give it one.
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 800,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  })
})

afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
})

const NO_PLACES: Record<'current' | 'pickup' | 'dropoff', Place | null> = {
  current: null,
  pickup: null,
  dropoff: null,
}

function placesOf(plan: PlanResponse) {
  return {
    current: plan.request.current,
    pickup: plan.request.pickup,
    dropoff: plan.request.dropoff,
  }
}

type MapProps = Parameters<typeof TripMap>[0]

function mapProps(overrides: Partial<MapProps> = {}): MapProps {
  return {
    places: NO_PLACES,
    plan: null,
    pickTarget: null,
    pickBusy: false,
    onPick: () => {},
    onCancelPick: () => {},
    focus: null,
    planningMessage: null,
    ...overrides,
  }
}

function renderMap(overrides: Partial<MapProps> = {}) {
  const view = render(<TripMap {...mapProps(overrides)} />)
  return {
    ...view,
    update: (next: Partial<MapProps>) =>
      view.rerender(<TripMap {...mapProps({ ...overrides, ...next })} />),
  }
}

function renderPlanned(overrides: Partial<MapProps> = {}, plan = makePlan()) {
  return { plan, ...renderMap({ plan, places: placesOf(plan), ...overrides }) }
}

describe('TripMap', () => {
  describe('first run', () => {
    it('shows the how-it-works card over the map', () => {
      renderMap()
      expect(screen.getByTestId('map')).toHaveAttribute('aria-label', 'Route map')
      const empty = screen.getByTestId('empty-state')
      expect(empty).toHaveTextContent('Plan a trip to see it here')
      expect(within(empty).getAllByRole('listitem')).toHaveLength(3)
    })

    it('does not show the legend before there is a plan', () => {
      renderMap()
      expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument()
    })

    it('mounts the tile layer with the OpenStreetMap credit', () => {
      renderMap()
      const credit = screen.getByRole('link', { name: 'OpenStreetMap' })
      expect(credit).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
      expect(credit).toHaveAttribute('rel', 'noreferrer')
    })
  })

  describe('pins before planning', () => {
    it('drops a pin for each chosen place and hides the first-run card', () => {
      const plan = makePlan()
      renderMap({
        places: { current: plan.request.current, pickup: null, dropoff: plan.request.dropoff },
      })
      const pins = document.querySelectorAll('.leaflet-marker-icon')
      expect(pins).toHaveLength(2)
      expect(screen.getByTitle(plan.request.current.label)).toBeInTheDocument()
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    })

    it('moves a pin when the place changes', () => {
      const plan = makePlan()
      const { update } = renderMap({ places: { ...NO_PLACES, current: plan.request.current } })
      update({ places: { ...NO_PLACES, current: plan.request.pickup } })
      expect(document.querySelectorAll('.leaflet-marker-icon')).toHaveLength(1)
      expect(screen.getByTitle(plan.request.pickup.label)).toBeInTheDocument()
    })
  })

  describe('with a plan', () => {
    it('puts a marker on every stop except the closing one', () => {
      const { plan } = renderPlanned()
      const numbered = plan.stops.filter((s) => s.kind !== 'end')
      for (const stop of numbered) {
        expect(screen.getByTestId(`marker-${stop.id}`)).toBeInTheDocument()
      }
      expect(screen.queryByTestId('marker-stop-end')).not.toBeInTheDocument()
      expect(document.querySelectorAll('.stop-marker')).toHaveLength(numbered.length)
    })

    it('numbers the markers in itinerary order', () => {
      renderPlanned()
      expect(within(screen.getByTestId('marker-stop-start')).getByText('1')).toBeInTheDocument()
      expect(within(screen.getByTestId('marker-stop-2')).getByText('2')).toBeInTheDocument()
      expect(within(screen.getByTestId('marker-stop-10')).getByText('6')).toBeInTheDocument()
    })

    it('replaces the place pins with the stop markers rather than doubling them', () => {
      renderPlanned()
      expect(document.querySelectorAll('.leaflet-marker-icon')).toHaveLength(6)
    })

    it('gives a marker the new title when a second plan reuses its id', () => {
      const first = makePlan()
      const { update } = renderPlanned({}, first)
      expect(screen.getByTestId('marker-stop-2').getAttribute('title')).toBe('Pickup, Memphis, TN')

      const second: PlanResponse = {
        ...first,
        stops: first.stops.map((s) =>
          s.id === 'stop-2' ? { ...s, place: 'Nashville, TN', lat: 36.16, lon: -86.78 } : s,
        ),
      }
      act(() => update({ plan: second }))
      expect(screen.getByTestId('marker-stop-2').getAttribute('title')).toBe(
        'Pickup, Nashville, TN',
      )
    })

    it('shows the legend, and it folds away', async () => {
      renderPlanned()
      const legend = screen.getByTestId('map-legend')
      expect(legend).toHaveTextContent('To pickup, empty')
      expect(legend).toHaveTextContent('To dropoff, loaded')
      for (const label of [
        'Start',
        'Pickup',
        'Dropoff',
        'Fuel',
        '30-minute break',
        '10-hour rest',
        '34-hour restart',
      ]) {
        expect(within(legend).getByText(label)).toBeInTheDocument()
      }
      const toggle = within(legend).getByRole('button', { name: 'Legend' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await userEvent.setup().click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      expect(legend).not.toHaveTextContent('To pickup, empty')
    })

    it('draws the route in two legs with a white casing under each', () => {
      renderPlanned()
      // Four polylines: two casings and the two colored legs.
      const paths = document.querySelectorAll('path.leaflet-interactive, svg path')
      expect(paths.length).toBeGreaterThanOrEqual(4)
      const strokes = Array.from(paths).map((p) => p.getAttribute('stroke'))
      expect(strokes).toContain('#008080')
      expect(strokes).toContain('#f84960')
      expect(strokes.filter((s) => s === '#ffffff').length).toBe(2)
    })
  })

  describe('popups', () => {
    it('opens a popup with the stop details when its marker is clicked', () => {
      renderPlanned()
      fireEvent.click(screen.getByTestId('marker-stop-2'))
      const popup = document.querySelector('.leaflet-popup') as HTMLElement
      expect(popup).not.toBeNull()
      expect(popup).toHaveTextContent('Pickup')
      expect(popup).toHaveTextContent('Memphis, TN')
      expect(popup).toHaveTextContent('1:32 PM to 2:32 PM')
      expect(popup).toHaveTextContent('Duration')
      expect(popup).toHaveTextContent('1 h')
      expect(popup).toHaveTextContent('452 mi')
      expect(popup).toHaveTextContent('Pickup, loading (1 hr)')
    })

    it('shows a single time for a stop with no duration', () => {
      renderPlanned()
      fireEvent.click(screen.getByTestId('marker-stop-start'))
      const popup = document.querySelector('.leaflet-popup') as HTMLElement
      expect(popup).toHaveTextContent('Wed, Oct 7, 6:00 AM')
      expect(popup).not.toHaveTextContent('Duration')
    })

    it('renders hostile stop text as text, in the popup and on the marker', () => {
      const hostile = '<img src=x onerror=alert(1)>'
      const base = makePlan()
      const stops = base.stops.map((s) =>
        s.id === 'stop-2'
          ? { ...s, title: hostile, place: `<b>${hostile}</b>`, note: `<script>alert(2)</script>` }
          : s,
      )
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
      renderPlanned({}, { ...base, stops })

      const marker = screen.getByTestId('marker-stop-2')
      expect(marker.getAttribute('title')).toContain(hostile)
      fireEvent.click(marker)
      const popup = document.querySelector('.leaflet-popup') as HTMLElement
      expect(popup).toHaveTextContent(hostile)
      expect(popup.querySelector('img, b, script')).toBeNull()
      expect(document.querySelector('img[src="x"]')).toBeNull()
      expect(alert).not.toHaveBeenCalled()
    })

    it('never puts API text through innerHTML on the marker face', () => {
      const base = makePlan()
      const stops = base.stops.map((s) =>
        s.id === 'stop-2' ? { ...s, title: '<svg onload=alert(1)>' } : s,
      )
      renderPlanned({}, { ...base, stops })
      const marker = screen.getByTestId('marker-stop-2')
      expect(marker.querySelector('svg[onload]')).toBeNull()
      expect(marker.innerHTML).not.toContain('onload')
    })
  })

  describe('focusing a stop from the itinerary', () => {
    it('opens that stop popup', () => {
      const { update } = renderPlanned()
      expect(document.querySelector('.leaflet-popup')).toBeNull()
      act(() => update({ focus: { id: 'stop-4', nonce: 1 } }))
      const popup = document.querySelector('.leaflet-popup') as HTMLElement
      expect(popup).not.toBeNull()
      expect(popup).toHaveTextContent('10-hour rest')
    })

    it('uses the dropoff marker for the closing stop', () => {
      const { update } = renderPlanned()
      act(() => update({ focus: { id: 'stop-end', nonce: 1 } }))
      expect(document.querySelector('.leaflet-popup')).toHaveTextContent('Dropoff')
    })

    it('ignores an id the plan does not have', () => {
      const { update } = renderPlanned()
      act(() => update({ focus: { id: 'nope', nonce: 1 } }))
      expect(document.querySelector('.leaflet-popup')).toBeNull()
    })
  })

  describe('pick on the map', () => {
    it('shows a banner that names the target and how to cancel', () => {
      renderMap({ pickTarget: 'pickup' })
      const banner = screen.getByTestId('pick-banner')
      expect(banner).toHaveTextContent('Click the map to set the pickup.')
      expect(banner).toHaveTextContent('Esc cancels.')
      expect(screen.getByTestId('map')).toHaveClass('is-picking')
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    })

    it.each([
      ['current', 'your current location'],
      ['pickup', 'the pickup'],
      ['dropoff', 'the dropoff'],
    ] as const)('names the %s target', (target, words) => {
      renderMap({ pickTarget: target })
      expect(screen.getByTestId('pick-banner')).toHaveTextContent(words)
    })

    it('reports a map click as a point', () => {
      const onPick = vi.fn()
      renderMap({ pickTarget: 'dropoff', onPick })
      fireEvent.click(document.querySelector('.leaflet-container') as HTMLElement, {
        clientX: 400,
        clientY: 300,
      })
      expect(onPick).toHaveBeenCalledTimes(1)
      const [lat, lon] = onPick.mock.calls[0] as [number, number]
      expect(Number.isFinite(lat)).toBe(true)
      expect(Number.isFinite(lon)).toBe(true)
    })

    it('ignores map clicks when not picking', () => {
      const onPick = vi.fn()
      renderMap({ onPick })
      fireEvent.click(document.querySelector('.leaflet-container') as HTMLElement, {
        clientX: 400,
        clientY: 300,
      })
      expect(onPick).not.toHaveBeenCalled()
    })

    it('cancels from the banner', async () => {
      const onCancelPick = vi.fn()
      renderMap({ pickTarget: 'current', onCancelPick })
      await userEvent
        .setup()
        .click(within(screen.getByTestId('pick-banner')).getByRole('button', { name: 'Cancel' }))
      expect(onCancelPick).toHaveBeenCalledTimes(1)
    })

    it('says it is looking the spot up while the lookup runs', () => {
      renderMap({ pickTarget: 'current', pickBusy: true })
      expect(screen.getByTestId('pick-banner')).toHaveTextContent('Looking up that spot')
    })
  })

  describe('while planning', () => {
    it('shows the status chip and hides the legend and first-run card', () => {
      renderMap({ planningMessage: 'Finding the route' })
      expect(screen.getByText('Finding the route')).toBeInTheDocument()
      expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    })

    it('hides the legend until the plan arrives', () => {
      renderPlanned({ planningMessage: 'Filling in the log sheets' })
      expect(screen.queryByTestId('map-legend')).not.toBeInTheDocument()
    })
  })
})
