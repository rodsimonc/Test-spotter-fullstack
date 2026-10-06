import type { DailyLog, DutyStatus, PlanResponse, Segment } from '../../src/api/types'

// An independent referee for plans coming out of the API. It reads only the response and the
// FMCSA numbers below. It shares nothing with the Python engine, so a bug there cannot hide
// behind a matching bug here.

const LIMITS = {
  drivingMinutes: 11 * 60,
  windowMinutes: 14 * 60,
  driveBeforeBreakMinutes: 8 * 60,
  breakMinutes: 30,
  restMinutes: 10 * 60,
  restartMinutes: 34 * 60,
  cycleMinutes: 70 * 60,
  fuelMiles: 1000,
  fuelStopMinutes: 30,
  pickupDropoffMinutes: 60,
  dayMinutes: 1440,
  /** 60 mph is one mile per minute. */
  planningMilesPerMinute: 1,
} as const

const MS_PER_MINUTE = 60_000
const MILE_TOLERANCE = 0.2
const time = (iso: string) => Date.parse(iso)

type Report = (message: string) => void

const minutesBy = (segments: Segment[], status: DutyStatus) =>
  segments.filter((s) => s.status === status).reduce((sum, s) => sum + s.minutes, 0)

/** Returns a list of problems. An empty list means the plan follows the rules. */
export function checkPlan(plan: PlanResponse): string[] {
  const problems: string[] = []
  const bad: Report = (message) => problems.push(message)
  if (!plan.segments.length) return ['the plan has no segments']

  checkSegmentsAreContiguous(plan.segments, bad)
  checkDrivingRules(plan, bad)
  checkFixedStops(plan, bad)
  checkSummary(plan, bad)
  plan.logs.forEach((log, index) => checkLog(log, index, plan, bad))
  checkLogsAgainstSegments(plan, bad)
  return problems
}

function checkSegmentsAreContiguous(segments: Segment[], bad: Report) {
  segments.forEach((segment, i) => {
    const id = `segment ${segment.id} (${segment.kind})`
    const span = (time(segment.end_at) - time(segment.start_at)) / MS_PER_MINUTE
    if (span !== segment.minutes) bad(`${id}: says ${segment.minutes} min, times span ${span}`)
    if (segment.minutes <= 0) bad(`${id}: is not longer than zero minutes`)
    const moved = segment.end_mile - segment.start_mile
    if (segment.status !== 'driving' && Math.abs(moved) > MILE_TOLERANCE)
      bad(`${id}: moves the truck`)
    if (moved < -MILE_TOLERANCE) bad(`${id}: miles go backwards`)

    const previous = segments[i - 1]
    if (!previous) return
    if (time(segment.start_at) !== time(previous.end_at)) bad(`${id}: gap or overlap before it`)
    if (Math.abs(segment.start_mile - previous.end_mile) > MILE_TOLERANCE) {
      bad(`${id}: mile marker jumps before it`)
    }
  })
}

function checkDrivingRules(plan: PlanResponse, bad: Report) {
  const { segments, request } = plan
  let drivenSinceRest = 0
  let drivenSinceBreak = 0
  let nonDrivingRun = 0
  let restRun = 0
  let windowStart = time(segments[0].start_at)
  let cycle = Math.round(request.cycle_used_hours * 60)
  let milesSinceFuel = 0

  for (const segment of segments) {
    const resting = segment.status === 'off_duty' || segment.status === 'sleeper'
    if (resting) {
      restRun += segment.minutes
    } else {
      // A long enough rest ends when the next piece of work starts. That restarts both clocks.
      if (restRun >= LIMITS.restMinutes) {
        drivenSinceRest = 0
        windowStart = time(segment.start_at)
      }
      restRun = 0
    }

    if (segment.status === 'driving') {
      drivenSinceRest += segment.minutes
      drivenSinceBreak += segment.minutes
      cycle += segment.minutes
      milesSinceFuel += segment.end_mile - segment.start_mile
      nonDrivingRun = 0

      const at = `driving at ${segment.start_at}`
      const windowUsed = time(segment.end_at) - windowStart
      if (drivenSinceRest > LIMITS.drivingMinutes) bad(`${at}: over 11 hours of driving`)
      if (drivenSinceBreak > LIMITS.driveBeforeBreakMinutes) bad(`${at}: 8 hours without a break`)
      if (windowUsed > LIMITS.windowMinutes * MS_PER_MINUTE) bad(`${at}: past the 14-hour window`)
      if (cycle > LIMITS.cycleMinutes) bad(`${at}: past 70 hours in the cycle`)
      if (milesSinceFuel > LIMITS.fuelMiles + MILE_TOLERANCE)
        bad(`${at}: over 1,000 miles since fuel`)
      continue
    }

    nonDrivingRun += segment.minutes
    if (nonDrivingRun >= LIMITS.breakMinutes) drivenSinceBreak = 0
    if (segment.status === 'on_duty') cycle += segment.minutes
    if (segment.kind === 'fuel') milesSinceFuel = 0
    if (segment.kind === 'restart' && segment.minutes >= LIMITS.restartMinutes) cycle = 0
  }
}

