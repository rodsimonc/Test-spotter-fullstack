import { describe, expect, it } from 'vitest'
import type { DutyStatus, LogEntry } from '@/api/types'
import { multiDayPlan, shortPlan } from '@/test/fixtures'
import {
  GRID_BOTTOM,
  GRID_LEFT,
  GRID_RIGHT,
  GRID_TOP,
  GRID_WIDTH,
  REMARK_FONT_SIZE,
  REMARK_MAX_X,
  REMARK_MIN_X,
  ROW_HEIGHT,
  ROW_ORDER,
  buildStatusPath,
  formatClock,
  formatHours,
  formatTotals,
  layoutRemarks,
  minuteToX,
  rowY,
  statusRuns,
  type RemarkInput,
  type RemarkLayout,
} from './geometry'
import { fitText, textWidth } from './helvetica'

const entry = (status: DutyStatus, start_min: number, end_min: number): LogEntry => ({
  status,
  kind: 'idle',
  start_min,
  end_min,
  place: 'Somewhere, TX',
  note: '',
})

describe('minuteToX', () => {
  it('maps midnight to the left edge and the next midnight to the right edge', () => {
    expect(minuteToX(0)).toBe(GRID_LEFT)
    expect(minuteToX(1440)).toBe(GRID_RIGHT)
  })

  it('puts noon in the middle and each hour one 24th of the way along', () => {
    expect(minuteToX(720)).toBe(GRID_LEFT + GRID_WIDTH / 2)
    expect(minuteToX(60) - minuteToX(0)).toBeCloseTo(GRID_WIDTH / 24, 10)
    expect(minuteToX(15 * 60) - minuteToX(14 * 60)).toBeCloseTo(GRID_WIDTH / 24, 10)
  })

  it('stays on the grid for minutes outside the day', () => {
    expect(minuteToX(-30)).toBe(GRID_LEFT)
    expect(minuteToX(1500)).toBe(GRID_RIGHT)
  })
})

describe('rowY', () => {
  it('centres each status line in its row, top to bottom', () => {
    const ys = ROW_ORDER.map(rowY)
    expect(ys[0]).toBe(GRID_TOP + ROW_HEIGHT / 2)
    ys.slice(1).forEach((y, i) => expect(y - ys[i]).toBe(ROW_HEIGHT))
    expect(ys[ys.length - 1]).toBeLessThan(GRID_BOTTOM)
  })

  it('orders the rows off duty, sleeper, driving, on duty', () => {
    expect(ROW_ORDER).toEqual(['off_duty', 'sleeper', 'driving', 'on_duty'])
  })
})

describe('buildStatusPath', () => {
  it('draws the short fixture as level runs joined by right-angle connectors', () => {
    expect(buildStatusPath(shortPlan.logs[0].entries)).toBe(
      'M124 364 H340 V452 H383.65 V496 H410.65 V452 H493.45 V496 H520.45 V364 H772',
    )
  })

  it('starts on the left edge and ends on the right edge for every fixture day', () => {
    for (const log of [...shortPlan.logs, ...multiDayPlan.logs]) {
      const runs = statusRuns(log.entries)
      expect(runs).toHaveLength(1)
      expect(runs[0][0]).toEqual({ x: GRID_LEFT, y: rowY(log.entries[0].status) })
      expect(runs[0][runs[0].length - 1]).toEqual({
        x: GRID_RIGHT,
        y: rowY(log.entries[log.entries.length - 1].status),
      })
    }
  })

  it('moves vertically only at the minute a status changes', () => {
    const entries = [
      entry('off_duty', 0, 360),
      entry('driving', 360, 900),
      entry('sleeper', 900, 1440),
    ]
    expect(buildStatusPath(entries)).toBe(
      `M${minuteToX(0)} ${rowY('off_duty')} H${minuteToX(360)} V${rowY('driving')} H${minuteToX(900)} V${rowY('sleeper')} H${minuteToX(1440)}`,
    )
  })

  it('draws two neighbours in the same row as one straight line', () => {
    const entries = [
      entry('driving', 0, 300),
      entry('driving', 300, 700),
      entry('off_duty', 700, 1440),
    ]
    const [run] = statusRuns(entries)
    expect(run.map((point) => point.x)).not.toContain(minuteToX(300))
    expect(run[0].y).toBe(run[1].y)
  })

  it('skips entries with no length', () => {
    const entries = [
      entry('off_duty', 0, 600),
      entry('driving', 600, 600),
      entry('off_duty', 600, 1440),
    ]
    expect(buildStatusPath(entries)).toBe(`M${GRID_LEFT} ${rowY('off_duty')} H${GRID_RIGHT}`)
  })

  it('lifts the pen across a gap instead of drawing through it', () => {
    const entries = [entry('driving', 0, 300), entry('driving', 600, 1440)]
    const path = buildStatusPath(entries)
    expect(path.match(/M/g)).toHaveLength(2)
  })

  it('returns an empty path for a day with no entries', () => {
    expect(buildStatusPath([])).toBe('')
  })
})

