import type { DailyLog } from '@/api/types'
import { INK, PRINT, RECAP_TOP, formatHours } from './geometry'
import { InkText, T } from './svgPrimitives'

const TEXT_SIZE = 7.4
const LINE_PITCH = 9.2
const RULE_Y = 1015
const VALUE_Y = 1011
const NOTES_Y = 1027

interface ColumnProps {
  x: number
  width: number
  letter?: string
  value?: string
  lines: readonly string[]
  testId?: string
}

/** One recap column: a rule to write on, the letter, the value, and the printed wording under it. */
function RecapColumn({ x, width, letter, value, lines, testId }: ColumnProps) {
  const valueCenter = letter ? x + 10 + (width - 10) / 2 : x + width / 2
  return (
    <g>
      <line x1={x} x2={x + width} y1={RULE_Y} y2={RULE_Y} stroke={PRINT} strokeWidth={0.9} />
      {letter ? (
        <T x={x} y={VALUE_Y} size={11}>
          {letter}
        </T>
      ) : null}
      {value !== undefined ? (
        <InkText
          x={valueCenter}
          y={VALUE_Y}
          size={12}
          bold
          anchor="middle"
          maxWidth={width - 12}
          testId={testId}
        >
          {value}
        </InkText>
      ) : null}
      {lines.map((line, i) => (
        <T key={line} x={x} y={NOTES_Y + i * LINE_PITCH} size={TEXT_SIZE}>
          {line}
        </T>
      ))}
    </g>
  )
}

function Lines({
  x,
  y,
  lines,
  bold = false,
}: {
  x: number
  y: number
  lines: readonly string[]
  bold?: boolean
}) {
  return (
    <>
      {lines.map((line, i) => (
        <T key={line} x={x} y={y + i * LINE_PITCH} size={TEXT_SIZE + 0.4} bold={bold}>
          {line}
        </T>
      ))}
    </>
  )
}

const COLUMN_WIDTH = 68
const SEVENTY_X = [230, 304, 378] as const
const SIXTY_X = [506, 580, 654] as const

/** The recap block at the bottom of the form. The 70-hour/8-day side is filled in, the 60-hour side stays blank. */
export function RecapBlock({ log }: { log: DailyLog }) {
  const { recap } = log
  return (
    <g>
      <line x1={30} x2={820} y1={RECAP_TOP} y2={RECAP_TOP} stroke={PRINT} strokeWidth={2.5} />

      <Lines x={30} y={RECAP_TOP + 18} lines={['Recap:', 'Complete at', 'end of day']} bold />
      <RecapColumn
        x={98}
        width={72}
        value={formatHours(recap.on_duty_today_minutes)}
        lines={['On duty hours', 'today, Total', 'lines 3 & 4']}
        testId="log-recap-today"
      />

      <Lines x={178} y={RECAP_TOP + 36} lines={['70 Hour/', '8 Day', 'Drivers']} bold />
      <RecapColumn
        x={SEVENTY_X[0]}
        width={COLUMN_WIDTH}
        letter="A."
        value={formatHours(recap.a_minutes)}
        lines={['A. Total hours on', 'duty last 8 days', 'including today.']}
        testId="log-recap-a"
      />
      <RecapColumn
        x={SEVENTY_X[1]}
        width={COLUMN_WIDTH}
        letter="B."
        value={formatHours(recap.b_minutes)}
        lines={['B. Total hours', 'available tomorrow', '70 hr. minus A*']}
        testId="log-recap-b"
      />
      <RecapColumn
        x={SEVENTY_X[2]}
        width={COLUMN_WIDTH}
        letter="C."
        value={formatHours(recap.c_minutes)}
        lines={['C. Total hours on', 'duty last 7 days', 'including today.']}
        testId="log-recap-c"
      />

      <Lines x={456} y={RECAP_TOP + 36} lines={['60 Hour/', '7 Day', 'Drivers']} bold />
      <RecapColumn
        x={SIXTY_X[0]}
        width={COLUMN_WIDTH}
        letter="A."
        lines={['A. Total hours on', 'duty last 7 days', 'including today.']}
      />
      <RecapColumn
        x={SIXTY_X[1]}
        width={COLUMN_WIDTH}
        letter="B."
        lines={['B. Total hours', 'available tomorrow', '60 hr. minus A*']}
      />
      <RecapColumn
        x={SIXTY_X[2]}
        width={COLUMN_WIDTH}
        letter="C."
        lines={['C. Total hours on', 'duty last 5 days', 'including today.']}
      />

      <Lines
        x={734}
        y={RECAP_TOP + 18}
        lines={[
          '*If you took 34',
          'consecutive hours',
          'off duty you have',
          '60/70 hours',
          'available',
        ]}
      />

      <line x1={30} x2={820} y1={1068} y2={1068} stroke={PRINT} strokeWidth={2.5} />
      {recap.restart_completed ? (
        <T x={SEVENTY_X[0]} y={1060} size={9} bold fill={INK} testId="log-restart-note">
          34-hour restart completed today
        </T>
      ) : null}
    </g>
  )
}
