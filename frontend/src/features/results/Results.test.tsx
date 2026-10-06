import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlanResponse, Stop } from '@/api/types'
import { makePlan } from '@/test/makePlan'
import { renderWithProviders } from '@/test/render'
import { Results, type ResultsTab } from './Results'

vi.mock('@/features/logs', () => import('@/test/logsMock'))

interface HarnessProps {
  plan?: PlanResponse
  initialTab?: ResultsTab
  onSelectStop?: (id: string) => void
  onSave?: () => void
  saved?: boolean
  saving?: boolean
}

function Harness({
  plan = makePlan(),
  initialTab = 'itinerary',
  onSelectStop = () => {},
  onSave = () => {},
  saved = false,
  saving = false,
}: HarnessProps) {
  const [tab, setTab] = useState<ResultsTab>(initialTab)
  return (
    <Results
      plan={plan}
      tab={tab}
      onTabChange={setTab}
      onSelectStop={onSelectStop}
      saving={saving}
      saved={saved}
      onSave={onSave}
    />
  )
}

function setup(props: HarnessProps = {}) {
  renderWithProviders(<Harness {...props} />)
  return userEvent.setup()
}

// The stylesheet is off in unit tests, so a hidden panel is told apart by its attribute or class.
function shown(testId: string): boolean {
  const panel = screen.getByTestId(testId)
  return !panel.hasAttribute('hidden') && !panel.classList.contains('hidden')
}

function withSummary(patch: Partial<PlanResponse['summary']>): PlanResponse {
  const plan = makePlan()
  return { ...plan, summary: { ...plan.summary, ...patch } }
}

describe('Results header', () => {
  it('names the route and the departure', () => {
    setup()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Dallas to Denver via Memphis' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Leaves Wed, Oct 7, 6:00 AM')).toBeInTheDocument()
  })

  it('takes focus on arrival so keyboard and screen reader users land on the results', () => {
    setup()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Dallas to Denver via Memphis' }),
    ).toHaveFocus()
  })

  it('is a region named by that heading', () => {
    setup()
    expect(screen.getByRole('region', { name: 'Dallas to Denver via Memphis' })).toBeInTheDocument()
  })
})

describe('stats strip', () => {
  it('shows the six figures from a hand-checked summary', () => {
    setup({
      plan: withSummary({
        distance_miles: 1234.6,
        driving_minutes: 270,
        elapsed_minutes: 1500,
        arrive_at: '2026-10-08T07:00:00-05:00',
        days: 2,
        fuel_stops: 3,
        rests: 2,
        breaks: 1,
        restarts: 1,
      }),
    })
    expect(screen.getByTestId('stat-distance')).toHaveTextContent('1,235 mi')
    expect(screen.getByTestId('stat-driving')).toHaveTextContent('4 h 30 min')
    expect(screen.getByTestId('stat-trip-time')).toHaveTextContent('25 h')
    expect(screen.getByTestId('stat-arrival')).toHaveTextContent('7:00 AM')
    expect(screen.getByTestId('stat-arrival')).toHaveTextContent('Thu, Oct 8')
    expect(screen.getByTestId('stat-days')).toHaveTextContent('2')
    expect(screen.getByTestId('stat-fuel')).toHaveTextContent('3')
    expect(screen.getByTestId('stat-fuel')).toHaveTextContent('plus 2 rests, 1 break, 1 restart')
  })

  it('has all six test ids inside the strip', () => {
    setup()
    const strip = screen.getByTestId('stats-strip')
    for (const id of ['distance', 'driving', 'trip-time', 'arrival', 'days', 'fuel']) {
      expect(within(strip).getByTestId(`stat-${id}`)).toBeInTheDocument()
    }
  })

  it('leaves the stop note off when there are no extra stops', () => {
    setup({ plan: withSummary({ rests: 0, breaks: 0, restarts: 0, fuel_stops: 0 }) })
    expect(screen.getByTestId('stat-fuel')).not.toHaveTextContent('plus')
  })
})

describe('warnings', () => {
  it('shows nothing when there are none', () => {
    setup()
    expect(screen.queryByTestId('warnings')).not.toBeInTheDocument()
  })

  it('shows one warning under a short title', () => {
    setup({ plan: { ...makePlan(), warnings: ['A 34-hour restart was added.'] } })
    const banner = screen.getByTestId('warnings')
    expect(banner).toHaveTextContent('Heads up')
    expect(banner).toHaveTextContent('A 34-hour restart was added.')
    expect(banner).toHaveAttribute('role', 'status')
  })

  it('counts several warnings and lists each', () => {
    setup({ plan: { ...makePlan(), warnings: ['One thing.', 'Another thing.'] } })
    const banner = screen.getByTestId('warnings')
    expect(banner).toHaveTextContent('2 things to know')
    expect(within(banner).getAllByRole('listitem')).toHaveLength(2)
  })

  it('shows warning text with markup as plain text', () => {
    setup({ plan: { ...makePlan(), warnings: ['<img src=x onerror=alert(1)>'] } })
    expect(screen.getByTestId('warnings')).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(screen.getByTestId('warnings').querySelector('img')).toBeNull()
  })
})

