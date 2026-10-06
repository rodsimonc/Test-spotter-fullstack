import type { PlanRequest, StopKind } from '@/api/types'

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** "1,284" */
export function formatNumber(n: number): string {
  return NUMBER.format(Math.round(n))
}

/** "1,284 mi" */
export function formatMiles(miles: number): string {
  return `${formatNumber(miles)} mi`
}

/** "4 h 30 min", "45 min", "10 h". Whole minutes in, whole units out. */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

/** Hours with up to 2 decimals and no trailing zeros: 24, 24.25, 11.5. */
export function formatHours(hours: number): string {
  return String(Number(hours.toFixed(2)))
}

/** "Dallas, Texas, United States" -> "Dallas". */
export function placeCity(label: string): string {
  const first = label.split(',')[0]?.trim()
  return first || label.trim()
}

/** "Dallas to Denver via Memphis" */
export function routeTitle(request: Pick<PlanRequest, 'current' | 'pickup' | 'dropoff'>): string {
  const from = placeCity(request.current.label)
  const via = placeCity(request.pickup.label)
  const to = placeCity(request.dropoff.label)
  return `${from} to ${to} via ${via}`
}

export const STOP_KIND_LABEL: Record<StopKind, string> = {
  start: 'Start',
  pickup: 'Pickup',
  dropoff: 'Dropoff',
  fuel: 'Fuel',
  break: '30-minute break',
  rest: '10-hour rest',
  restart: '34-hour restart',
  end: 'Trip end',
}
