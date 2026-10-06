// The API sends timestamps like "2026-10-07T06:00:00-05:00" that are already in the home
// terminal zone. We read the wall-clock digits straight from the string so the browser's own
// zone never shifts what the driver would see on the log.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export interface WallTime {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/

export function parseWall(iso: string): WallTime | null {
  const m = WALL.exec(iso)
  if (!m) return null
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
  }
}

function weekdayIndex(w: WallTime): number {
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** "6:00 AM" */
export function formatClock(iso: string): string {
  const w = parseWall(iso)
  if (!w) return iso
  const suffix = w.hour >= 12 ? 'PM' : 'AM'
  const hour12 = w.hour % 12 === 0 ? 12 : w.hour % 12
  return `${hour12}:${pad(w.minute)} ${suffix}`
}

/** "Wed, Oct 7" */
export function formatDayShort(iso: string): string {
  const w = parseWall(iso)
  if (!w) return iso
  return `${WEEKDAYS[weekdayIndex(w)]}, ${MONTHS[w.month - 1]} ${w.day}`
}

/** "Wednesday, October 7" from a timestamp or a YYYY-MM-DD date. */
export function formatDayLong(isoOrDate: string): string {
  const w = parseWall(isoOrDate)
  if (!w) return isoOrDate
  return `${WEEKDAYS_LONG[weekdayIndex(w)]}, ${MONTHS_LONG[w.month - 1]} ${w.day}`
}

/** "Wed, Oct 7, 6:00 AM" */
export function formatDateTime(iso: string): string {
  return `${formatDayShort(iso)}, ${formatClock(iso)}`
}

/** "2026-10-07" */
export function dateKey(iso: string): string {
  const w = parseWall(iso)
  return w ? `${w.year}-${pad(w.month)}-${pad(w.day)}` : iso
}

/** "6:00 AM to 7:00 AM", or with a date on the end when it lands on another day. */
export function formatRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return formatClock(startIso)
  const end = dateKey(startIso) === dateKey(endIso) ? formatClock(endIso) : formatDateTime(endIso)
  return `${formatClock(startIso)} to ${end}`
}

/** Value for an `<input type="datetime-local">`, in the zone of the given Date. */
export function toDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The next quarter hour after `now` (never `now` itself), in the browser zone. */
export function nextQuarterHour(now: Date = new Date()): string {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15 + 15)
  return toDatetimeLocal(d)
}

/** The next 06:00 after `now`: today if it hasn't passed yet, otherwise tomorrow. */
export function nextSixAm(now: Date = new Date()): string {
  const d = new Date(now)
  d.setHours(6, 0, 0, 0)
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return toDatetimeLocal(d)
}

export function isValidDatetimeLocal(value: string): boolean {
  const w = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!w) return false
  const [year, month, day, hour, minute] = w.slice(1).map(Number)
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || year < 2000 || year > 2100) {
    return false
  }
  const probe = new Date(Date.UTC(year, month - 1, day))
  return probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
}

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && isValidTimeZone(zone) ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Short zone name such as "CDT", taken at the given instant. Falls back to the IANA name. */
export function zoneAbbreviation(zone: string, iso?: string): string {
  try {
    const instant = iso ? new Date(iso) : new Date()
    const at = Number.isNaN(instant.getTime()) ? new Date() : instant
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(at)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? zone
  } catch {
    return zone
  }
}

/** "just now", "5 minutes ago", "2 days ago", falling back to a date after a month. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(seconds)
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  if (abs < 45) return 'just now'
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day')
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
