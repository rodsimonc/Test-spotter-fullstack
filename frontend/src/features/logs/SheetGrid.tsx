import type { DailyLog, DutyStatus } from '@/api/types'
import {
  BAND_HEIGHT,
  BAND_LEFT,
  BAND_RIGHT,
  BAND_TOP,
  GRID_BOTTOM,
  GRID_LEFT,
  GRID_RIGHT,
  GRID_TOP,
  INK,
  PRINT,
  ROW_HEIGHT,
  ROW_LABELS,
  ROW_ORDER,
  STATUS_LINE_WIDTH,
  TICK_LONG,
  TICK_SHORT,
  TOTALS_CENTER_X,
  TOTALS_LINE_LEFT,
  TOTALS_LINE_RIGHT,
  buildStatusPath,
  formatTotals,
  minuteToX,
  rowTop,
} from './geometry'
import { InkText, T } from './svgPrimitives'

const HOURS = Array.from({ length: 25 }, (_, hour) => hour)

function hourLabel(hour: number): string {
  if (hour === 12) return 'Noon'
  return String(hour % 12 === 0 ? 12 : hour % 12)
}

/** The black hour band with its labels. */
function HourBand() {
  const labelY = BAND_TOP + BAND_HEIGHT - 7
  return (
    <g>
      <rect
        x={BAND_LEFT}
        y={BAND_TOP}
        width={BAND_RIGHT - BAND_LEFT}
        height={BAND_HEIGHT}
        fill={PRINT}
      />
      {HOURS.map((hour) => {
        const x = minuteToX(hour * 60)
        if (hour === 0 || hour === 24) {
          // The closing label ends just past the grid so it stays clear of "Total Hours".
          const anchor = hour === 0 ? 'middle' : 'end'
          const labelX = hour === 0 ? x : x + 7
          return (
            <g key={hour}>
              <T x={labelX} y={labelY - 12} size={9.5} bold anchor={anchor} fill="#ffffff">
                Mid-
              </T>
              <T x={labelX} y={labelY} size={9.5} bold anchor={anchor} fill="#ffffff">
                night
              </T>
            </g>
          )
        }
        return (
          <T key={hour} x={x} y={labelY} size={9.5} bold anchor="middle" fill="#ffffff">
            {hourLabel(hour)}
          </T>
        )
      })}
      <T x={TOTALS_CENTER_X} y={labelY - 12} size={8.5} bold anchor="middle" fill="#ffffff">
        Total
      </T>
      <T x={TOTALS_CENTER_X} y={labelY} size={8.5} bold anchor="middle" fill="#ffffff">
        Hours
      </T>
    </g>
  )
}

/** Row frames, hour lines and the 15-minute ticks. Rows 1 and 2 hang ticks from the top, rows 3 and 4 raise them from the bottom, as on the paper form. */
function GridLines() {
  return (
    <g shapeRendering="crispEdges">
      {ROW_ORDER.map((status, row) => {
        const top = rowTop(status)
        const fromTop = row < 2
        return (
          <g key={status}>
            {HOURS.slice(0, 24).flatMap((hour) =>
              [0, 15, 30, 45].map((part) => {
                const minute = hour * 60 + part
                const x = minuteToX(minute)
                if (part === 0) {
                  return (
                    <line
                      key={minute}
                      x1={x}
                      x2={x}
                      y1={top}
                      y2={top + ROW_HEIGHT}
                      stroke={PRINT}
                      strokeWidth={1}
                    />
                  )
                }
                const length = part === 30 ? TICK_LONG : TICK_SHORT
                const [y1, y2] = fromTop
                  ? [top, top + length]
                  : [top + ROW_HEIGHT - length, top + ROW_HEIGHT]
                return (
                  <line
                    key={minute}
                    x1={x}
                    x2={x}
                    y1={y1}
                    y2={y2}
                    stroke={PRINT}
                    strokeWidth={0.6}
                  />
                )
              }),
            )}
          </g>
        )
      })}
      {Array.from({ length: ROW_ORDER.length + 1 }, (_, i) => (
        <line
          key={i}
          x1={GRID_LEFT}
          x2={GRID_RIGHT}
          y1={GRID_TOP + i * ROW_HEIGHT}
          y2={GRID_TOP + i * ROW_HEIGHT}
          stroke={PRINT}
          strokeWidth={1.2}
        />
      ))}
      <line
        x1={GRID_RIGHT}
        x2={GRID_RIGHT}
        y1={GRID_TOP}
        y2={GRID_BOTTOM}
        stroke={PRINT}
        strokeWidth={1.2}
      />
      <line
        x1={GRID_LEFT}
        x2={GRID_LEFT}
        y1={GRID_TOP}
        y2={GRID_BOTTOM}
        stroke={PRINT}
        strokeWidth={1.2}
      />
    </g>
  )
}

function RowLabels() {
  return (
    <g>
      {ROW_ORDER.map((status) => {
        const lines = ROW_LABELS[status]
        const center = rowTop(status) + ROW_HEIGHT / 2
        const firstY = lines.length === 1 ? center + 3.5 : center - 3
        return lines.map((line, i) => (
          <T key={`${status}-${i}`} x={30} y={firstY + i * 11.5} size={9.5} bold>
            {line}
          </T>
        ))
      })}
    </g>
  )
}

/** Hours per row on the right, and the double-ruled grand total. */
function TotalsColumn({ totals }: { totals: DailyLog['totals'] }) {
  const hours = formatTotals(totals)
  const ruleY = (status: DutyStatus) => rowTop(status) + ROW_HEIGHT - 11
  const doubleY = GRID_BOTTOM + 15
  return (
    <g>
      {ROW_ORDER.map((status) => (
        <g key={status}>
          <line
            x1={TOTALS_LINE_LEFT}
            x2={TOTALS_LINE_RIGHT}
            y1={ruleY(status)}
            y2={ruleY(status)}
            stroke={PRINT}
            strokeWidth={1}
          />
          <InkText
            x={TOTALS_CENTER_X}
            y={ruleY(status) - 4}
            size={12}
            bold
            anchor="middle"
            maxWidth={38}
            testId={`log-total-${status}`}
          >
            {hours[status]}
          </InkText>
        </g>
      ))}
      <InkText
        x={TOTALS_CENTER_X}
        y={doubleY - 5}
        size={12}
        bold
        anchor="middle"
        maxWidth={38}
        testId="log-total-all"
      >
        {hours.total}
      </InkText>
      <line
        x1={TOTALS_LINE_LEFT}
        x2={TOTALS_LINE_RIGHT}
        y1={doubleY}
        y2={doubleY}
        stroke={PRINT}
        strokeWidth={1}
      />
      <line
        x1={TOTALS_LINE_LEFT}
        x2={TOTALS_LINE_RIGHT}
        y1={doubleY + 3}
        y2={doubleY + 3}
        stroke={PRINT}
        strokeWidth={1}
      />
    </g>
  )
}

/** The hour band, the four rows, the status line and the totals. */
export function SheetGrid({ log }: { log: DailyLog }) {
  return (
    <g>
      <HourBand />
      <GridLines />
      <RowLabels />
      <TotalsColumn totals={log.totals} />
      <path
        d={buildStatusPath(log.entries)}
        fill="none"
        stroke={INK}
        strokeWidth={STATUS_LINE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-testid="log-status-line"
      />
    </g>
  )
}
