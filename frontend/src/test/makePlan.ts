// Builds a small, internally consistent PlanResponse for tests and local screenshots.
// The trip is Dallas to Memphis to Denver over three log days, leaving at 06:00 CDT with
// 24 cycle hours used. It is not engine output, only a stand-in with the right shape.
import {
  EMPTY_HEADER,
  type DailyLog,
  type DutyStatus,
  type LogEntry,
  type PlanRequest,
  type PlanResponse,
  type Segment,
  type SegmentKind,
  type Stop,
  type Trip,
  type TripSummary,
  type User,
} from '@/api/types'

const OFFSET = '-05:00'
const BASE_UTC = Date.UTC(2026, 9, 7, 6, 0)
const DAY = 1440

export const DALLAS = { label: 'Dallas, Texas, United States', lat: 32.7767, lon: -96.797 }
export const MEMPHIS = { label: 'Memphis, Tennessee, United States', lat: 35.1495, lon: -90.049 }
export const DENVER = { label: 'Denver, Colorado, United States', lat: 39.7392, lon: -104.9903 }

export const sampleRequest: PlanRequest = {
  current: DALLAS,
  pickup: MEMPHIS,
  dropoff: DENVER,
  cycle_used_hours: 24,
  departure: '2026-10-07T06:00',
  timezone: 'America/Chicago',
}

