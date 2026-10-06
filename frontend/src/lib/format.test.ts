import { describe, expect, it } from 'vitest'
import { sampleRequest } from '@/test/makePlan'
import {
  formatDuration,
  formatHours,
  formatMiles,
  formatNumber,
  placeCity,
  routeTitle,
  STOP_KIND_LABEL,
} from './format'

describe('numbers', () => {
  it('groups thousands and rounds to whole numbers', () => {
    expect(formatNumber(1284.4)).toBe('1,284')
    expect(formatNumber(1284.5)).toBe('1,285')
    expect(formatNumber(0)).toBe('0')
  })

  it('adds the unit to miles', () => {
    expect(formatMiles(1492)).toBe('1,492 mi')
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [45, '45 min'],
    [60, '1 h'],
    [61, '1 h 1 min'],
    [270, '4 h 30 min'],
    [2040, '34 h'],
    [-5, '0 min'],
    [89.6, '1 h 30 min'],
  ])('writes %s minutes as "%s"', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected)
  })
})

describe('formatHours', () => {
  it.each([
    [24, '24'],
    [24.25, '24.25'],
    [11.5, '11.5'],
    [11.504, '11.5'],
    [0.1 + 0.2, '0.3'],
    [0, '0'],
    [70, '70'],
  ])('writes %s as "%s"', (hours, expected) => {
    expect(formatHours(hours)).toBe(expected)
  })
})

describe('place text', () => {
  it('takes the first part of a label', () => {
    expect(placeCity('Dallas, Texas, United States')).toBe('Dallas')
    expect(placeCity('  Memphis , TN')).toBe('Memphis')
  })

  it('keeps a label that has no comma', () => {
    expect(placeCity('Denver')).toBe('Denver')
  })

  it('falls back to the whole label when the first part is empty', () => {
    expect(placeCity(', Texas')).toBe(', Texas')
  })

  it('builds a route title through the pickup', () => {
    expect(routeTitle(sampleRequest)).toBe('Dallas to Denver via Memphis')
  })
})

describe('STOP_KIND_LABEL', () => {
  it('has a label for every kind of stop', () => {
    expect(Object.keys(STOP_KIND_LABEL).sort()).toEqual(
      ['break', 'dropoff', 'end', 'fuel', 'pickup', 'rest', 'restart', 'start'].sort(),
    )
  })
})
