import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DailyLog } from '@/api/types'
import { EMPTY_HEADER } from '@/api/types'
import { multiDayPlan, shortPlan } from '@/test/fixtures'
import { describeLog, wholeMiles } from './describe'
import {
  FONT_FAMILY,
  GRID_LEFT,
  GRID_RIGHT,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  buildStatusPath,
  formatClock,
  formatHours,
  formatTotals,
  layoutRemarks,
  minuteToX,
  rowY,
} from './geometry'
import { LogSheet } from './LogSheet'

const allLogs: [string, DailyLog][] = [
  ...shortPlan.logs.map((log): [string, DailyLog] => [`short, day ${log.day}`, log]),
  ...multiDayPlan.logs.map((log): [string, DailyLog] => [`multi-day, day ${log.day}`, log]),
]

const text = (id: string) => screen.getByTestId(id).textContent

describe('LogSheet', () => {
  it('draws a US Letter page with the form geometry in its viewBox', () => {
    render(<LogSheet log={shortPlan.logs[0]} />)
    const svg = screen.getByTestId('log-sheet-1')

    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg).toHaveAttribute('viewBox', `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`)
    expect(VIEW_WIDTH / VIEW_HEIGHT).toBeCloseTo(8.5 / 11, 3)
  })

  it('names the day for screen readers with a title and a description', () => {
    const log = shortPlan.logs[0]
    render(<LogSheet log={log} />)
    const svg = screen.getByTestId('log-sheet-1')
    const { title, desc } = describeLog(log)

    expect(svg).toHaveAttribute('role', 'img')
    expect(svg.querySelector('title')).toHaveTextContent(title)
    expect(svg.querySelector('desc')).toHaveTextContent(desc)
    expect(screen.getByRole('img', { name: new RegExp(title) })).toBe(svg)
    expect(svg.getAttribute('aria-labelledby')).toBe(
      `${svg.querySelector('title')!.id} ${svg.querySelector('desc')!.id}`,
    )
  })

  it('gives each sheet on a page its own ids', () => {
    render(
      <>
        <LogSheet log={multiDayPlan.logs[0]} idPrefix="a" testId="first" />
        <LogSheet log={multiDayPlan.logs[1]} idPrefix="b" testId="second" />
      </>,
    )
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(screen.getByTestId('first')).toBeInTheDocument()
    expect(screen.getByTestId('second')).toBeInTheDocument()
  })

  it('uses only Helvetica, with no images and no external references', () => {
    render(<LogSheet log={multiDayPlan.logs[0]} />)
    const svg = screen.getByTestId('log-sheet-1')

    expect(FONT_FAMILY).toBe('Helvetica, Arial, sans-serif')
    expect(svg).toHaveAttribute('font-family', FONT_FAMILY)
    expect(svg.querySelectorAll('[font-family]')).toHaveLength(0)
    expect(svg.querySelectorAll('image, foreignObject, use, style, script')).toHaveLength(0)
    expect(svg.outerHTML).not.toMatch(/https?:\/\/(?!www\.w3\.org)/)
  })

  describe.each(allLogs)('%s', (_name, log) => {
    it('draws the status line from the entries', () => {
      render(<LogSheet log={log} />)
      const line = screen.getByTestId('log-status-line')

      expect(line.getAttribute('d')).toBe(buildStatusPath(log.entries))
      expect(line).toHaveAttribute('stroke-linecap', 'round')
      expect(line).toHaveAttribute('stroke-width', '2.5')
      expect(
        line.getAttribute('d')!.startsWith(`M${GRID_LEFT} ${rowY(log.entries[0].status)}`),
      ).toBe(true)
      expect(line.getAttribute('d')!.endsWith(`H${GRID_RIGHT}`)).toBe(true)
    })

    it('prints the hours for each row and a grand total of 24', () => {
      render(<LogSheet log={log} />)
      const hours = formatTotals(log.totals)

      expect(text('log-total-off_duty')).toBe(hours.off_duty)
      expect(text('log-total-sleeper')).toBe(hours.sleeper)
      expect(text('log-total-driving')).toBe(hours.driving)
      expect(text('log-total-on_duty')).toBe(hours.on_duty)
      expect(text('log-total-all')).toBe('24')
    })

    it('fills in the date, places and miles', () => {
      render(<LogSheet log={log} />)
      const [year, month, day] = log.date.split('-').map(Number)

      expect(text('log-month')).toBe(String(month))
      expect(text('log-day')).toBe(String(day))
      expect(text('log-year')).toBe(String(year))
      expect(text('log-from')).toBe(log.from_place)
      expect(text('log-to')).toBe(log.to_place)
      expect(text('log-miles-driving')).toBe(wholeMiles(log.total_miles_driving))
      expect(text('log-mileage-today')).toBe(wholeMiles(log.total_mileage_today))
      expect(text('log-vehicle')).toBe(log.vehicle)
    })

    it('fills in the recap with decimal hours', () => {
      render(<LogSheet log={log} />)

      expect(text('log-recap-today')).toBe(formatHours(log.recap.on_duty_today_minutes))
      expect(text('log-recap-a')).toBe(formatHours(log.recap.a_minutes))
      expect(text('log-recap-b')).toBe(formatHours(log.recap.b_minutes))
      expect(text('log-recap-c')).toBe(formatHours(log.recap.c_minutes))
    })

    it('notes a finished restart only on the day it finished', () => {
      render(<LogSheet log={log} />)

      if (log.recap.restart_completed) {
        expect(text('log-restart-note')).toBe('34-hour restart completed today')
      } else {
        expect(screen.queryByTestId('log-restart-note')).toBeNull()
      }
    })

    it('lists every status change with a 12-hour time, place and note', () => {
      render(<LogSheet log={log} />)
      const rows = within(screen.getByTestId('log-remark-list')).getAllByTestId(/^log-remark-row-/)

      expect(rows).toHaveLength(log.remarks.length)
      log.remarks.forEach((remark, i) => {
        expect(rows[i]).toHaveTextContent(`${i + 1}.`)
        expect(rows[i]).toHaveTextContent(formatClock(remark.minute))
        expect(rows[i]).toHaveTextContent(remark.place)
      })
    })

    it('hangs one leader and label from each status change, joined to the grid', () => {
      render(<LogSheet log={log} />)
      const layout = layoutRemarks(log.remarks)
      const leaders = screen.getByTestId('log-remark-leaders')

      expect(within(leaders).getAllByTestId(/^log-remark-\d+$/)).toHaveLength(log.remarks.length)
      layout.placements.forEach((placement) => {
        const group = screen.getByTestId(`log-remark-${placement.index}`)
        expect(group).toHaveTextContent(placement.label)
        expect(group.querySelector('line')).toHaveAttribute(
          'x1',
          String(minuteToX(placement.minute)),
        )
      })
    })
  })

  it('prints the printed wording of the form', () => {
    render(<LogSheet log={shortPlan.logs[0]} />)
    const svg = screen.getByTestId('log-sheet-1')

    for (const words of [
      'Drivers Daily Log',
      '(24 hours)',
      'Original - File at home terminal.',
      'Total Miles Driving Today',
      'Total Mileage Today',
      '1. Off Duty',
      '3. Driving',
      'Remarks',
      'Shipping Documents:',
      'I certify that these entries are true and correct.',
      'signature in full',
      'Recap:',
      '70 Hour/',
      '60 Hour/',
      '*If you took 34',
    ]) {
      expect(svg).toHaveTextContent(words)
    }
    expect(svg).toHaveTextContent('Noon')
    expect(svg).toHaveTextContent('Mid-')
  })

  it('leaves the driver signature line blank for the driver to sign', () => {
    render(<LogSheet log={multiDayPlan.logs[0]} />)
    const line = screen.getByTestId('log-signature')
    expect(line).toBeInTheDocument()
    expect(line).not.toHaveTextContent(/S/)
  })

  it('fills only the 70-hour side of the recap', () => {
    render(<LogSheet log={multiDayPlan.logs[0]} />)
    const svg = screen.getByTestId('log-sheet-1')

    expect(svg.querySelectorAll('[data-testid^="log-recap-"]')).toHaveLength(4)
  })

  it('fills the header from the log, and leaves blank lines blank', () => {
    const log: DailyLog = {
      ...shortPlan.logs[0],
      header: {
        ...EMPTY_HEADER,
        driver_name: 'Dana Rivera',
        carrier_name: 'Prairie Line Freight LLC',
      },
    }
    render(<LogSheet log={log} />)

    expect(text('log-driver')).toBe('Dana Rivera')
    expect(text('log-carrier')).toBe('Prairie Line Freight LLC')
    for (const id of [
      'log-co-driver',
      'log-main-office',
      'log-home-terminal',
      'log-doc-no',
      'log-shipper',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
  })

  it('joins shipper and commodity on one line', () => {
    const header = { ...EMPTY_HEADER, shipper: 'Harlan Foods', commodity: 'Palletized food' }
    render(<LogSheet log={{ ...shortPlan.logs[0], header }} />)

    expect(text('log-shipper')).toBe('Harlan Foods - Palletized food')
  })

  it('shortens text that is too long for its line', () => {
    const header = { ...EMPTY_HEADER, carrier_name: 'A very long carrier name '.repeat(8) }
    render(<LogSheet log={{ ...shortPlan.logs[0], header }} />)

    expect(text('log-carrier')!.endsWith('...')).toBe(true)
    expect(text('log-carrier')!.length).toBeLessThan(80)
  })

  it('leaves the date lines empty when the date cannot be read', () => {
    render(<LogSheet log={{ ...shortPlan.logs[0], date: 'unknown' }} />)

    expect(screen.queryByTestId('log-month')).toBeNull()
    expect(screen.getByTestId('log-sheet-1')).toBeInTheDocument()
  })

  it('draws a quiet day with no remarks', () => {
    const log: DailyLog = {
      ...shortPlan.logs[0],
      entries: [
        {
          status: 'off_duty',
          kind: 'idle',
          start_min: 0,
          end_min: 1440,
          place: 'Dallas, TX',
          note: 'Off duty',
        },
      ],
      remarks: [],
      totals: { off_duty: 1440, sleeper: 0, driving: 0, on_duty: 0 },
      total_miles_driving: 0,
      total_mileage_today: 0,
    }
    render(<LogSheet log={log} />)

    expect(text('log-total-off_duty')).toBe('24')
    expect(text('log-miles-driving')).toBe('0')
    expect(screen.getByTestId('log-status-line')).toHaveAttribute(
      'd',
      `M${GRID_LEFT} ${rowY('off_duty')} H${GRID_RIGHT}`,
    )
  })

  it('keeps its structure steady', () => {
    render(<LogSheet log={multiDayPlan.logs[0]} />)
    const svg = screen.getByTestId('log-sheet-1')
    const tags = new Map<string, number>()
    svg.querySelectorAll('*').forEach((el) => tags.set(el.tagName, (tags.get(el.tagName) ?? 0) + 1))
    const outline = {
      elements: Object.fromEntries([...tags].sort(([a], [b]) => a.localeCompare(b))),
      testIds: [...svg.querySelectorAll('[data-testid]')].map((el) =>
        el.getAttribute('data-testid'),
      ),
    }

    expect(outline).toMatchSnapshot()
  })
})