describe('formatHours', () => {
  it.each([
    [0, '0'],
    [30, '0.5'],
    [60, '1'],
    [105, '1.75'],
    [270, '4.5'],
    [20, '0.33'],
    [1440, '24'],
  ])('writes %i minutes as %s', (minutes, text) => {
    expect(formatHours(minutes)).toBe(text)
  })
})

describe('formatTotals', () => {
  it('formats the short fixture and totals 24', () => {
    expect(formatTotals(shortPlan.logs[0].totals)).toEqual({
      off_duty: '17.32',
      sleeper: '0',
      driving: '4.68',
      on_duty: '2',
      total: '24',
    })
  })

  it('always shows row values that add up to the shown total', () => {
    let seed = 7
    const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let trial = 0; trial < 500; trial++) {
      const cuts = [next(), next(), next()].map((n) => Math.round(n * 1440)).sort((a, b) => a - b)
      const totals = {
        off_duty: cuts[0],
        sleeper: cuts[1] - cuts[0],
        driving: cuts[2] - cuts[1],
        on_duty: 1440 - cuts[2],
      }
      const shown = formatTotals(totals)
      const sum = ROW_ORDER.reduce(
        (acc, status) => acc + Math.round(Number(shown[status]) * 100),
        0,
      )
      expect(sum).toBe(Math.round(Number(shown.total) * 100))
      expect(shown.total).toBe('24')
    }
  })
})

describe('formatClock', () => {
  it.each([
    [0, '12:00 AM'],
    [5, '12:05 AM'],
    [360, '06:00 AM'],
    [720, '12:00 PM'],
    [765, '12:45 PM'],
    [1439, '11:59 PM'],
    [1440, '12:00 AM'],
  ])('writes minute %i as %s', (minute, text) => {
    expect(formatClock(minute)).toBe(text)
  })
})

describe('text measuring', () => {
  it('measures with Helvetica advance widths', () => {
    // H 722, e 556, l 222, l 222, o 556 per 1000 em.
    expect(textWidth('Hello', 10)).toBeCloseTo(22.78, 5)
    expect(textWidth('', 10)).toBe(0)
  })

  it('leaves text that fits and trims text that does not', () => {
    expect(fitText('Kearney, NE', 8.5, 200)).toBe('Kearney, NE')
    const trimmed = fitText('12 mi SW of Kearney, NE', 8.5, 60)
    expect(trimmed.endsWith('...')).toBe(true)
    expect(textWidth(trimmed, 8.5)).toBeLessThanOrEqual(60)
  })
})

/** Rectangles worked out from the placement fields alone, apart from the layout's own `box`. */
function inkBoxes(layout: RemarkLayout) {
  return layout.placements.map((p) => {
    const width = textWidth(p.label, REMARK_FONT_SIZE)
    const left = p.textAnchor === 'start' ? p.textX : p.textX - width
    return {
      p,
      left,
      right: left + width,
      top: p.baselineY - REMARK_FONT_SIZE * 0.9,
      bottom: p.baselineY + REMARK_FONT_SIZE * 0.25,
    }
  })
}

function expectNoCollisions(layout: RemarkLayout) {
  const boxes = inkBoxes(layout)
  for (const [i, a] of boxes.entries()) {
    // The leader sits beside its own label, never through it.
    expect(a.p.leaderX < a.left || a.p.leaderX > a.right).toBe(true)
    expect(a.p.leaderBottom).toBeGreaterThanOrEqual(a.bottom)
    expect(a.left).toBeGreaterThanOrEqual(REMARK_MIN_X)
    expect(a.right).toBeLessThanOrEqual(REMARK_MAX_X)
    for (const b of boxes.slice(i + 1)) {
      const overlapX = a.left < b.right && b.left < a.right
      const overlapY = a.top < b.bottom && b.top < a.bottom
      expect(overlapX && overlapY, `labels ${a.p.index} and ${b.p.index} overlap`).toBe(false)
    }
    for (const b of boxes) {
      if (a === b) continue
      const crosses =
        a.p.leaderX > b.left - 0.5 &&
        a.p.leaderX < b.right + 0.5 &&
        GRID_BOTTOM < b.bottom &&
        a.p.leaderBottom > b.top
      expect(crosses, `leader ${a.p.index} crosses label ${b.p.index}`).toBe(false)
    }
  }
}

