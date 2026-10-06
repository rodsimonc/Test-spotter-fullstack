import type { DailyLog } from '@/api/types'
import { formatHours } from './geometry'

export interface DateParts {
  year: number
  month: number
  day: number
}

/** Reads the "YYYY-MM-DD" a log carries. Returns null for anything else. */
export function parseLogDate(date: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const probe = new Date(Date.UTC(year, month - 1, day))
  const valid =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  return valid ? { year, month, day } : null
}

function formatUtc(date: string, options: Intl.DateTimeFormatOptions): string {
  const parts = parseLogDate(date)
  if (!parts) return date
  const instant = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  return instant.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' })
}

/** "Wednesday, October 7, 2026" */
export const formatLongDate = (date: string) =>
  formatUtc(date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

/** "Wed, Oct 7" */
export const formatShortDate = (date: string) =>
  formatUtc(date, { weekday: 'short', month: 'short', day: 'numeric' })

/** "Oct 7" */
export const formatMonthDay = (date: string) => formatUtc(date, { month: 'short', day: 'numeric' })

const hoursText = (minutes: number) =>
  `${formatHours(minutes)} ${minutes === 60 ? 'hour' : 'hours'}`

/** Whole miles, as printed in the two mileage boxes. */
export const wholeMiles = (miles: number) => String(Math.round(miles))

/** The title and description screen readers get for one sheet. */
export function describeLog(log: DailyLog): { title: string; desc: string } {
  const { totals, remarks } = log
  const changes = remarks.length === 1 ? '1 status change' : `${remarks.length} status changes`
  const sentences = [
    `${hoursText(totals.off_duty)} off duty, ${hoursText(totals.sleeper)} in the sleeper berth, ` +
      `${hoursText(totals.driving)} driving and ${hoursText(totals.on_duty)} on duty, not driving.`,
    `${wholeMiles(log.total_miles_driving)} miles driven, from ${log.from_place || 'an unnamed place'} to ${log.to_place || 'an unnamed place'}.`,
    `${changes} recorded.`,
  ]
  if (log.recap.restart_completed) sentences.push('A 34-hour restart finished today.')
  return {
    title: `Driver's daily log for ${formatLongDate(log.date)}, day ${log.day}`,
    desc: sentences.join(' '),
  }
}
