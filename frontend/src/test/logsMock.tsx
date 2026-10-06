// Stand-in for '@/features/logs' so app-level tests do not depend on the SVG sheet or jsPDF.
// Use it with: vi.mock('@/features/logs', () => import('@/test/logsMock'))
import { vi } from 'vitest'
import type { DailyLog } from '@/api/types'

export function LogViewer({ logs, routeTitle }: { logs: DailyLog[]; routeTitle?: string }) {
  return (
    <div data-testid="log-viewer" data-route-title={routeTitle}>
      {logs.length} sheets
    </div>
  )
}

export const exportLogsToPdf = vi.fn(
  async (_logs: DailyLog[], _filename?: string) =>
    new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
)

export const downloadBlob = vi.fn((_blob: Blob, _filename: string) => {})
