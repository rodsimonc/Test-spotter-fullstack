import { memo, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, Download, Printer } from 'lucide-react'
import type { DailyLog } from '@/api/types'
import { Button, IconButton } from '@/components/ui/Button'
import { DayBarLegend, DayChip } from './DayChip'
import { formatLongDate, wholeMiles } from './describe'
import { downloadBlob } from './download'
import { exportLogsToPdf } from './exportPdf'
import { VIEW_WIDTH } from './geometry'
import { LogSheet } from './LogSheet'
import { useElementWidth } from './useElementWidth'
import './print.css'

/** A sheet wider than this gains nothing and pushes the totals out of reach of the eye. */
const MAX_SHEET_WIDTH = 960
/** Below this scale the form text is too small to read without zooming. */
const READABLE_SCALE = 0.62

const PrintCopy = memo(LogSheet)

export interface LogViewerProps {
  logs: DailyLog[]
  /** Names the viewer for screen readers, for example "Dallas to Denver". */
  routeTitle?: string
}

type PdfState = 'idle' | 'working' | 'failed'

/**
 * One log sheet at a time, with day navigation, PDF download and print.
 * Every sheet also sits in `#log-print-root`, which is hidden on screen and takes over the page when printing.
 */
export function LogViewer({ logs, routeTitle }: LogViewerProps) {
  const [view, setView] = useState({ source: logs, index: 0 })
  const [announcement, setAnnouncement] = useState('')
  const [pdf, setPdf] = useState<PdfState>('idle')
  const [frameRef, frameWidth] = useElementWidth<HTMLDivElement>()
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([])
  const baseId = useId()

  // A new plan starts back on day 1.
  if (view.source !== logs) setView({ source: logs, index: 0 })
  const index = view.source === logs ? Math.min(view.index, Math.max(0, logs.length - 1)) : 0

  if (logs.length === 0) {
    return (
      <section data-testid="log-viewer" aria-label="Daily logs" className="log-viewer">
        <p className="rounded-2xl bg-ink-50 p-6 text-sm text-ink-600">
          No log sheets yet. Plan a trip to see them here.
        </p>
      </section>
    )
  }

  const log = logs[index]
  const total = logs.length
  const sheetWidth = frameWidth === null ? null : Math.min(frameWidth, MAX_SHEET_WIDTH)
  const scale = (sheetWidth ?? VIEW_WIDTH) / VIEW_WIDTH
  const tabId = (day: number) => `${baseId}-tab-${day}`

  function show(next: number, { focus = false }: { focus?: boolean } = {}) {
    if (next < 0 || next >= total || next === index) return
    const target = logs[next]
    setView({ source: logs, index: next })
    setAnnouncement(
      `Day ${target.day} of ${total}, ${formatLongDate(target.date)}. ${wholeMiles(target.total_miles_driving)} miles driven.`,
    )
    if (focus) chipRefs.current[next]?.focus()
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % total,
      ArrowLeft: (index - 1 + total) % total,
      Home: 0,
      End: total - 1,
    }
    if (!(event.key in targets)) return
    event.preventDefault()
    show(targets[event.key], { focus: true })
  }

  async function downloadPdf() {
    setPdf('working')
    try {
      const filename = `eld-logs-${logs[0].date}.pdf`
      downloadBlob(await exportLogsToPdf(logs, filename), filename)
      setPdf('idle')
    } catch (error) {
      console.error('Could not build the log PDF', error)
      setPdf('failed')
    }
  }

  return (
    <section
      data-testid="log-viewer"
      aria-label={routeTitle ? `Daily logs for ${routeTitle}` : 'Daily logs'}
      className="log-viewer"
    >
      <div className="log-viewer-screen space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton
              aria-label="Previous day"
              data-testid="btn-prev-day"
              disabled={index === 0}
              onClick={() => show(index - 1)}
              className="ring-1 ring-inset ring-ink-300"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </IconButton>
            <div className="min-w-[10.5rem]">
              <h3 className="text-lg leading-tight font-bold text-teal-950">
                Day {log.day} of {total}
              </h3>
              <p className="text-sm text-ink-600">{formatLongDate(log.date)}</p>
            </div>
            <IconButton
              aria-label="Next day"
              data-testid="btn-next-day"
              disabled={index === total - 1}
              onClick={() => show(index + 1)}
              className="ring-1 ring-inset ring-ink-300"
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </IconButton>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              data-testid="btn-pdf-logs"
              loading={pdf === 'working'}
              icon={<Download aria-hidden="true" className="size-4 text-teal-700" />}
              onClick={() => void downloadPdf()}
            >
              Download PDF
            </Button>
            <Button
              size="sm"
              data-testid="btn-print-logs"
              icon={<Printer aria-hidden="true" className="size-4 text-teal-700" />}
              onClick={() => window.print()}
            >
              Print
            </Button>
          </div>
        </div>

        {pdf === 'failed' ? (
          <p role="alert" className="text-sm font-medium text-coral-700">
            Couldn&apos;t build the PDF. Try again, or use Print.
          </p>
        ) : null}

        <div
          role="tablist"
          aria-label="Log days"
          onKeyDown={onTabKeyDown}
          className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2"
        >
          {logs.map((entry, i) => (
            <DayChip
              key={entry.day}
              ref={(node) => {
                chipRefs.current[i] = node
              }}
              id={tabId(entry.day)}
              aria-controls={`${baseId}-panel`}
              log={entry}
              selected={i === index}
              onClick={() => show(i)}
            />
          ))}
        </div>
        <DayBarLegend />

        <div
          id={`${baseId}-panel`}
          role="tabpanel"
          aria-labelledby={tabId(log.day)}
          className="-mx-3 rounded-none bg-ink-100 p-1 [contain:inline-size] sm:mx-0 sm:rounded-2xl sm:p-4"
          ref={frameRef}
        >
          <div
            className="mx-auto overflow-hidden rounded-sm bg-white shadow-[var(--shadow-pop)]"
            style={{ width: sheetWidth ?? '100%' }}
            data-scale={scale.toFixed(2)}
          >
            <LogSheet log={log} className="block h-auto w-full" idPrefix={`screen-${log.day}`} />
          </div>
        </div>

        {scale < READABLE_SCALE ? (
          <p className="text-sm text-ink-600">
            The sheet is shrunk to fit your screen. Pinch to zoom in, or download the PDF for a
            full-size copy.
          </p>
        ) : null}

        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>

      <div
        id="log-print-root"
        data-testid="log-print-root"
        aria-hidden="true"
        className="log-print-root"
      >
        {logs.map((entry) => (
          <div key={entry.day} className="log-print-page">
            <PrintCopy
              log={entry}
              idPrefix={`print-${entry.day}`}
              testId={`log-print-sheet-${entry.day}`}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