describe('tabs', () => {
  it('opens on the itinerary', () => {
    setup()
    expect(screen.getByTestId('tab-itinerary')).toHaveAttribute('aria-selected', 'true')
    expect(shown('panel-itinerary')).toBe(true)
    expect(shown('panel-summary')).toBe(false)
    expect(shown('panel-logs')).toBe(false)
  })

  it('wires each tab to its panel', () => {
    setup()
    for (const name of ['itinerary', 'logs', 'summary']) {
      const tab = screen.getByTestId(`tab-${name}`)
      const panel = screen.getByTestId(`panel-${name}`)
      expect(tab).toHaveAttribute('aria-controls', panel.id)
      expect(panel).toHaveAttribute('aria-labelledby', tab.id)
      expect(panel).toHaveAttribute('role', 'tabpanel')
    }
  })

  it('shows the logs panel with the log viewer', async () => {
    const user = setup()
    await user.click(screen.getByTestId('tab-logs'))
    expect(screen.getByTestId('tab-logs')).toHaveAttribute('aria-selected', 'true')
    expect(shown('panel-logs')).toBe(true)
    expect(shown('panel-itinerary')).toBe(false)
    expect(screen.getByTestId('log-viewer')).toHaveTextContent('3 sheets')
    expect(screen.getByTestId('log-viewer')).toHaveAttribute(
      'data-route-title',
      'Dallas to Denver via Memphis',
    )
  })

  it('shows the summary panel', async () => {
    const user = setup()
    await user.click(screen.getByTestId('tab-summary'))
    expect(shown('panel-summary')).toBe(true)
  })

  it('keeps the log viewer mounted on other tabs so print still has the sheets', () => {
    setup()
    expect(screen.getByTestId('log-viewer')).toBeInTheDocument()
  })

  it('moves between tabs with the arrow keys', async () => {
    const user = setup()
    screen.getByTestId('tab-itinerary').focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByTestId('tab-logs')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('tab-logs')).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByTestId('tab-summary')).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByTestId('tab-itinerary')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByTestId('tab-summary')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByTestId('tab-itinerary')).toHaveFocus()
  })

  it('only the selected tab is in the tab order', () => {
    setup()
    expect(screen.getByTestId('tab-itinerary')).toHaveAttribute('tabindex', '0')
    expect(screen.getByTestId('tab-logs')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByTestId('tab-summary')).toHaveAttribute('tabindex', '-1')
  })
})

describe('itinerary', () => {
  const plan = makePlan()
  const byKind = (kind: Stop['kind']) => plan.stops.filter((s) => s.kind === kind)

  it('groups stops under a heading for each log day', () => {
    setup()
    expect(screen.getAllByTestId(/^day-group-/)).toHaveLength(3)
    const day1 = screen.getByTestId('day-group-1')
    expect(within(day1).getByRole('heading', { name: /Day 1/ })).toHaveTextContent(
      'Wednesday, October 7',
    )
    expect(within(screen.getByTestId('day-group-3')).getByRole('heading')).toHaveTextContent(
      'Friday, October 9',
    )
  })

  it('puts every stop on a card, under the day it begins', () => {
    setup()
    for (const stop of plan.stops) {
      const group = screen.getByTestId(`day-group-${stop.day}`)
      expect(within(group).getByTestId(`stop-card-${stop.id}`)).toBeInTheDocument()
    }
    expect(screen.getAllByTestId(/^stop-card-/)).toHaveLength(plan.stops.length)
  })

  it('shows title, place, time range, duration, mile and note on a card', () => {
    setup()
    const pickup = byKind('pickup')[0]
    const card = screen.getByTestId(`stop-card-${pickup.id}`)
    expect(card).toHaveTextContent('Pickup')
    expect(card).toHaveTextContent('Memphis, TN')
    expect(card).toHaveTextContent('1:32 PM to 2:32 PM')
    expect(card).toHaveTextContent('1 h')
    expect(card).toHaveTextContent('Mile 452')
    expect(card).toHaveTextContent('Pickup, loading (1 hr)')
  })

  it('numbers stops like the map markers and leaves the closing stop unnumbered', () => {
    setup()
    expect(within(screen.getByTestId('stop-card-stop-start')).getByText('1')).toBeInTheDocument()
    expect(within(screen.getByTestId('stop-card-stop-2')).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByTestId('stop-card-stop-10')).getByText('6')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('stop-card-stop-end')).queryByText('7'),
    ).not.toBeInTheDocument()
  })

  it('shows the driving between stops', () => {
    setup()
    expect(screen.getByText(/Drive 7 h 32 min . 452 mi/)).toBeInTheDocument()
    expect(screen.getByText(/Drive 3 h 28 min . 208 mi/)).toBeInTheDocument()
  })

  it('summarizes each day of driving', () => {
    setup()
    expect(
      within(screen.getByTestId('day-group-1')).getByText(/Driving 11 h . 660 mi/),
    ).toBeInTheDocument()
  })

  it('tells the reader which zone the times are in', () => {
    setup()
    expect(
      screen.getByText(/Times are home terminal time \(CDT, America\/Chicago\)/),
    ).toBeInTheDocument()
  })

  it('reports a clicked card by stop id', async () => {
    const onSelectStop = vi.fn()
    const user = setup({ onSelectStop })
    await user.click(screen.getByTestId('stop-card-stop-2'))
    expect(onSelectStop).toHaveBeenCalledWith('stop-2')
  })

  it('works from the keyboard', async () => {
    const onSelectStop = vi.fn()
    const user = setup({ onSelectStop })
    screen.getByTestId('stop-card-stop-4').focus()
    await user.keyboard('{Enter}')
    expect(onSelectStop).toHaveBeenCalledWith('stop-4')
  })

  it('shows API text such as a stop note as plain text', () => {
    const base = makePlan()
    const stops = base.stops.map((s) =>
      s.id === 'stop-2' ? { ...s, note: '<b>bold</b><img src=x>' } : s,
    )
    setup({ plan: { ...base, stops } })
    const card = screen.getByTestId('stop-card-stop-2')
    expect(card).toHaveTextContent('<b>bold</b><img src=x>')
    expect(card.querySelector('b, img')).toBeNull()
  })

  it('skips the driving chip when no minutes were driven between stops', () => {
    const base = makePlan()
    setup({ plan: { ...base, segments: base.segments.filter((s) => s.kind !== 'drive') } })
    expect(screen.queryByText(/^Drive \d/)).not.toBeInTheDocument()
  })
})

