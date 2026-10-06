// Every coordinate on the log sheet lives here, in SVG user units on an 850 x 1100 page
// (US Letter at 100 units per inch). The components only read these constants, and the tests
// assert on them.
import type { DutyStatus, LogEntry, LogTotals } from '@/api/types'
import { fitText, textWidth } from './helvetica'

export const VIEW_WIDTH = 850
export const VIEW_HEIGHT = 1100
export const FONT_FAMILY = 'Helvetica, Arial, sans-serif'

/** Colour of everything the driver writes. The printed form itself is black. */
export const INK = '#1b3a8c'
export const PRINT = '#111111'
export const STATUS_LINE_WIDTH = 2.5

export const MINUTES_PER_DAY = 1440

/** Row order on the form, top to bottom. */
export const ROW_ORDER: readonly DutyStatus[] = ['off_duty', 'sleeper', 'driving', 'on_duty']

export const ROW_LABELS: Record<DutyStatus, readonly string[]> = {
  off_duty: ['1. Off Duty'],
  sleeper: ['2. Sleeper', 'Berth'],
  driving: ['3. Driving'],
  on_duty: ['4. On Duty', '(not driving)'],
}

// The 24-hour grid.
export const GRID_LEFT = 124
export const GRID_RIGHT = 772
export const GRID_WIDTH = GRID_RIGHT - GRID_LEFT
export const BAND_TOP = 306
export const BAND_HEIGHT = 36
export const GRID_TOP = BAND_TOP + BAND_HEIGHT
export const ROW_HEIGHT = 44
export const GRID_BOTTOM = GRID_TOP + ROW_ORDER.length * ROW_HEIGHT
/** The black hour band runs past the grid on both sides, like the paper form. */
export const BAND_LEFT = 102
export const BAND_RIGHT = 820
/** Centre of the "Total Hours" column. */
export const TOTALS_CENTER_X = 802
export const TOTALS_LINE_LEFT = 786
export const TOTALS_LINE_RIGHT = 818

export const TICK_SHORT = 7
export const TICK_LONG = 13

// Remarks.
export const REMARKS_HEADING_Y = 562
export const REMARK_FONT_SIZE = 8.5
export const REMARK_LANE_TOP = 578
export const REMARK_LANE_PITCH = 13
export const REMARK_MIN_LANE_PITCH = 11
export const REMARK_LANES_HEIGHT = 8 * REMARK_LANE_PITCH
export const REMARK_MAX_LABEL_WIDTH = 150
/** The right-most x a remark label may reach. */
export const REMARK_MAX_X = 818
export const REMARK_MIN_X = 40
const REMARK_GAP = 2
const REMARK_BOX_DROP = 2.6
const REMARK_MAX_LANES = 9

// Everything below the remarks lanes.
export const LIST_TOP = 706
export const LIST_PITCH = 13
export const LIST_MAX_ROWS = 8
/** The thick rule that closes the remarks area and opens the recap. */
export const RECAP_TOP = 966

