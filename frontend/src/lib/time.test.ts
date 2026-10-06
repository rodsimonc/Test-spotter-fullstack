import { describe, expect, it } from 'vitest'
import {
  browserTimeZone,
  dateKey,
  formatClock,
  formatDateTime,
  formatDayLong,
  formatDayShort,
  formatRange,
  formatRelative,
  isValidDatetimeLocal,
  isValidTimeZone,
  nextQuarterHour,
  nextSixAm,
  parseWall,
  toDatetimeLocal,
  zoneAbbreviation,
} from './time'

describe('reading wall-clock text', () => {
  it('takes the digits as written and ignores the offset', () => {
    expect(parseWall('2026-10-07T06:05:00-05:00')).toEqual({
      year: 2026,
      month: 10,
      day: 7,
      hour: 6,
      minute: 5,
    })
  })

  it('treats a bare date as midnight', () => {
    expect(parseWall('2026-10-07')).toEqual({ year: 2026, month: 10, day: 7, hour: 0, minute: 0 })
  })

  it('returns null for text that is not a date', () => {
    expect(parseWall('soon')).toBeNull()
  })
})

describe('formatting', () => {
  it.each([
    ['2026-10-07T00:00:00-05:00', '12:00 AM'],
    ['2026-10-07T00:30:00-05:00', '12:30 AM'],
    ['2026-10-07T06:00:00-05:00', '6:00 AM'],
    ['2026-10-07T12:00:00-05:00', '12:00 PM'],
    ['2026-10-07T13:05:00-05:00', '1:05 PM'],
    ['2026-10-07T23:59:00-05:00', '11:59 PM'],
  ])('formats %s as a clock time', (iso, expected) => {
    expect(formatClock(iso)).toBe(expected)
  })

  it('does not shift the clock by the viewer time zone', () => {
    // The text says 06:00 at the home terminal. It must read 6:00 AM everywhere.
    expect(formatClock('2026-10-07T06:00:00+09:00')).toBe('6:00 AM')
  })

  it('returns unparseable text unchanged', () => {
    expect(formatClock('later')).toBe('later')
    expect(formatDayShort('later')).toBe('later')
    expect(formatDayLong('later')).toBe('later')
  })

  it('names the day', () => {
    expect(formatDayShort('2026-10-07T06:00:00-05:00')).toBe('Wed, Oct 7')
    expect(formatDayLong('2026-10-07')).toBe('Wednesday, October 7')
    expect(formatDateTime('2026-10-08T00:15:00-05:00')).toBe('Thu, Oct 8, 12:15 AM')
  })

  it('builds a date key', () => {
    expect(dateKey('2026-01-02T03:04:00-06:00')).toBe('2026-01-02')
    expect(dateKey('nope')).toBe('nope')
  })

  it('shows a same-day range with times only', () => {
    expect(formatRange('2026-10-07T06:00:00-05:00', '2026-10-07T07:00:00-05:00')).toBe(
      '6:00 AM to 7:00 AM',
    )
  })

  it('adds the date when the range crosses midnight', () => {
    expect(formatRange('2026-10-07T22:00:00-05:00', '2026-10-08T08:00:00-05:00')).toBe(
      '10:00 PM to Thu, Oct 8, 8:00 AM',
    )
  })

  it('shows one time when start and end are the same', () => {
    const iso = '2026-10-07T06:00:00-05:00'
    expect(formatRange(iso, iso)).toBe('6:00 AM')
  })
})

describe('default departure times', () => {
  it('rounds up to the next quarter hour', () => {
    expect(nextQuarterHour(new Date(2026, 9, 7, 10, 7, 30))).toBe('2026-10-07T10:15')
    expect(nextQuarterHour(new Date(2026, 9, 7, 10, 50))).toBe('2026-10-07T11:00')
  })

  it('never returns the current moment, even on a quarter hour', () => {
    expect(nextQuarterHour(new Date(2026, 9, 7, 10, 15, 0))).toBe('2026-10-07T10:30')
  })

  it('rolls over midnight', () => {
    expect(nextQuarterHour(new Date(2026, 9, 7, 23, 50))).toBe('2026-10-08T00:00')
  })

  it('picks 06:00 today when it has not passed', () => {
    expect(nextSixAm(new Date(2026, 9, 7, 5, 59))).toBe('2026-10-07T06:00')
  })

  it('picks 06:00 tomorrow once it has passed, or is exactly now', () => {
    expect(nextSixAm(new Date(2026, 9, 7, 6, 0))).toBe('2026-10-08T06:00')
    expect(nextSixAm(new Date(2026, 9, 7, 14, 30))).toBe('2026-10-08T06:00')
  })

  it('writes a datetime-local value in local time', () => {
    expect(toDatetimeLocal(new Date(2026, 0, 2, 3, 4))).toBe('2026-01-02T03:04')
  })
})

describe('validity checks', () => {
  it.each(['2026-10-07T06:00', '2000-01-01T00:00', '2100-12-31T23:59', '2028-02-29T12:00'])(
    'accepts %s',
    (value) => expect(isValidDatetimeLocal(value)).toBe(true),
  )

  it.each([
    '',
    '2026-10-07',
    '2026-10-07T06:00:00',
    '2026-13-01T06:00',
    '2026-00-10T06:00',
    '2026-02-30T06:00',
    '2027-02-29T06:00',
    '2026-10-07T24:00',
    '2026-10-07T06:60',
    '1999-12-31T23:59',
    '2101-01-01T00:00',
    'not a date',
  ])('rejects "%s"', (value) => expect(isValidDatetimeLocal(value)).toBe(false))

  it('knows real and fake IANA zones', () => {
    expect(isValidTimeZone('America/Chicago')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(isValidTimeZone('Pacific/Honolulu')).toBe(true)
    expect(isValidTimeZone('Mars/Base')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('reports a valid browser zone', () => {
    expect(isValidTimeZone(browserTimeZone())).toBe(true)
  })
})

describe('zoneAbbreviation', () => {
  it('follows daylight time at the given instant', () => {
    expect(zoneAbbreviation('America/Chicago', '2026-10-07T06:00:00-05:00')).toBe('CDT')
    expect(zoneAbbreviation('America/Chicago', '2026-01-15T06:00:00-06:00')).toBe('CST')
  })

  it('falls back to the zone name for a zone it cannot format', () => {
    expect(zoneAbbreviation('Mars/Base', '2026-10-07T06:00:00-05:00')).toBe('Mars/Base')
  })

  it('still answers when the timestamp is unreadable', () => {
    expect(zoneAbbreviation('UTC', 'garbage')).toBe('UTC')
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-10-06T12:00:00Z')

  it('says just now for the last few seconds', () => {
    expect(formatRelative('2026-10-06T11:59:40Z', now)).toBe('just now')
  })

  it('counts minutes, hours and days', () => {
    expect(formatRelative('2026-10-06T11:55:00Z', now)).toBe('5 minutes ago')
    expect(formatRelative('2026-10-06T09:00:00Z', now)).toBe('3 hours ago')
    expect(formatRelative('2026-10-03T12:00:00Z', now)).toBe('3 days ago')
  })

  it('switches to a date after a month', () => {
    expect(formatRelative('2026-08-01T12:00:00Z', now)).toMatch(/^Aug \d, 2026$/)
  })

  it('returns an empty string for a bad timestamp', () => {
    expect(formatRelative('whenever', now)).toBe('')
  })
})
