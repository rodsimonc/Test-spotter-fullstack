import type { ComponentType } from 'react'
import {
  BedDouble,
  Coffee,
  Flag,
  Fuel,
  Navigation,
  Package,
  PackageCheck,
  RotateCcw,
  type LucideProps,
} from 'lucide-react'
import type { StopKind } from '@/api/types'

export interface StopKindStyle {
  label: string
  /** Fill for the map badge and the itinerary icon tile. */
  color: string
  Icon: ComponentType<LucideProps>
}

/** One place for how each kind of stop looks, on the map and in the itinerary. */
export const STOP_KIND_STYLE: Record<StopKind, StopKindStyle> = {
  start: { label: 'Start', color: '#f84960', Icon: Navigation },
  pickup: { label: 'Pickup', color: '#008080', Icon: Package },
  dropoff: { label: 'Dropoff', color: '#043d4c', Icon: PackageCheck },
  fuel: { label: 'Fuel', color: '#b45f06', Icon: Fuel },
  break: { label: '30-minute break', color: '#52707c', Icon: Coffee },
  rest: { label: '10-hour rest', color: '#4a44a8', Icon: BedDouble },
  restart: { label: '34-hour restart', color: '#963a86', Icon: RotateCcw },
  end: { label: 'Trip end', color: '#043d4c', Icon: Flag },
}

/** Kinds that get their own entry in the map legend. */
export const LEGEND_KINDS: StopKind[] = [
  'start',
  'pickup',
  'dropoff',
  'fuel',
  'break',
  'rest',
  'restart',
]

export const ROUTE_COLORS = {
  toPickup: '#008080',
  loaded: '#f84960',
} as const