export interface Point {
  x: number
  y: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** x position of a minute of the day (0 to 1440) on the grid. */
export function minuteToX(minute: number): number {
  return GRID_LEFT + (clamp(minute, 0, MINUTES_PER_DAY) / MINUTES_PER_DAY) * GRID_WIDTH
}

export function rowIndex(status: DutyStatus): number {
  return ROW_ORDER.indexOf(status)
}

export function rowTop(status: DutyStatus): number {
  return GRID_TOP + rowIndex(status) * ROW_HEIGHT
}

/** Vertical centre of a status row, where the status line is drawn. */
export function rowY(status: DutyStatus): number {
  return rowTop(status) + ROW_HEIGHT / 2
}

const round2 = (n: number) => Math.round(n * 100) / 100
const num = (n: number) => String(round2(n))

/** Corner points of the status line, one run per unbroken stretch of entries. */
export function statusRuns(entries: readonly LogEntry[]): Point[][] {
  const runs: Point[][] = []
  let run: Point[] = []
  let previousEnd: number | null = null

  for (const entry of entries) {
    if (!(entry.end_min > entry.start_min)) continue
    const y = rowY(entry.status)
    const startX = minuteToX(entry.start_min)
    if (previousEnd !== null && entry.start_min === previousEnd) {
      const last = run[run.length - 1]
      if (last.y !== y) run.push({ x: startX, y })
    } else {
      if (run.length) runs.push(run)
      run = [{ x: startX, y }]
    }
    run.push({ x: minuteToX(entry.end_min), y })
    previousEnd = entry.end_min
  }
  if (run.length) runs.push(run)

  return runs.map(dropFlatMidpoints)
}

/** Two entries in the same row leave a point in the middle of a straight line. Remove it. */
function dropFlatMidpoints(run: Point[]): Point[] {
  return run.filter((point, i) => {
    if (i === 0 || i === run.length - 1) return true
    const before = run[i - 1]
    const after = run[i + 1]
    return !(before.y === point.y && after.y === point.y)
  })
}

/** SVG path data for the status line: level runs with right-angle connectors. */
export function buildStatusPath(entries: readonly LogEntry[]): string {
  return statusRuns(entries)
    .map((run) => {
      const [first, ...rest] = run
      let previous = first
      const commands = rest.map((point) => {
        const command = point.y === previous.y ? `H${num(point.x)}` : `V${num(point.y)}`
        previous = point
        return command
      })
      return [`M${num(first.x)} ${num(first.y)}`, ...commands].join(' ')
    })
    .join(' ')
}

/** Hours as a decimal with up to two places and no trailing zeros: 4.5, 1.75, 24. */
export function formatHours(minutes: number): string {
  return String(round2(minutes / 60))
}

/** The four row totals in hours, rounded so the displayed values add up to the displayed total. */
export function formatTotals(totals: LogTotals): Record<DutyStatus, string> & { total: string } {
  const exact = ROW_ORDER.map((status) => (totals[status] / 60) * 100)
  const floors = exact.map(Math.floor)
  const target = Math.round(exact.reduce((sum, value) => sum + value, 0))
  let missing = target - floors.reduce((sum, value) => sum + value, 0)
  const byRemainder = exact
    .map((value, i) => ({ i, remainder: value - floors[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i)
  for (const { i } of byRemainder) {
    if (missing <= 0) break
    floors[i] += 1
    missing -= 1
  }
  const text = (centiHours: number) => String(centiHours / 100)
  return {
    off_duty: text(floors[0]),
    sleeper: text(floors[1]),
    driving: text(floors[2]),
    on_duty: text(floors[3]),
    total: text(target),
  }
}

/** 12-hour clock for a minute of the day: 360 is "06:00 AM", 1440 is "12:00 AM". */
export function formatClock(minute: number): string {
  const whole = Math.round(clamp(minute, 0, MINUTES_PER_DAY))
  const hours24 = Math.floor(whole / 60) % 24
  const mins = whole % 60
  const suffix = hours24 < 12 ? 'AM' : 'PM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${String(hours12).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${suffix}`
}

export interface RemarkInput {
  minute: number
  place: string
}

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

export interface RemarkPlacement {
  /** Position in the input list. */
  index: number
  minute: number
  /** Text drawn, shortened when the place is long or the page edge is close. */
  label: string
  /** x of the leader line. */
  leaderX: number
  /** Which side of the leader the text sits on. */
  side: 'right' | 'left'
  lane: number
  textX: number
  baselineY: number
  textAnchor: 'start' | 'end'
  /** Where the label ink falls. Labels never overlap one another or another leader. */
  box: Box
  /** Bottom end of the leader line. */
  leaderBottom: number
}

export interface RemarkLayout {
  placements: RemarkPlacement[]
  laneCount: number
  lanePitch: number
}

interface LayoutOptions {
  fontSize?: number
  laneTop?: number
  lanePitch?: number
  maxLabelWidth?: number
}

/** Label widths to try, widest first. A crowded day gets shorter labels rather than a taller block. */
const WIDTH_STEPS = [REMARK_MAX_LABEL_WIDTH, 110, 80, 56, 40, 28]
const MIN_LABEL_WIDTH = 24
/** A cut-off place name costs this many lanes when two ways to split the day are compared. */
const SHORTENED_PENALTY = 3
/** Label text starts this far from its leader, and the label box reaches one unit further out. */
const LEADER_TO_TEXT = 4
const NOON_X = GRID_LEFT + GRID_WIDTH / 2

interface Candidate {
  index: number
  minute: number
  x: number
  place: string
  label: string
  width: number
  lane: number
}

type Side = 'right' | 'left'

/**
 * Shortens the place to the room the page leaves on that side of the leader.
 * The text never gets narrower than `MIN_LABEL_WIDTH`, so a very late change ends in "...".
 */
function fitLabel(place: string, x: number, side: Side, fontSize: number, widest: number) {
  const room =
    side === 'right' ? REMARK_MAX_X - x - LEADER_TO_TEXT - 1 : x - LEADER_TO_TEXT - 1 - REMARK_MIN_X
  const label = fitText(place, fontSize, Math.max(MIN_LABEL_WIDTH, Math.min(widest, room)))
  return { label, width: textWidth(label, fontSize) }
}

/**
 * Gives every label in one group a lane. Labels in a group all point the same way, so the only
 * labels a leader can meet are the ones whose text reaches over its x. A label that reaches over
 * another leader goes below that leader's own label, which is why the stack grows toward the middle.
 */
function assignLanes(
  group: readonly RemarkInput[],
  items: Candidate[],
  side: Side,
  fontSize: number,
  widest: number,
) {
  // Work outward from the page edge: the item nearest the edge has nothing to clear.
  const ordered = [...items].sort((a, b) =>
    side === 'right' ? b.x - a.x || b.index - a.index : a.x - b.x || a.index - b.index,
  )
  const placed: Candidate[] = []
  for (const item of ordered) {
    const { label, width } = fitLabel(group[item.index].place, item.x, side, fontSize, widest)
    item.label = label
    item.width = width
    const reach = LEADER_TO_TEXT + 1 + width + REMARK_GAP
    const clash = placed.filter((other) =>
      side === 'right' ? other.x <= item.x + reach : other.x >= item.x - reach,
    )
    item.lane = clash.reduce((lane, other) => Math.max(lane, other.lane + 1), 0)
    placed.push(item)
  }
}

interface Arrangement {
  items: Candidate[]
  /** Items from this position in x order onward have their text on the right. */
  cut: number
  laneCount: number
  shortened: number
}

function arrange(remarks: readonly RemarkInput[], fontSize: number, widest: number): Arrangement {
  const sorted: Candidate[] = remarks
    .map((remark, index) => ({
      index,
      minute: remark.minute,
      x: minuteToX(remark.minute),
      place: remark.place,
      label: remark.place,
      width: 0,
      lane: 0,
    }))
    .sort((a, b) => a.x - b.x || a.index - b.index)

  // Text to the left of the earlier changes and to the right of the later ones means no label
  // ever points at another label's leader. The split that stacks lowest wins.
  let best: Arrangement | null = null
  let bestDistance = Infinity
  for (let cut = 0; cut <= sorted.length; cut++) {
    const items = sorted.map((item) => ({ ...item }))
    assignLanes(remarks, items.slice(0, cut), 'left', fontSize, widest)
    assignLanes(remarks, items.slice(cut), 'right', fontSize, widest)
    const laneCount = items.reduce((max, item) => Math.max(max, item.lane + 1), 0)
    const shortened = items.filter((item) => item.label !== item.place).length
    const pivotX =
      cut === 0
        ? GRID_LEFT
        : cut === items.length
          ? GRID_RIGHT
          : (items[cut - 1].x + items[cut].x) / 2
    const distance = Math.abs(pivotX - NOON_X)
    const score = laneCount + shortened * SHORTENED_PENALTY
    const bestScore = best ? best.laneCount + best.shortened * SHORTENED_PENALTY : Infinity
    if (score < bestScore || (score === bestScore && distance < bestDistance)) {
      best = { items, cut, laneCount, shortened }
      bestDistance = distance
    }
  }
  return best ?? { items: [], cut: 0, laneCount: 0, shortened: 0 }
}

/**
 * Places each remark label under the grid, joined to its status change by a vertical leader.
 *
 * Changes in the morning write their label to the left of the leader and later ones to the
 * right, so the labels fan away from each other. Within each half, a label that would cover
 * a neighbouring leader drops to a lower lane. No label ever sits on another label or on
 * someone else's leader, whatever the spacing.
 */
export function layoutRemarks(
  remarks: readonly RemarkInput[],
  options: LayoutOptions = {},
): RemarkLayout {
  const fontSize = options.fontSize ?? REMARK_FONT_SIZE
  const laneTop = options.laneTop ?? REMARK_LANE_TOP
  const requestedPitch = options.lanePitch ?? REMARK_LANE_PITCH
  const widest = options.maxLabelWidth ?? REMARK_MAX_LABEL_WIDTH

  const steps = [widest, ...WIDTH_STEPS.filter((step) => step < widest)]
  let arrangement = arrange(remarks, fontSize, steps[0])
  for (const step of steps.slice(1)) {
    if (arrangement.laneCount <= REMARK_MAX_LANES) break
    arrangement = arrange(remarks, fontSize, step)
  }

  const { items, cut, laneCount } = arrangement
  const fitting = laneCount > 0 ? REMARK_LANES_HEIGHT / laneCount : requestedPitch
  const lanePitch = clamp(fitting, REMARK_MIN_LANE_PITCH, requestedPitch)

  const placements = items
    .map((item, position): RemarkPlacement => {
      const side: Side = position < cut ? 'left' : 'right'
      const baselineY = laneTop + item.lane * lanePitch
      const bottom = baselineY + REMARK_BOX_DROP
      const left =
        side === 'right' ? item.x + LEADER_TO_TEXT - 1 : item.x - LEADER_TO_TEXT - 1 - item.width
      const right =
        side === 'right' ? item.x + LEADER_TO_TEXT + 1 + item.width : item.x - LEADER_TO_TEXT + 1
      return {
        index: item.index,
        minute: item.minute,
        label: item.label,
        leaderX: item.x,
        side,
        lane: item.lane,
        textX: side === 'right' ? item.x + LEADER_TO_TEXT : item.x - LEADER_TO_TEXT,
        baselineY,
        textAnchor: side === 'right' ? 'start' : 'end',
        box: { left, right, top: baselineY - fontSize * 0.95, bottom },
        leaderBottom: bottom,
      }
    })
    .sort((a, b) => a.index - b.index)

  return { placements, laneCount, lanePitch }
}
