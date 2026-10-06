import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { multiDayPlan, shortPlan } from '@/test/fixtures'
import { exportLogsToPdf } from './exportPdf'
import { textWidth } from './helvetica'

// svg2pdf.js ships a UMD build as its Node entry, which cannot find jsPDF under Vitest. The ES build
// is the one browsers get, so the tests load that.
const SVG2PDF_ES_BUILD = 'svg2pdf.js/dist/svg2pdf.es.js'
vi.mock('svg2pdf.js', async () => await import(/* @vite-ignore */ SVG2PDF_ES_BUILD))

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsBinaryString(blob)
  })
}

/** Counts `/Type /Page` objects, which are the pages. `/Type /Pages` is the tree node. */
function pageCount(pdf: string): number {
  return (pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
}

describe('exportLogsToPdf', () => {
  beforeEach(() => {
    // jsdom has no text layout. svg2pdf asks for a text box and a canvas, so both get small stand-ins.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    Object.defineProperty(SVGElement.prototype, 'getBBox', {
      configurable: true,
      value(this: SVGElement) {
        const size = parseFloat(this.getAttribute('font-size') ?? '10')
        return { x: 0, y: 0, width: textWidth(this.textContent ?? '', size), height: size }
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(SVGElement.prototype, 'getBBox')
  })

  it('returns a PDF with one Letter page for a single log', async () => {
    const blob = await exportLogsToPdf(shortPlan.logs)
    const pdf = await readBlob(blob)

    expect(blob.type).toBe('application/pdf')
    expect(pdf.startsWith('%PDF-')).toBe(true)
    expect(pageCount(pdf)).toBe(1)
    expect(pdf).toMatch(/\/MediaBox \[0\.? 0\.? 612\.? 792\.?\]/)
  })

  it('adds one page per log', async () => {
    const pdf = await readBlob(await exportLogsToPdf(multiDayPlan.logs, 'trip.pdf'))

    expect(pageCount(pdf)).toBe(multiDayPlan.logs.length)
    expect(pdf).toContain('/Title (trip)')
  })

  it('draws the sheet as vector text and lines, not as an image', async () => {
    const pdf = await readBlob(await exportLogsToPdf(shortPlan.logs))

    expect(pdf).not.toContain('/Subtype /Image')
    expect(pdf).toContain('/BaseFont /Helvetica')
    expect(pdf).toContain('Drivers Daily Log')
  })

  it('leaves no stage element behind', async () => {
    await exportLogsToPdf(shortPlan.logs)

    expect(document.body.querySelector('svg')).toBeNull()
  })

  it('refuses an empty list', async () => {
    await expect(exportLogsToPdf([])).rejects.toThrow('no log sheets')
  })
})