function checkFixedStops(plan: PlanResponse, bad: Report) {
  const { segments, summary } = plan
  const ofKind = (kind: Segment['kind']) => segments.filter((s) => s.kind === kind)

  for (const kind of ['pickup', 'dropoff'] as const) {
    const found = ofKind(kind)
    if (found.length !== 1) bad(`expected one ${kind}, found ${found.length}`)
    for (const s of found) {
      if (s.minutes !== LIMITS.pickupDropoffMinutes) bad(`${kind} lasts ${s.minutes} min, not 60`)
      if (s.status !== 'on_duty') bad(`${kind} is logged ${s.status}, not on_duty`)
    }
  }

  const [pickup] = ofKind('pickup')
  const [dropoff] = ofKind('dropoff')
  const [firstLeg] = summary.legs
  if (
    pickup &&
    firstLeg &&
    Math.abs(pickup.start_mile - firstLeg.distance_miles) > MILE_TOLERANCE
  ) {
    bad(`pickup is at mile ${pickup.start_mile}, leg 1 is ${firstLeg.distance_miles} miles`)
  }
  if (dropoff && Math.abs(dropoff.start_mile - summary.distance_miles) > MILE_TOLERANCE) {
    bad(`dropoff is at mile ${dropoff.start_mile}, the trip is ${summary.distance_miles} miles`)
  }

  const fuel = ofKind('fuel')
  for (const s of fuel) {
    if (s.minutes !== LIMITS.fuelStopMinutes || s.status !== 'on_duty') {
      bad(`fuel stop ${s.id} is not 30 minutes on duty`)
    }
  }
  const neededFuelStops = Math.max(0, Math.ceil(summary.distance_miles / LIMITS.fuelMiles) - 1)
  if (fuel.length < neededFuelStops) {
    bad(`${summary.distance_miles} miles needs ${neededFuelStops} fuel stops, found ${fuel.length}`)
  }
  for (const s of ofKind('rest')) {
    if (s.status !== 'sleeper' || s.minutes < LIMITS.restMinutes)
      bad(`rest ${s.id} is not 10 hours in the sleeper berth`)
  }
  for (const s of ofKind('restart')) {
    if (s.status !== 'off_duty' || s.minutes < LIMITS.restartMinutes)
      bad(`restart ${s.id} is not 34 hours off duty`)
  }
  for (const s of ofKind('break')) {
    if (s.status !== 'off_duty' || s.minutes < LIMITS.breakMinutes)
      bad(`break ${s.id} is not 30 minutes off duty`)
  }
}

function checkSummary(plan: PlanResponse, bad: Report) {
  const { segments, summary } = plan
  const first = segments[0]
  const last = segments[segments.length - 1]
  const count = (kind: Segment['kind']) => segments.filter((s) => s.kind === kind).length
  const same = (label: string, actual: number, expected: number) => {
    if (actual !== expected) bad(`summary ${label} is ${actual}, the segments say ${expected}`)
  }
  const driving = minutesBy(segments, 'driving')

  same('driving_minutes', summary.driving_minutes, driving)
  same('on_duty_minutes', summary.on_duty_minutes, driving + minutesBy(segments, 'on_duty'))
  same(
    'elapsed_minutes',
    summary.elapsed_minutes,
    (time(last.end_at) - time(first.start_at)) / MS_PER_MINUTE,
  )
  same('fuel_stops', summary.fuel_stops, count('fuel'))
  same('breaks', summary.breaks, count('break'))
  same('rests', summary.rests, count('rest'))
  same('restarts', summary.restarts, count('restart'))
  if (time(summary.depart_at) !== time(first.start_at))
    bad('summary depart_at is not the first start')
  if (time(summary.arrive_at) !== time(last.end_at)) bad('summary arrive_at is not the last end')
  if (Math.abs(summary.distance_miles - last.end_mile) > MILE_TOLERANCE) {
    bad('summary distance is not the last mile marker')
  }

  if (summary.legs.length !== 2) bad(`expected 2 legs, found ${summary.legs.length}`)
  for (const leg of summary.legs) {
    const slowest = Math.max(
      leg.osrm_duration_minutes,
      leg.distance_miles / LIMITS.planningMilesPerMinute,
    )
    if (Math.abs(leg.duration_minutes - slowest) > 1) {
      bad(
        `leg to ${leg.to}: ${leg.duration_minutes} min, the slower of OSRM and 60 mph is ${slowest.toFixed(1)}`,
      )
    }
  }
  const legMinutes = summary.legs.reduce((sum, leg) => sum + leg.duration_minutes, 0)
  if (Math.abs(legMinutes - summary.driving_minutes) > summary.legs.length) {
    bad(`legs add up to ${legMinutes} min of driving, the summary says ${summary.driving_minutes}`)
  }
}

