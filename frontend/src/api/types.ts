// Shapes sent to and returned by the Django API.
// The source of truth is docs/api-contract.md. Change both together.

export type DutyStatus = 'off_duty' | 'sleeper' | 'driving' | 'on_duty'

/** Kinds of stop shown on the map and in the itinerary. */
export type StopKind =
  'start' | 'pickup' | 'dropoff' | 'fuel' | 'break' | 'rest' | 'restart' | 'end'

/** What a timeline segment is doing. `idle` only appears in daily log entries. */
export type SegmentKind =
  'drive' | 'pickup' | 'dropoff' | 'fuel' | 'break' | 'rest' | 'restart' | 'idle'

export interface Place {
  /** Display text, for example "Chicago, Illinois, United States". */
  label: string
  lat: number
  lon: number
}

/** Free-text fields printed on the daily log header. Every field may be an empty string. */
export interface LogHeader {
  driver_name: string
  co_driver_name: string
  carrier_name: string
  main_office_address: string
  home_terminal_address: string
  truck_number: string
  trailer_number: string
  shipper: string
  commodity: string
  shipping_doc_no: string
}

export interface PlanRequest {
  current: Place
  pickup: Place
  dropoff: Place
  /** Hours already used in the 70-hour/8-day cycle. 0 to 70, quarter-hour precision is enough. */
  cycle_used_hours: number
  /** Local wall-clock time at the home terminal, "YYYY-MM-DDTHH:mm". No offset. */
  departure: string
  /** IANA zone of the home terminal, for example "America/Chicago". */
  timezone: string
  header?: Partial<LogHeader>
}

export interface LegSummary {
  from: 'current' | 'pickup'
  to: 'pickup' | 'dropoff'
  distance_miles: number
  /** Drive time used by the planner: the slower of OSRM and distance / 60 mph. */
  duration_minutes: number
  osrm_duration_minutes: number
}

export interface PlanSummary {
  distance_miles: number
  driving_minutes: number
  /** Driving plus on-duty not driving, trip only. */
  on_duty_minutes: number
  /** Departure to the end of the dropoff hour. */
  elapsed_minutes: number
  depart_at: string
  arrive_at: string
  /** Number of daily log sheets. */
  days: number
  fuel_stops: number
  breaks: number
  rests: number
  restarts: number
  cycle_used_start_hours: number
  /** Hours counted in the cycle at the end of the trip, since the last restart. */
  cycle_used_end_hours: number
  legs: LegSummary[]
}

export interface RouteGeometry {
  /** Simplified polyline, [lat, lon] pairs, ready for Leaflet. */
  geometry: [number, number][]
  /** [[south, west], [north, east]] */
  bounds: [[number, number], [number, number]]
  /** Index into `geometry` where each leg ends. Always two values. */
  leg_end_indices: [number, number]
}

export interface Stop {
  id: string
  kind: StopKind
  title: string
  /** Short place text such as "Kearney, NE" or "12 mi SW of Kearney, NE". */
  place: string
  lat: number
  lon: number
  /** Miles from the start of the trip. */
  mile: number
  arrive_at: string
  depart_at: string
  duration_minutes: number
  /** 1-based log day on which the stop begins. */
  day: number
  note: string
}

export interface Segment {
  id: number
  status: DutyStatus
  kind: Exclude<SegmentKind, 'idle'>
  start_at: string
  end_at: string
  minutes: number
  start_mile: number
  end_mile: number
  place: string
  note: string
}

export interface LogEntry {
  status: DutyStatus
  kind: SegmentKind
  /** Minutes after midnight at the home terminal, 0 to 1440. */
  start_min: number
  end_min: number
  place: string
  note: string
}

export interface Remark {
  /** Minute of the day at which the duty status changed. */
  minute: number
  place: string
  note: string
}

export interface LogTotals {
  off_duty: number
  sleeper: number
  driving: number
  on_duty: number
}

export interface LogRecap {
  /** Lines 3 and 4 for the day, in minutes. */
  on_duty_today_minutes: number
  /** 70-hour/8-day drivers. A: last 8 days including today. */
  a_minutes: number
  /** B: 70 hours minus A, never below 0. */
  b_minutes: number
  /** C: last 7 days including today. */
  c_minutes: number
  /** True when a 34-hour restart finished on this day, so counting began again at zero. */
  restart_completed: boolean
}

export interface DailyLog {
  /** 1-based day number within the trip. */
  day: number
  /** YYYY-MM-DD at the home terminal. */
  date: string
  from_place: string
  to_place: string
  total_miles_driving: number
  total_mileage_today: number
  /** Entries cover 0 to 1440 with no gaps, in order. */
  entries: LogEntry[]
  /** Minutes per status. The four values add up to 1440. */
  totals: LogTotals
  remarks: Remark[]
  recap: LogRecap
  header: LogHeader
  /** "Truck 101 / Trailer 202", or an empty string. */
  vehicle: string
}

export interface PlanResponse {
  request: PlanRequest
  summary: PlanSummary
  route: RouteGeometry
  stops: Stop[]
  segments: Segment[]
  logs: DailyLog[]
  assumptions: string[]
  warnings: string[]
}

export interface GeocodeResult extends Place {
  /** Short secondary line for the suggestion list, for example "Illinois, United States". */
  detail: string
}

export interface User {
  id: number
  email: string
  name: string
}

export interface TripSummary {
  id: string
  title: string
  created_at: string
  current_label: string
  pickup_label: string
  dropoff_label: string
  distance_miles: number
  days: number
  depart_at: string
  arrive_at: string
}

export interface Trip extends TripSummary {
  request: PlanRequest
  result: PlanResponse
}

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    /** Field name to list of messages, present on validation errors. */
    fields?: Record<string, string[]>
  }
}

export const DUTY_STATUS_LABEL: Record<DutyStatus, string> = {
  off_duty: 'Off Duty',
  sleeper: 'Sleeper Berth',
  driving: 'Driving',
  on_duty: 'On Duty (not driving)',
}

export const EMPTY_HEADER: LogHeader = {
  driver_name: '',
  co_driver_name: '',
  carrier_name: '',
  main_office_address: '',
  home_terminal_address: '',
  truck_number: '',
  trailer_number: '',
  shipper: '',
  commodity: '',
  shipping_doc_no: '',
}
