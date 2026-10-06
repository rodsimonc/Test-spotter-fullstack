import { describe, expect, it } from 'vitest'
import { multiDayPlan, shortPlan } from '@/test/fixtures'
import {
  describeLog,
  formatLongDate,
  formatMonthDay,
  formatShortDate,
  parseLogDate,
  wholeMiles,
} from './describe'

describe('parseLogDate', () => {
  it('reads a YYYY-MM-DD date', () => {
    expect(parseLogDate('2026-10-07')).toEqual({ year: 2026, month: 10, day: 7 })
  })

  it.each(['', '2026-10-7', '10/07/2026', '2026-02-30', '2026-13-01', 'not a date'])(
    'returns null for %j',
    (text) => {
      expect(parseLogDate(text)).toBeNull()
    },
  )
})

describe('date text', () => {
  it('spells out the weekday, month and year', () => {
    expect(formatLongDate('2026-10-07')).toBe('Wednesday, October 7, 2026')
    expect(formatShortDate('2026-10-07')).toBe('Wed, Oct 7')
    expect(formatMonthDay('2026-10-07')).toBe('Oct 7')
  })

  it('passes an unreadable date through unchanged', () => {
    expect(formatLongDate('soon')).toBe('soon')
  })
})

describe('wholeMiles', () => {
  it('rounds to the nearest mile', () => {
    expect(wholeMiles(280.4)).toBe('280')
    expect(wholeMiles(689.5)).toBe('690')
    expect(wholeMiles(0)).toBe('0')
  })
})

describe('describeLog', () => {
  it('summarises the short fixture day in words', () => {
    const { title, desc } = describeLog(shortPlan.logs[0])
    expect(title).toBe("Driver's daily log for Wednesday, October 14, 2026, day 1")
    expect(desc).toBe(
      '17.32 hours off duty, 0 hours in the sleeper berth, 4.68 hours driving and 2 hours on duty, not driving. ' +
        '280 miles driven, from Dallas, TX to San Antonio, TX. 5 status changes recorded.',
    )
  })

  it('mentions a restart on the day it finishes', () => {
    expect(describeLog(multiDayPlan.logs[2]).desc).toContain('A 34-hour restart finished today.')
    expect(describeLog(multiDayPlan.logs[0]).desc).not.toContain('restart')
  })

  it('uses the singular for one hour and one change', () => {
    const log = {
      ...shortPlan.logs[0],
      totals: { off_duty: 1380, sleeper: 0, driving: 0, on_duty: 60 },
      remarks: shortPlan.logs[0].remarks.slice(0, 1),
    }
    const { desc } = describeLog(log)
    expect(desc).toContain('1 hour on duty')
    expect(desc).toContain('1 status change recorded.')
  })

  it('names a missing place instead of printing an empty gap', () => {
    const { desc } = describeLog({ ...shortPlan.logs[0], from_place: '', to_place: '' })
    expect(desc).toContain('from an unnamed place to an unnamed place')
  })
})