/** Wall-clock ISO string `minutes` after departure, with the fixed trip offset. */
export function at(minutes: number): string {
  const d = new Date(BASE_UTC + minutes * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00${OFFSET}`
}

const LEG1_MILES = 452
const TOTAL_MILES = 1492

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Position on the straight-line stand-in route at a trip mile. */
function positionAt(mile: number): { lat: number; lon: number } {
  if (mile <= LEG1_MILES) {
    const t = mile / LEG1_MILES
    return { lat: lerp(DALLAS.lat, MEMPHIS.lat, t), lon: lerp(DALLAS.lon, MEMPHIS.lon, t) }
  }
  const t = (mile - LEG1_MILES) / (TOTAL_MILES - LEG1_MILES)
  return { lat: lerp(MEMPHIS.lat, DENVER.lat, t), lon: lerp(MEMPHIS.lon, DENVER.lon, t) }
}

interface Step {
  kind: Exclude<SegmentKind, 'idle'>
  status: DutyStatus
  minutes: number
  place: string
  note: string
}

// Driving covers one mile per minute (60 mph).
const STEPS: Step[] = [
  {
    kind: 'drive',
    status: 'driving',
    minutes: 452,
    place: 'Dallas, TX',
    note: 'Driving to pickup',
  },
  {
    kind: 'pickup',
    status: 'on_duty',
    minutes: 60,
    place: 'Memphis, TN',
    note: 'Pickup, loading (1 hr)',
  },
  {
    kind: 'drive',
    status: 'driving',
    minutes: 208,
    place: 'Memphis, TN',
    note: 'Driving to dropoff',
  },
  {
    kind: 'rest',
    status: 'sleeper',
    minutes: 600,
    place: '14 mi W of Little Rock, AR',
    note: '10-hour rest, sleeper berth',
  },
  {
    kind: 'drive',
    status: 'driving',
    minutes: 340,
    place: '14 mi W of Little Rock, AR',
    note: 'Driving to dropoff',
  },
  {
    kind: 'fuel',
    status: 'on_duty',
    minutes: 30,
    place: 'Oklahoma City, OK',
    note: 'Fuel stop (30 min)',
  },
  {
    kind: 'drive',
    status: 'driving',
    minutes: 320,
    place: 'Oklahoma City, OK',
    note: 'Driving to dropoff',
  },
  {
    kind: 'rest',
    status: 'sleeper',
    minutes: 600,
    place: '9 mi N of Wichita, KS',
    note: '10-hour rest, sleeper berth',
  },
  {
    kind: 'drive',
    status: 'driving',
    minutes: 172,
    place: '9 mi N of Wichita, KS',
    note: 'Driving to dropoff',
  },
  {
    kind: 'dropoff',
    status: 'on_duty',
    minutes: 60,
    place: 'Denver, CO',
    note: 'Dropoff, unloading (1 hr)',
  },
]

const STOP_TITLE: Record<string, string> = {
  pickup: 'Pickup',
  dropoff: 'Dropoff',
  fuel: 'Fuel stop',
  rest: '10-hour rest',
  break: '30-minute break',
  restart: '34-hour restart',
}

function buildTimeline() {
  const segments: Segment[] = []
  let minute = 0
  let mile = 0
  STEPS.forEach((step, index) => {
    const miles = step.kind === 'drive' ? step.minutes : 0
    segments.push({
      id: index + 1,
      status: step.status,
      kind: step.kind,
      start_at: at(minute),
      end_at: at(minute + step.minutes),
      minutes: step.minutes,
      start_mile: mile,
      end_mile: mile + miles,
      place: step.place,
      note: step.note,
    })
    minute += step.minutes
    mile += miles
  })
  return { segments, elapsed: minute }
}

function buildStops(segments: Segment[], elapsed: number): Stop[] {
  const stops: Stop[] = []
  const add = (stop: Omit<Stop, 'lat' | 'lon'>) => stops.push({ ...stop, ...positionAt(stop.mile) })
  const dayOf = (iso: string) =>
    Math.floor((Date.parse(iso.slice(0, 16) + 'Z') - Date.UTC(2026, 9, 7)) / (DAY * 60_000)) + 1

  add({
    id: 'stop-start',
    kind: 'start',
    title: 'Start',
    place: 'Dallas, TX',
    mile: 0,
    arrive_at: at(0),
    depart_at: at(0),
    duration_minutes: 0,
    day: 1,
    note: 'Departed, driving to pickup',
  })
  for (const seg of segments) {
    if (seg.kind === 'drive') continue
    add({
      id: `stop-${seg.id}`,
      kind: seg.kind,
      title: STOP_TITLE[seg.kind] ?? seg.kind,
      place: seg.place,
      mile: seg.start_mile,
      arrive_at: seg.start_at,
      depart_at: seg.end_at,
      duration_minutes: seg.minutes,
      day: dayOf(seg.start_at),
      note: seg.note,
    })
  }
  add({
    id: 'stop-end',
    kind: 'end',
    title: 'Trip complete',
    place: 'Denver, CO',
    mile: TOTAL_MILES,
    arrive_at: at(elapsed),
    depart_at: at(elapsed),
    duration_minutes: 0,
    day: dayOf(at(elapsed)),
    note: 'Off duty',
  })
  return stops
}

function buildLogs(segments: Segment[], elapsed: number): DailyLog[] {
  // Departure is 06:00, so minute 0 of the trip is minute 360 of the first log day.
  const lead = 360
  const days = Math.ceil((elapsed + lead) / DAY)
  const logs: DailyLog[] = []
  let cycleMinutes = sampleRequest.cycle_used_hours * 60

  for (let d = 0; d < days; d++) {
    const dayStart = d * DAY
    const entries: LogEntry[] = []
    const push = (
      status: DutyStatus,
      kind: SegmentKind,
      from: number,
      to: number,
      place: string,
      note: string,
    ) => {
      if (to > from)
        entries.push({
          status,
          kind,
          start_min: from - dayStart,
          end_min: to - dayStart,
          place,
          note,
        })
    }
    let cursor = dayStart
    for (const seg of segments) {
      const s = Date.parse(seg.start_at.slice(0, 16) + 'Z') / 60_000 - BASE_UTC / 60_000 + lead
      const from = Math.max(s, dayStart)
      const to = Math.min(s + seg.minutes, dayStart + DAY)
      if (to <= from) continue
      push('off_duty', 'idle', cursor, from, seg.place, 'Off duty')
      push(seg.status, seg.kind, from, to, seg.place, seg.note)
      cursor = to
    }
    push('off_duty', 'idle', cursor, dayStart + DAY, 'Denver, CO', 'Off duty')

    const totals = { off_duty: 0, sleeper: 0, driving: 0, on_duty: 0 }
    for (const entry of entries) totals[entry.status] += entry.end_min - entry.start_min
    const onDuty = totals.driving + totals.on_duty
    cycleMinutes += onDuty
    const miles = totals.driving

    logs.push({
      day: d + 1,
      date: `2026-10-${String(7 + d).padStart(2, '0')}`,
      from_place: d === 0 ? 'Dallas, TX' : entries[0].place,
      to_place: d === days - 1 ? 'Denver, CO' : entries[entries.length - 1].place,
      total_miles_driving: miles,
      total_mileage_today: miles,
      entries,
      totals,
      remarks: entries.map((e) => ({ minute: e.start_min, place: e.place, note: e.note })),
      recap: {
        on_duty_today_minutes: onDuty,
        a_minutes: cycleMinutes,
        b_minutes: Math.max(0, 70 * 60 - cycleMinutes),
        c_minutes: cycleMinutes,
        restart_completed: false,
      },
      header: { ...EMPTY_HEADER },
      vehicle: '',
    })
  }
  return logs
}
function buildGeometry(): [number, number][] {
  const points: [number, number][] = []
  for (let mile = 0; mile <= TOTAL_MILES; mile += 20) {
    const { lat, lon } = positionAt(mile)
    points.push([lat, lon])
  }
  // The pickup must be an exact vertex so the leg split lands on it.
  const pickup = positionAt(LEG1_MILES)
  const leg1End = points.findIndex(
    ([, lon]) => lon > pickup.lon - 0.001 && lon < pickup.lon + 0.001,
  )
  const index = leg1End >= 0 ? leg1End : Math.ceil(LEG1_MILES / 20)
  points.splice(index, 0, [pickup.lat, pickup.lon])
  points.push([DENVER.lat, DENVER.lon])
  return points
}

export function makePlan(overrides: Partial<PlanResponse> = {}): PlanResponse {
  const { segments, elapsed } = buildTimeline()
  const stops = buildStops(segments, elapsed)
  const logs = buildLogs(segments, elapsed)
  const geometry = buildGeometry()
  const pickupIndex = geometry.findIndex(
    ([lat, lon]) => Math.abs(lat - MEMPHIS.lat) < 1e-9 && Math.abs(lon - MEMPHIS.lon) < 1e-9,
  )
  const driving = segments.filter((s) => s.kind === 'drive').reduce((sum, s) => sum + s.minutes, 0)

  const plan: PlanResponse = {
    request: sampleRequest,
    summary: {
      distance_miles: TOTAL_MILES,
      driving_minutes: driving,
      on_duty_minutes: driving + 60 + 30 + 60,
      elapsed_minutes: elapsed,
      depart_at: at(0),
      arrive_at: at(elapsed),
      days: logs.length,
      fuel_stops: 1,
      breaks: 0,
      rests: 2,
      restarts: 0,
      cycle_used_start_hours: 24,
      cycle_used_end_hours: 24 + (driving + 150) / 60,
      legs: [
        {
          from: 'current',
          to: 'pickup',
          distance_miles: LEG1_MILES,
          duration_minutes: 452,
          osrm_duration_minutes: 398,
        },
        {
          from: 'pickup',
          to: 'dropoff',
          distance_miles: TOTAL_MILES - LEG1_MILES,
          duration_minutes: 1040,
          osrm_duration_minutes: 951,
        },
      ],
    },
    route: {
      geometry,
      bounds: [
        [
          Math.min(DALLAS.lat, MEMPHIS.lat, DENVER.lat),
          Math.min(DALLAS.lon, MEMPHIS.lon, DENVER.lon),
        ],
        [
          Math.max(DALLAS.lat, MEMPHIS.lat, DENVER.lat),
          Math.max(DALLAS.lon, MEMPHIS.lon, DENVER.lon),
        ],
      ],
      leg_end_indices: [pickupIndex, geometry.length - 1],
    },
    stops,
    segments,
    logs,
    assumptions: [
      'Property-carrying driver on the 70-hour/8-day schedule, no adverse driving conditions.',
      'Overnight rest is logged in the sleeper berth for 10 hours.',
      'Drive time is the slower of the OSRM estimate and distance divided by 60 mph.',
    ],
    warnings: [],
  }
  return { ...plan, ...overrides }
}

export function makeUser(overrides: Partial<User> = {}): User {
  return { id: 1, email: 'driver@example.com', name: 'Dana Driver', ...overrides }
}

export function makeTripSummary(overrides: Partial<TripSummary> = {}): TripSummary {
  return {
    id: '3f0c7e0e-6a43-4a0a-9a52-0d2f4a0a1111',
    title: 'Dallas to Denver',
    created_at: '2026-10-06T12:00:00Z',
    current_label: DALLAS.label,
    pickup_label: MEMPHIS.label,
    dropoff_label: DENVER.label,
    distance_miles: TOTAL_MILES,
    days: 3,
    depart_at: at(0),
    arrive_at: at(2842),
    ...overrides,
  }
}

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    ...makeTripSummary(),
    request: sampleRequest,
    result: makePlan(),
    ...overrides,
  }
}