describe('summary tab', () => {
  async function openSummary(props: HarnessProps = {}) {
    const user = setup(props)
    await user.click(screen.getByTestId('tab-summary'))
  }

  it('shows the cycle at the start and at arrival', async () => {
    await openSummary({
      plan: withSummary({ cycle_used_start_hours: 24, cycle_used_end_hours: 52.5 }),
    })
    const meter = screen.getByTestId('cycle-meter')
    expect(meter).toHaveTextContent('17.5 h left at arrival')
    expect(within(meter).getByText('24 h')).toBeInTheDocument()
    expect(within(meter).getByText('52.5 h')).toBeInTheDocument()
    const gauge = within(meter).getByRole('meter')
    expect(gauge).toHaveAttribute('aria-valuenow', '52.5')
    expect(gauge).toHaveAttribute('aria-valuemax', '70')
    expect(gauge).toHaveAttribute('aria-valuetext', '52.5 of 70 hours used')
  })

  it('caps the meter at 70 and never shows negative hours left', async () => {
    await openSummary({ plan: withSummary({ cycle_used_end_hours: 72 }) })
    const meter = screen.getByTestId('cycle-meter')
    expect(within(meter).getByRole('meter')).toHaveAttribute('aria-valuenow', '70')
    expect(meter).toHaveTextContent('0 h left at arrival')
  })

  it('explains a restart and counts only hours since it', async () => {
    await openSummary({
      plan: withSummary({ restarts: 1, cycle_used_start_hours: 60, cycle_used_end_hours: 12 }),
    })
    const meter = screen.getByTestId('cycle-meter')
    expect(meter).toHaveTextContent('A 34-hour restart reset the cycle during this trip')
    expect(meter).toHaveTextContent('58 h left at arrival')
  })

  it('has no restart note without a restart', async () => {
    await openSummary()
    expect(screen.getByTestId('cycle-meter')).not.toHaveTextContent('34-hour restart')
  })

  it('lists each leg with distance, OSRM time and planner time, and totals them', async () => {
    await openSummary()
    const table = screen.getByRole('table')
    const first = within(within(table).getByRole('row', { name: /Dallas to Memphis/ }))
    expect(first.getByText('452 mi')).toBeInTheDocument()
    expect(first.getByText('6 h 38 min')).toBeInTheDocument()
    expect(first.getByText('7 h 32 min')).toBeInTheDocument()
    const second = within(within(table).getByRole('row', { name: /Memphis to Denver/ }))
    expect(second.getByText('1,040 mi')).toBeInTheDocument()
    expect(second.getByText('15 h 51 min')).toBeInTheDocument()
    expect(second.getByText('17 h 20 min')).toBeInTheDocument()
    const total = within(within(table).getByRole('row', { name: /Total/ }))
    expect(total.getByText('1,492 mi')).toBeInTheDocument()
    expect(total.getByText('22 h 29 min')).toBeInTheDocument()
    expect(total.getByText('24 h 52 min')).toBeInTheDocument()
  })

  it('lists every assumption', async () => {
    const plan = makePlan()
    await openSummary({ plan })
    const list = screen.getByTestId('assumptions')
    for (const line of plan.assumptions) expect(within(list).getByText(line)).toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')).toHaveLength(plan.assumptions.length)
  })
})

describe('actions', () => {
  it('renders the four action buttons', () => {
    setup()
    for (const id of ['btn-share', 'btn-pdf', 'btn-print', 'btn-save']) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
  })

  it('calls onSave', async () => {
    const onSave = vi.fn()
    const user = setup({ onSave })
    await user.click(screen.getByTestId('btn-save'))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
