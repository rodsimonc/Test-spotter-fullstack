import { useEffect, useRef } from 'react'
import { CalendarClock, FileText, ListOrdered, Milestone, Route } from 'lucide-react'
import clsx from 'clsx'
import type { PlanResponse } from '@/api/types'
import { panelId, tabId } from '@/components/ui/tabIds'
import { Tabs, type TabItem } from '@/components/ui/Tabs'
import { LogViewer } from '@/features/logs'
import { routeTitle } from '@/lib/format'
import { formatDateTime } from '@/lib/time'
import type { MapPoint } from '@/features/map/TripMap'
import { ActionRow } from './ActionRow'
import { Directions } from './Directions'
import { Itinerary } from './Itinerary'
import { WarningsBanner } from './ResultStates'
import { StatsStrip } from './StatsStrip'
import { SummaryPanel } from './SummaryPanel'

export type ResultsTab = 'itinerary' | 'directions' | 'logs' | 'summary'

const ID_BASE = 'results'

const TABS: TabItem<ResultsTab>[] = [
  {
    id: 'itinerary',
    label: 'Itinerary',
    testId: 'tab-itinerary',
    icon: <ListOrdered aria-hidden="true" className="size-4" />,
  },
  {
    id: 'directions',
    label: 'Directions',
    testId: 'tab-directions',
    icon: <Milestone aria-hidden="true" className="size-4" />,
  },
  {
    id: 'logs',
    label: 'Daily logs',
    testId: 'tab-logs',
    icon: <FileText aria-hidden="true" className="size-4" />,
  },
  {
    id: 'summary',
    label: 'Summary',
    testId: 'tab-summary',
    icon: <Route aria-hidden="true" className="size-4" />,
  },
]

interface ResultsProps {
  plan: PlanResponse
  tab: ResultsTab
  onTabChange: (tab: ResultsTab) => void
  onSelectStop: (id: string) => void
  onSelectPoint: (point: MapPoint) => void
  saving: boolean
  saved: boolean
  onSave: () => void
}

export function Results({
  plan,
  tab,
  onTabChange,
  onSelectStop,
  onSelectPoint,
  saving,
  saved,
  onSave,
}: ResultsProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  // New results are the answer to what the person just asked, so focus goes to them. Without
  // this, a keyboard or screen reader user stays on the Plan button and hears nothing change.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <section
      aria-labelledby="results-title"
      className="animate-rise-in rounded-3xl bg-white p-4 shadow-[var(--shadow-card)] ring-1 ring-ink-200 sm:p-6 print:p-0 print:shadow-none print:ring-0"
    >
      <div className="flex flex-col gap-4 print:hidden lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2
            ref={headingRef}
            id="results-title"
            tabIndex={-1}
            className="text-xl font-bold text-teal-950"
          >
            {routeTitle(plan.request)}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-600">
            <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-teal-700" />
            Leaves {formatDateTime(plan.summary.depart_at)}
          </p>
        </div>
        <ActionRow plan={plan} saving={saving} saved={saved} onSave={onSave} />
      </div>

      <div className="mt-5 space-y-4 print:hidden">
        <StatsStrip summary={plan.summary} />
        <WarningsBanner warnings={plan.warnings} />
      </div>

      <div className="mt-6 print:mt-0">
        <div className="print:hidden">
          <Tabs
            tabs={TABS}
            value={tab}
            onChange={onTabChange}
            idBase={ID_BASE}
            label="Trip results"
          />
        </div>

        <div
          role="tabpanel"
          id={panelId(ID_BASE, 'itinerary')}
          aria-labelledby={tabId(ID_BASE, 'itinerary')}
          data-testid="panel-itinerary"
          hidden={tab !== 'itinerary'}
          tabIndex={0}
          className="pt-5 print:hidden"
        >
          <Itinerary plan={plan} onSelectStop={onSelectStop} />
        </div>

        <div
          role="tabpanel"
          id={panelId(ID_BASE, 'directions')}
          aria-labelledby={tabId(ID_BASE, 'directions')}
          data-testid="panel-directions"
          hidden={tab !== 'directions'}
          tabIndex={0}
          className="pt-5 print:hidden"
        >
          <Directions directions={plan.directions} onSelectPoint={onSelectPoint} />
        </div>

        {/* Stays mounted on every tab so the print sheets exist whichever tab is showing. */}
        <div
          role="tabpanel"
          id={panelId(ID_BASE, 'logs')}
          aria-labelledby={tabId(ID_BASE, 'logs')}
          data-testid="panel-logs"
          tabIndex={0}
          className={clsx('pt-5 print:block print:pt-0', tab !== 'logs' && 'hidden')}
        >
          <LogViewer logs={plan.logs} routeTitle={routeTitle(plan.request)} />
        </div>

        <div
          role="tabpanel"
          id={panelId(ID_BASE, 'summary')}
          aria-labelledby={tabId(ID_BASE, 'summary')}
          data-testid="panel-summary"
          hidden={tab !== 'summary'}
          tabIndex={0}
          className="pt-5 print:hidden"
        >
          <SummaryPanel plan={plan} />
        </div>
      </div>
    </section>
  )
}
