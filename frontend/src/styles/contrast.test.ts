// Reads the color tokens from index.css and checks the text and background pairs the UI uses
// against WCAG AA (4.5 to 1 for normal text). A palette tweak that breaks contrast fails here.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Read from disk. With css switched off in Vitest, a ?raw import of the stylesheet comes back empty.
const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8')

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (!match) throw new Error(`Missing color token ${name}`)
  return match[1]
}

function channel(value: number): number {
  const s = value / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = '#ffffff'
const color = (name: string) => (name === 'white' ? WHITE : token(name))

// [text, background, where it is used]
const PAIRS: [string, string, string][] = [
  ['white', 'coral-600', 'primary button'],
  ['white', 'coral-700', 'primary button on hover'],
  ['white', 'teal-600', 'rename save button'],
  ['white', 'teal-950', 'dark buttons, toasts, pick banner'],
  ['coral-700', 'white', 'field errors'],
  ['coral-800', 'coral-50', 'error banners and delete prompt'],
  ['teal-700', 'white', 'links, remaining hours'],
  ['teal-700', 'teal-50', 'links on tinted panels'],
  ['teal-950', 'mint-200', 'create account button'],
  ['mint-200', 'teal-950', 'header subtitle'],
  ['ink-500', 'white', 'placeholders and hints'],
  ['ink-600', 'white', 'secondary text'],
  ['ink-600', 'ink-25', 'secondary text in the drawer'],
  ['ink-600', 'ink-50', 'secondary text on the page background'],
  ['ink-700', 'ink-100', 'chips'],
  ['ink-900', 'white', 'body text'],
]

describe('color contrast', () => {
  it('computes the known extremes', () => {
    expect(contrast('#000000', WHITE)).toBeCloseTo(21, 0)
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5)
  })

  it.each(PAIRS)('%s on %s reaches 4.5 to 1 (%s)', (text, background) => {
    expect(contrast(color(text), color(background))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the bright coral for shapes, where 3 to 1 is enough', () => {
    expect(contrast(token('coral-500'), WHITE)).toBeGreaterThanOrEqual(3)
  })
})
