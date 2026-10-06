import { useEffect, useMemo, useState } from 'react'
import { divIcon } from 'leaflet'
import { Marker } from 'react-leaflet'

const SIZE = 44
const PARTS = ['point-pulse-ring', 'point-pulse-ring point-pulse-ring-late', 'point-pulse-dot']

interface PointPulseProps {
  point: { lat: number; lon: number }
  /** How long the ring stays on the map. */
  lifetimeMs: number
}

/** Builds the ring from fixed markup. Nothing from the API reaches the DOM here. */
function buildPulse(): HTMLElement {
  const root = document.createElement('div')
  root.className = 'point-pulse'
  for (const className of PARTS) {
    const part = document.createElement('span')
    part.className = className
    root.appendChild(part)
  }
  return root
}

/**
 * A short pulse ring on a spot the person picked in the directions. It is a marker with no
 * interaction, so it never takes a click or a tab stop from the route underneath. The parent keys
 * it by the focus request, so each click mounts a fresh ring and the animation starts over.
 */
export function PointPulse({ point, lifetimeMs }: PointPulseProps) {
  const [gone, setGone] = useState(false)
  const [element] = useState(buildPulse)
  const icon = useMemo(
    () =>
      divIcon({
        html: element,
        className: 'point-pulse-marker',
        iconSize: [SIZE, SIZE],
        iconAnchor: [SIZE / 2, SIZE / 2],
      }),
    [element],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => setGone(true), lifetimeMs)
    return () => window.clearTimeout(timer)
  }, [lifetimeMs])

  if (gone) return null
  return (
    <Marker
      position={[point.lat, point.lon]}
      icon={icon}
      interactive={false}
      keyboard={false}
      zIndexOffset={500}
      eventHandlers={{
        add: (event) => {
          event.target.getElement()?.setAttribute('data-testid', 'point-pulse')
        },
      }}
    />
  )
}
