import type { DailyLog } from '@/api/types'
import { describeLog } from './describe'
import { FONT_FAMILY, VIEW_HEIGHT, VIEW_WIDTH } from './geometry'
import { SheetGrid } from './SheetGrid'
import { SheetHeader } from './SheetHeader'
import { RecapBlock } from './SheetRecap'
import { RemarksBlock, ShippingBlock } from './SheetRemarks'

export interface LogSheetProps {
  log: DailyLog
  className?: string
  /** Prefix for ids inside the SVG. Give each sheet on a page its own. */
  idPrefix?: string
  /** Overrides the default `log-sheet-<day>` test id. */
  testId?: string
}

/**
 * One driver's daily log, drawn as plain SVG on a US Letter page (850 x 1100 units).
 * It uses only attributes and the Helvetica family, so the PDF export reads it without a browser.
 */
export function LogSheet({ log, className, idPrefix, testId }: LogSheetProps) {
  const prefix = idPrefix ?? `log-${log.day}`
  const { title, desc } = describeLog(log)

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-labelledby={`${prefix}-title ${prefix}-desc`}
      className={className}
      fontFamily={FONT_FAMILY}
      data-testid={testId ?? `log-sheet-${log.day}`}
    >
      <title id={`${prefix}-title`}>{title}</title>
      <desc id={`${prefix}-desc`}>{desc}</desc>
      <rect width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#ffffff" />
      <SheetHeader log={log} />
      <SheetGrid log={log} />
      <RemarksBlock log={log} />
      <ShippingBlock log={log} />
      <RecapBlock log={log} />
    </svg>
  )
}
