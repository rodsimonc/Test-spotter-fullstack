import { describe, expect, it } from 'vitest'
import type { DailyLog, DutyStatus } from '@/api/types'
import { multiDayPlan, shortPlan } from '@/test/fixtures'

const STATUSES: DutyStatus[] = ['off_duty', 'sleeper', 'driving', 'on_duty']

function minutesBy(log: DailyLog): Record<DutyStatus, number> {
  const sums = { off_duty: 0, sleeper: 0, driving: 0, on_duty: 0 }
  for (const entry of log.entries) sums[entry.status] += entry.end_min - entry.start_min
  return sums
}

describe.each([
  ['short', shortPlan],
  ['multi-day', multiDayPlan],
])('%s fixture', (_name, plan) => {
  it('numbers its days from 1 and counts them in the summary', () => {
    expect(plan.logs.map((log) => log.day)).toEqual(plan.logs.map((_, i) => i + 1))
    expect(plan.summary.days).toBe(plan.logs.length)
  })

  it('covers each day from minute 0 to 1440 with no gaps or overlaps', () => {
    for (const log of plan.logs) {
      expect(log.entries[0].start_min).toBe(0)
      expect(log.entries[log.entries.length - 1].end_min).toBe(1440)
      log.entries.forEach((entry, i) => {
        expect(entry.end_min).toBeGreaterThan(entry.start_min)
        if (i > 0) expect(entry.start_min).toBe(log.entries[i - 1].end_min)
      })
    }
  })

  it('carries totals that match the entries and add up to 24 hours', () => {
    for (const log of plan.logs) {
      expect(log.totals).toEqual(minutesBy(log))
      expect(STATUSES.reduce((sum, status) => sum + log.totals[status], 0)).toBe(1440)
    }
  })

  it('records a remark at every change of status', () => {
    for (const log of plan.logs) {
      const changes = log.entries
        .slice(1)
        .filter((entry, i) => entry.status !== log.entries[i].status)
      expect(log.remarks.map((remark) => remark.minute)).toEqual(
        changes.map((entry) => entry.start_min),
      )
    }
  })

  it('keeps the recap in step with the totals', () => {
    for (const log of plan.logs) {
      expect(log.recap.on_duty_today_minutes).toBe(log.totals.driving + log.totals.on_duty)
      expect(log.recap.b_minutes).toBe(Math.max(0, 70 * 60 - log.recap.a_minutes))
    }
  })

  it('picks up each day in the status the previous day ended in', () => {
    plan.logs.slice(1).forEach((log, i) => {
      const previous = plan.logs[i]
      expect(log.entries[0].status).toBe(previous.entries[previous.entries.length - 1].status)
    })
  })

  it('splits driving miles across the days', () => {
    const miles = plan.logs.reduce((sum, log) => sum + log.total_miles_driving, 0)
    expect(miles).toBeCloseTo(plan.summary.distance_miles, 0)
  })
})

describe('multi-day fixture', () => {
  it('has a fuel stop, a break, a rest and a restart', () => {
    const kinds = new Set(multiDayPlan.segments.map((segment) => segment.kind))
    for (const kind of ['fuel', 'break', 'rest', 'restart'] as const) expect(kinds).toContain(kind)
  })

  it('marks the day the restart finished', () => {
    expect(multiDayPlan.logs.map((log) => log.recap.restart_completed)).toEqual([
      false,
      false,
      true,
    ])
  })
})
