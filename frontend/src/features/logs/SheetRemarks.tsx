import type { DailyLog, LogEntry } from '@/api/types'
import {
  GRID_BOTTOM,
  INK,
  LIST_MAX_ROWS,
  LIST_PITCH,
  LIST_TOP,
  PRINT,
  RECAP_TOP,
  REMARKS_HEADING_Y,
  VIEW_WIDTH,
  formatClock,
  layoutRemarks,
  rowY,
} from './geometry'
import { fitText, textWidth } from './helvetica'
import { FilledLine, InkText, T } from './svgPrimitives'

const LIST_FONT = 8.5
const LIST_LEFT = [40, 440] as const
const LIST_COLUMN_WIDTH = 372

/** The entry that is in force at a minute of the day, where a status change begins. */
function entryAt(entries: readonly LogEntry[], minute: number): LogEntry | undefined {
  return (
    entries.find((entry) => minute >= entry.start_min && minute < entry.end_min) ??
    entries[entries.length - 1]
  )
}

/** "Remarks": leader lines and place names under the grid, then every status change in a numbered list. */
export function RemarksBlock({ log }: { log: DailyLog }) {
  const layout = layoutRemarks(log.remarks)
  const rowsPerColumn = Math.max(1, Math.ceil(log.remarks.length / 2))
  const pitch =
    rowsPerColumn > LIST_MAX_ROWS
      ? Math.max(9.5, (LIST_MAX_ROWS * LIST_PITCH) / rowsPerColumn)
      : LIST_PITCH

  return (
    <g>
      <T x={30} y={REMARKS_HEADING_Y} size={13} bold>
        Remarks
      </T>
      <line
        x1={31}
        x2={31}
        y1={REMARKS_HEADING_Y + 8}
        y2={RECAP_TOP}
        stroke={PRINT}
        strokeWidth={2.5}
      />

      <g data-testid="log-remark-leaders">
        {layout.placements.map((placement) => {
          const entry = entryAt(log.entries, placement.minute)
          const dotY = entry ? rowY(entry.status) : GRID_BOTTOM
          return (
            <g key={placement.index} data-testid={`log-remark-${placement.index}`}>
              <line
                x1={placement.leaderX}
                x2={placement.leaderX}
                y1={dotY}
                y2={placement.leaderBottom}
                stroke={INK}
                strokeWidth={0.8}
              />
              <circle
                cx={placement.leaderX}
                cy={dotY}
                r={3.4}
                fill="#ffffff"
                stroke={INK}
                strokeWidth={1.3}
              />
              <T
                x={placement.textX}
                y={placement.baselineY}
                size={8.5}
                anchor={placement.textAnchor}
                fill={INK}
              >
                {placement.label}
              </T>
            </g>
          )
        })}
      </g>

      <T x={LIST_LEFT[0]} y={LIST_TOP - 14} size={8.5} bold>
        Status changes
      </T>
      <g data-testid="log-remark-list">
        {log.remarks.map((remark, i) => {
          const column = Math.floor(i / rowsPerColumn)
          const row = i % rowsPerColumn
          const left = LIST_LEFT[Math.min(column, 1)]
          const y = LIST_TOP + row * pitch
          const placeX = left + 74
          const place = fitText(remark.place, LIST_FONT, 150)
          const noteX = placeX + textWidth(place, LIST_FONT) + 8
          const noteRoom = left + LIST_COLUMN_WIDTH - noteX
          return (
            <g key={i} data-testid={`log-remark-row-${i}`}>
              <T x={left + 14} y={y} size={LIST_FONT} bold anchor="end">
                {`${i + 1}.`}
              </T>
              <InkText x={left + 20} y={y} size={LIST_FONT} maxWidth={52}>
                {formatClock(remark.minute)}
              </InkText>
              <InkText x={placeX} y={y} size={LIST_FONT} maxWidth={150} bold>
                {place}
              </InkText>
              {noteRoom > 20 ? (
                <InkText x={noteX} y={y} size={LIST_FONT} maxWidth={noteRoom}>
                  {remark.note}
                </InkText>
              ) : null}
            </g>
          )
        })}
      </g>
    </g>
  )
}

/** Shipping document number and shipper, plus the printed instruction that closes the remarks area. */
export function ShippingBlock({ log }: { log: DailyLog }) {
  const { header } = log
  const shipperLine = [header.shipper, header.commodity].filter(Boolean).join(' - ')
  return (
    <g>
      <T x={40} y={832} size={10} bold>
        Shipping Documents:
      </T>
      <FilledLine x1={40} x2={330} y={860} value={header.shipping_doc_no} testId="log-doc-no" />
      <T x={40} y={871} size={8.5} bold>
        DVL or Manifest No.
      </T>
      <T x={40} y={884} size={8.5} bold>
        or
      </T>
      <FilledLine x1={40} x2={330} y={908} value={shipperLine} testId="log-shipper" />
      <T x={40} y={919} size={8.5} bold>
        Shipper &amp; Commodity
      </T>

      <T x={470} y={832} size={10} bold>
        Driver&apos;s certification:
      </T>
      <T x={470} y={856} size={8.5} bold>
        I certify that these entries are true and correct.
      </T>
      {/* Left blank on purpose: the driver signs it. */}
      <line
        data-testid="log-signature"
        x1={470}
        x2={818}
        y1={908}
        y2={908}
        stroke={PRINT}
        strokeWidth={0.9}
      />
      <T x={470} y={919} size={8.5} bold>
        Driver&apos;s signature in full
      </T>

      <T x={VIEW_WIDTH / 2} y={944} size={8.5} bold anchor="middle">
        Enter name of place you reported and where released from work and when and where each change
        of duty occurred.
      </T>
      <T x={VIEW_WIDTH / 2} y={955} size={8.5} bold anchor="middle">
        Use time standard of home terminal.
      </T>
    </g>
  )
}
