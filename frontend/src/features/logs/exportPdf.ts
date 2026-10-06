import { createElement } from 'react'
import type { DailyLog } from '@/api/types'
import { VIEW_HEIGHT, VIEW_WIDTH } from './geometry'
import { LogSheet } from './LogSheet'

/** US Letter in PDF points. */
const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
/** Printers cannot reach the edge of the paper, so the sheet sits inside a quarter-inch frame. */
const PAGE_MARGIN = 18

const SHEET_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2
const SHEET_HEIGHT = (SHEET_WIDTH * VIEW_HEIGHT) / VIEW_WIDTH
const SHEET_TOP = (PAGE_HEIGHT - SHEET_HEIGHT) / 2

/**
 * Builds one US Letter page per daily log and returns the PDF.
 *
 * Every sheet is converted from its SVG, so text stays text and lines stay lines. The jsPDF,
 * svg2pdf and react-dom/server code loads on the first call and stays out of the main bundle.
 * Nothing is saved or downloaded here: pass the blob to `downloadBlob`.
 */
export async function exportLogsToPdf(logs: DailyLog[], filename = 'eld-logs.pdf'): Promise<Blob> {
  if (logs.length === 0) throw new Error('There are no log sheets to export.')

  const [{ jsPDF }, { svg2pdf }, { renderToStaticMarkup }] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
    import('react-dom/server'),
  ])

  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' })
  doc.setProperties({
    title: filename.replace(/\.pdf$/i, ''),
    subject: "Driver's daily logs (24 hours)",
    creator: 'ELD trip planner',
  })

  // The converter reads styles from a rendered tree, so the sheets sit off screen while it works.
  const stage = document.createElement('div')
  stage.setAttribute('aria-hidden', 'true')
  stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${VIEW_WIDTH}px;height:${VIEW_HEIGHT}px;pointer-events:none`
  document.body.append(stage)

  try {
    for (const [index, log] of logs.entries()) {
      stage.innerHTML = renderToStaticMarkup(
        createElement(LogSheet, { log, idPrefix: `pdf-${log.day}` }),
      )
      const svg = stage.querySelector('svg')
      if (!svg) throw new Error(`Log sheet for day ${log.day} did not render.`)
      if (index > 0) doc.addPage('letter', 'portrait')
      await svg2pdf(svg, doc, {
        x: PAGE_MARGIN,
        y: SHEET_TOP,
        width: SHEET_WIDTH,
        height: SHEET_HEIGHT,
      })
    }
  } finally {
    stage.remove()
  }

  return doc.output('blob')
}