const PLACES = [
  'Nashville, TN',
  'Clarksville, TN',
  '19 mi W of Boonville, MO',
  '11 mi SE of Wamego, KS',
  'St. Louis, MO',
  'Kearney, NE',
  '12 mi SW of Kearney, NE',
  'Denver, CO',
]

const remarksAt = (minutes: number[]): RemarkInput[] =>
  minutes.map((minute, i) => ({ minute, place: PLACES[i % PLACES.length] }))

describe('layoutRemarks', () => {
  it.each([
    ['short', shortPlan.logs],
    ['multi-day', multiDayPlan.logs],
  ])('keeps every label and leader apart on the %s fixture', (_name, logs) => {
    for (const log of logs) expectNoCollisions(layoutRemarks(log.remarks))
  })

  it('gives each remark a placement in input order', () => {
    const remarks = remarksAt([300, 900, 1200])
    const layout = layoutRemarks(remarks)
    expect(layout.placements.map((p) => p.index)).toEqual([0, 1, 2])
    expect(layout.placements.map((p) => p.minute)).toEqual([300, 900, 1200])
    layout.placements.forEach((p) => expect(p.leaderX).toBe(minuteToX(p.minute)))
  })

  it('handles a day with no remarks and a day with one', () => {
    expect(layoutRemarks([])).toMatchObject({ placements: [], laneCount: 0 })
    const one = layoutRemarks(remarksAt([600]))
    expect(one.laneCount).toBe(1)
    expectNoCollisions(one)
  })

  it('keeps 12 remarks apart when they are spread across the day', () => {
    const layout = layoutRemarks(remarksAt(Array.from({ length: 12 }, (_, i) => 60 + i * 115)))
    expectNoCollisions(layout)
    expect(layout.laneCount).toBeLessThanOrEqual(9)
  })

  it('keeps 12 remarks apart when they are bunched into half an hour steps', () => {
    const layout = layoutRemarks(remarksAt(Array.from({ length: 12 }, (_, i) => 480 + i * 30)))
    expectNoCollisions(layout)
  })

  it('keeps remarks apart when two share a minute', () => {
    expectNoCollisions(layoutRemarks(remarksAt([600, 600, 600, 601])))
  })

  it('shortens a name that is wider than the label limit', () => {
    const layout = layoutRemarks([{ minute: 700, place: '12 mi SW of Kearney, NE' }], {
      maxLabelWidth: 40,
    })
    const [placement] = layout.placements
    expect(placement.label.endsWith('...')).toBe(true)
    expect(textWidth(placement.label, REMARK_FONT_SIZE)).toBeLessThanOrEqual(40)
  })

  it('sets a late change with a long name to the left of its leader so the name stays whole', () => {
    const layout = layoutRemarks([{ minute: 1430, place: '12 mi SW of Kearney, NE' }])
    const [placement] = layout.placements
    expectNoCollisions(layout)
    expect(placement.side).toBe('left')
    expect(placement.label).toBe('12 mi SW of Kearney, NE')
  })
  it('keeps full place names when the day is not crowded', () => {
    const layout = layoutRemarks(remarksAt([120, 1300]))
    expect(layout.placements.every((p) => p.label === PLACES[p.index])).toBe(true)
  })

  it('never lets a crowded day collide, whatever the spacing', () => {
    let seed = 11
    const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let trial = 0; trial < 400; trial++) {
      const count = 1 + Math.floor(next() * 14)
      const remarks = Array.from({ length: count }, () => ({
        minute: Math.floor(next() * 1440),
        place: PLACES[Math.floor(next() * PLACES.length)],
      }))
      expectNoCollisions(layoutRemarks(remarks))
    }
  })

  it('is deterministic', () => {
    const remarks = remarksAt([90, 200, 210, 600, 1100, 1300])
    expect(layoutRemarks(remarks)).toEqual(layoutRemarks(remarks))
  })

  it('squeezes the lane spacing when a day needs more lanes than the block holds', () => {
    const roomy = layoutRemarks(remarksAt([300, 900]))
    const packed = layoutRemarks(remarksAt(Array.from({ length: 12 }, (_, i) => 480 + i * 30)))
    expect(packed.lanePitch).toBeLessThanOrEqual(roomy.lanePitch)
  })
})