function departureMinute(departure: string): number {
  const [, hours, minutes] = /T(\d{2}):(\d{2})/.exec(departure) ?? []
  return Number(hours) * 60 + Number(minutes)
}

function checkLog(log: DailyLog, index: number, plan: PlanResponse, bad: Report) {
  const where = `day ${log.day}`
  if (log.day !== index + 1) bad(`${where}: sheet is out of order`)
  if (index > 0) {
    const gapDays = (Date.parse(log.date) - Date.parse(plan.logs[index - 1].date)) / 86_400_000
    if (gapDays !== 1) bad(`${where}: ${log.date} does not follow the previous sheet`)
  }

  let cursor = 0
  const byStatus: Record<DutyStatus, number> = { off_duty: 0, sleeper: 0, driving: 0, on_duty: 0 }
  for (const entry of log.entries) {
    if (entry.start_min !== cursor)
      bad(`${where}: entries leave a gap or overlap at minute ${cursor}`)
    if (entry.end_min <= entry.start_min) bad(`${where}: an entry has no length`)
    byStatus[entry.status] += entry.end_min - entry.start_min
    cursor = entry.end_min
  }
  if (cursor !== LIMITS.dayMinutes) bad(`${where}: entries end at minute ${cursor}, not 1440`)

  const { totals, recap } = log
  if (totals.off_duty + totals.sleeper + totals.driving + totals.on_duty !== LIMITS.dayMinutes) {
    bad(`${where}: totals do not add up to 24 hours`)
  }
  for (const status of Object.keys(byStatus) as DutyStatus[]) {
    if (totals[status] !== byStatus[status])
      bad(`${where}: ${status} total differs from its entries`)
  }

  if (index === 0) {
    const departs = departureMinute(plan.request.departure)
    const [first] = log.entries
    if (departs > 0 && !(first.status === 'off_duty' && first.end_min === departs)) {
      bad(`${where}: should be off duty until the departure at minute ${departs}`)
    }
  }
  if (index === plan.logs.length - 1) {
    const last = log.entries[log.entries.length - 1]
    const endsAtDropoff = last.kind === 'dropoff'
    if (last.end_min !== LIMITS.dayMinutes || (last.status !== 'off_duty' && !endsAtDropoff)) {
      bad(`${where}: should end off duty at midnight`)
    }
  }

  if (recap.on_duty_today_minutes !== totals.driving + totals.on_duty)
    bad(`${where}: recap on-duty hours are wrong`)
  if (recap.b_minutes !== Math.max(0, LIMITS.cycleMinutes - recap.a_minutes))
    bad(`${where}: B is not 70 minus A`)
  if (recap.a_minutes < recap.on_duty_today_minutes)
    bad(`${where}: A is less than today's own hours`)
  if (recap.c_minutes < recap.on_duty_today_minutes || recap.c_minutes > recap.a_minutes) {
    bad(`${where}: C is out of range`)
  }
  if (log.remarks.some((r) => r.minute < 0 || r.minute > LIMITS.dayMinutes)) {
    bad(`${where}: a remark sits outside the day`)
  }
}

/** The sheets and the segments describe the same trip, so their totals must agree. */
function checkLogsAgainstSegments(plan: PlanResponse, bad: Report) {
  const { logs, segments, summary } = plan
  for (const status of ['driving', 'on_duty', 'sleeper'] as const) {
    const onSheets = logs.reduce((sum, log) => sum + log.totals[status], 0)
    const inSegments = minutesBy(segments, status)
    if (onSheets !== inSegments)
      bad(`sheets show ${onSheets} min ${status}, segments show ${inSegments}`)
  }
  const sheetMiles = logs.reduce((sum, log) => sum + log.total_miles_driving, 0)
  if (Math.abs(sheetMiles - summary.distance_miles) > logs.length) {
    bad(`sheets add up to ${sheetMiles} miles driven, the trip is ${summary.distance_miles}`)
  }
  if (summary.days !== logs.length) bad(`summary says ${summary.days} days, ${logs.length} sheets`)
}
