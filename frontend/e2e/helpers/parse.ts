import { expect } from '@playwright/test'

// The UI formats numbers and durations its own way. These helpers read them back without
// caring whether it printed "1,557 mi" or "1557.2 miles", or "26 h 5 min" or "26h 05m".

/** Every number in the text, thousands separators removed. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replaceAll(',', '')))
}

export function firstNumber(text: string): number {
  const [first] = numbersIn(text)
  if (first === undefined) throw new Error(`No number found in "${text}"`)
  return first
}

const DURATION_UNITS = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/gi

/** "2 d 5 h 30 min", "53h 10m", "12.5 h" and "45 min" all become minutes. Null if none fit. */
export function parseMinutes(text: string): number | null {
  let total = 0
  let found = false
  for (const [, amount, unit] of text.matchAll(DURATION_UNITS)) {
    const value = Number(amount)
    const letter = unit.toLowerCase()[0]
    total += letter === 'd' ? value * 1440 : letter === 'h' ? value * 60 : value
    found = true
  }
  return found ? Math.round(total) : null
}

/**
 * How far a displayed duration may sit from the API value. The UI may drop minutes once a
 * trip passes a day ("2 d 6 h"), so this is loose on purpose. Tighten it if the UI prints
 * exact minutes.
 */
export const DURATION_TOLERANCE_MINUTES = 30

export function expectWithin(actual: number, expected: number, tolerance: number, label: string) {
  expect(actual, `${label}: expected ${expected} give or take ${tolerance}`).toBeGreaterThanOrEqual(
    expected - tolerance,
  )
  expect(actual, `${label}: expected ${expected} give or take ${tolerance}`).toBeLessThanOrEqual(
    expected + tolerance,
  )
}

/** Escapes text for use inside a RegExp. */
export function escapeRegExp(text: string): RegExp['source'] {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
