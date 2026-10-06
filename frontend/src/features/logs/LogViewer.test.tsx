import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { multiDayPlan, shortPlan } from '@/test/fixtures'
import { downloadBlob } from './download'
import { exportLogsToPdf } from './exportPdf'
import { LogViewer } from './LogViewer'

vi.mock('./exportPdf', () => ({ exportLogsToPdf: vi.fn() }))
vi.mock('./download', () => ({ downloadBlob: vi.fn() }))

const exportMock = vi.mocked(exportLogsToPdf)
const downloadMock = vi.mocked(downloadBlob)
const logs = multiDayPlan.logs

function stubContainerWidth(width: number) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }
      unobserve() {}
      disconnect() {}
    },
  )
}

const shownSheets = () => screen.queryAllByTestId(/^log-sheet-\d+$/)

describe('LogViewer', () => {
  beforeEach(() => {
    exportMock.mockReset()
    downloadMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('showing sheets', () => {
    it('shows one sheet at a time, starting with day 1', () => {
      render(<LogViewer logs={logs} />)

      expect(shownSheets().map((el) => el.getAttribute('data-testid'))).toEqual(['log-sheet-1'])
      expect(screen.getByRole('heading', { name: 'Day 1 of 3' })).toBeInTheDocument()
      expect(screen.getByText('Wednesday, October 7, 2026')).toBeInTheDocument()
    })

    it('labels the viewer with the route when it has one', () => {
      render(<LogViewer logs={logs} routeTitle="Nashville to Denver" />)

      expect(screen.getByTestId('log-viewer')).toHaveAccessibleName(
        'Daily logs for Nashville to Denver',
      )
    })

    it('has a chip for each day with its date, miles and driving hours', () => {
      render(<LogViewer logs={logs} />)

      const chip = screen.getByTestId('day-chip-1')
      expect(chip).toHaveTextContent('Day 1')
      expect(chip).toHaveTextContent('Wed, Oct 7')
      expect(chip).toHaveTextContent('689 mi, 11.5 h driving')
      expect(screen.getAllByRole('tab')).toHaveLength(3)
    })

    it('explains the colours of the day bars', () => {
      render(<LogViewer logs={logs} />)

      const key = screen.getByRole('list', { name: 'Color key for the day bars' })
      expect(
        within(key)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual(['Off Duty', 'Sleeper Berth', 'Driving', 'On Duty (not driving)'])
    })

    it('says so when there are no sheets', () => {
      render(<LogViewer logs={[]} />)

      expect(screen.getByText(/No log sheets yet/)).toBeInTheDocument()
      expect(screen.queryByTestId('btn-pdf-logs')).toBeNull()
    })
  })

  describe('moving between days', () => {
    it('steps forward and back with the arrow buttons', async () => {
      const user = userEvent.setup()
      render(<LogViewer logs={logs} />)

      await user.click(screen.getByTestId('btn-next-day'))
      expect(shownSheets().map((el) => el.getAttribute('data-testid'))).toEqual(['log-sheet-2'])
      expect(screen.getByRole('heading', { name: 'Day 2 of 3' })).toBeInTheDocument()

      await user.click(screen.getByTestId('btn-next-day'))
      expect(screen.getByTestId('log-sheet-3')).toBeInTheDocument()

      await user.click(screen.getByTestId('btn-prev-day'))
      expect(screen.getByTestId('log-sheet-2')).toBeInTheDocument()
    })

    it('disables previous on the first day and next on the last', async () => {
      const user = userEvent.setup()
      render(<LogViewer logs={logs} />)

      expect(screen.getByTestId('btn-prev-day')).toBeDisabled()
      expect(screen.getByTestId('btn-next-day')).toBeEnabled()

      await user.click(screen.getByTestId('day-chip-3'))
      expect(screen.getByTestId('btn-prev-day')).toBeEnabled()
      expect(screen.getByTestId('btn-next-day')).toBeDisabled()
    })

    it('jumps to a day from its chip and marks that chip selected', async () => {
      const user = userEvent.setup()
      render(<LogViewer logs={logs} />)

      await user.click(screen.getByTestId('day-chip-3'))

      expect(screen.getByTestId('log-sheet-3')).toBeInTheDocument()
      expect(screen.getByTestId('day-chip-3')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('day-chip-1')).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/Day 3/)
    })

    it('puts only the selected chip in the tab order', async () => {
      const user = userEvent.setup()
      render(<LogViewer logs={logs} />)

      expect(screen.getByTestId('day-chip-1')).toHaveAttribute('tabindex', '0')
      expect(screen.getByTestId('day-chip-2')).toHaveAttribute('tabindex', '-1')

      await user.click(screen.getByTestId('day-chip-2'))
      expect(screen.getByTestId('day-chip-2')).toHaveAttribute('tabindex', '0')
      expect(screen.getByTestId('day-chip-1')).toHaveAttribute('tabindex', '-1')
    })

    it('moves with the arrow keys, Home and End, and carries focus along', async () => {
      const user = userEvent.setup()
      render(<LogViewer logs={logs} />)

      await user.click(screen.getByTestId('day-chip-1'))
      await user.keyboard('{ArrowRight}')
      expect(screen.getByTestId('log-sheet-2')).toBeInTheDocument()
      expect(screen.getByTestId('day-chip-2')).toHaveFocus()

      await user.keyboard('{End}')
      expect(screen.getByTestId('log-sheet-3')).toBeInTheDocument()
      expect(screen.getByTestId('day-chip-3')).toHaveFocus()

      await user.keyboard('{ArrowRight}')
      expect(screen.getByTestId('log-sheet-1')).toBeInTheDocument()
      expect(screen.getByTestId('day-chip-1')).toHaveFocus()

      await user.keyboard('{ArrowLeft}')
      expect(screen.getByTestId('log-sheet-3')).toBeInTheDocument()

      await user.keyboard('{Home}')
      expect(screen.getByTestId('log-sheet-1')).toBeInTheDocument()
    })

    it('can be driven from the keyboard alone', async () => {
      const user = userEvent.setup()
      render(<LogViewer logs={logs} />)

      await user.tab()
      expect(screen.getByTestId('btn-prev-day')).toBeDisabled()
      expect(screen.getByTestId('btn-next-day')).toHaveFocus()

      await user.keyboard('{Enter}')
      expect(screen.getByTestId('log-sheet-2')).toBeInTheDocument()
    })

    it('announces the new day to screen readers', async () => {
      const user = userEvent.setup()
      render(<LogViewer logs={logs} />)

      expect(screen.getByRole('status')).toBeEmptyDOMElement()
      await user.click(screen.getByTestId('btn-next-day'))

      expect(screen.getByRole('status')).toHaveTextContent(
        'Day 2 of 3, Thursday, October 8, 2026. 420 miles driven.',
      )
    })

    it('has nothing to step through on a one-day trip', () => {
      render(<LogViewer logs={shortPlan.logs} />)

      expect(screen.getByRole('heading', { name: 'Day 1 of 1' })).toBeInTheDocument()
      expect(screen.getByTestId('btn-prev-day')).toBeDisabled()
      expect(screen.getByTestId('btn-next-day')).toBeDisabled()
      expect(screen.getAllByRole('tab')).toHaveLength(1)
    })

    it('starts over on day 1 when a new plan arrives', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<LogViewer logs={logs} />)
      await user.click(screen.getByTestId('day-chip-3'))

      rerender(<LogViewer logs={[...logs]} />)

      expect(screen.getByTestId('log-sheet-1')).toBeInTheDocument()
    })

    it('copes with a plan that has fewer days than the one before', async () => {
      const user = userEvent.setup()
      const { rerender } = render(<LogViewer logs={logs} />)
      await user.click(screen.getByTestId('day-chip-3'))

      rerender(<LogViewer logs={shortPlan.logs} />)

      expect(screen.getByTestId('log-sheet-1')).toBeInTheDocument()
      expect(screen.queryByTestId('day-chip-3')).toBeNull()
    })
  })

  describe('print copies', () => {
    it('keeps every sheet in the print root, out of the accessibility tree', () => {
      render(<LogViewer logs={logs} />)
      const root = screen.getByTestId('log-print-root')

      expect(root).toHaveAttribute('id', 'log-print-root')
      expect(root).toHaveAttribute('aria-hidden', 'true')
      expect(root).toHaveClass('log-print-root')
      expect(within(root).getAllByTestId(/^log-print-sheet-\d+$/)).toHaveLength(3)
      expect(root.querySelectorAll('.log-print-page')).toHaveLength(3)
    })

    it('keeps the print copies out of the on-screen sheet count and gives them their own ids', () => {
      render(<LogViewer logs={logs} />)
      const ids = [...document.querySelectorAll('[id]')].map((el) => el.id)

      expect(shownSheets()).toHaveLength(1)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('still holds every sheet while another day is on screen', async () => {
      const user = userEvent.setup()
      render(<LogViewer logs={logs} />)
      await user.click(screen.getByTestId('btn-next-day'))

      expect(
        within(screen.getByTestId('log-print-root')).getAllByTestId(/^log-print-sheet-/),
      ).toHaveLength(3)
    })

    it('opens the print dialog from the Print button', async () => {
      const user = userEvent.setup()
      const print = vi.spyOn(window, 'print').mockImplementation(() => {})
      render(<LogViewer logs={logs} />)

      await user.click(screen.getByTestId('btn-print-logs'))

      expect(print).toHaveBeenCalledTimes(1)
    })
  })

  describe('PDF download', () => {
    it('builds the PDF from every log and saves it under a dated name', async () => {
      const user = userEvent.setup()
      const blob = new Blob(['%PDF-1.3'], { type: 'application/pdf' })
      exportMock.mockResolvedValue(blob)
      render(<LogViewer logs={logs} />)

      await user.click(screen.getByTestId('btn-pdf-logs'))

      expect(exportMock).toHaveBeenCalledWith(logs, 'eld-logs-2026-10-07.pdf')
      expect(downloadMock).toHaveBeenCalledWith(blob, 'eld-logs-2026-10-07.pdf')
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('shows a busy button while the file is built', async () => {
      const user = userEvent.setup()
      let finish: (blob: Blob) => void = () => {}
      exportMock.mockReturnValue(new Promise<Blob>((resolve) => (finish = resolve)))
      render(<LogViewer logs={logs} />)

      await user.click(screen.getByTestId('btn-pdf-logs'))
      expect(screen.getByTestId('btn-pdf-logs')).toBeDisabled()
      expect(screen.getByTestId('btn-pdf-logs')).toHaveAttribute('aria-busy', 'true')

      await act(async () => finish(new Blob(['x'])))
      expect(screen.getByTestId('btn-pdf-logs')).toBeEnabled()
      expect(downloadMock).toHaveBeenCalledTimes(1)
    })

    it('says what went wrong and lets the driver try again', async () => {
      const user = userEvent.setup()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      exportMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(new Blob(['ok']))
      render(<LogViewer logs={logs} />)

      await user.click(screen.getByTestId('btn-pdf-logs'))
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Couldn't build the PDF. Try again, or use Print.",
      )
      expect(downloadMock).not.toHaveBeenCalled()
      expect(screen.getByTestId('btn-pdf-logs')).toBeEnabled()

      await user.click(screen.getByTestId('btn-pdf-logs'))
      expect(downloadMock).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('scaling', () => {
    it('falls back to the container width when the browser reports no size', () => {
      render(<LogViewer logs={logs} />)
      const wrapper = screen.getByTestId('log-sheet-1').parentElement!

      expect(wrapper).toHaveStyle({ width: '100%' })
      expect(screen.queryByText(/shrunk to fit/)).toBeNull()
    })

    it('sizes the sheet to the container and tells small screens how to read it', () => {
      stubContainerWidth(400)
      render(<LogViewer logs={logs} />)
      const wrapper = screen.getByTestId('log-sheet-1').parentElement!

      expect(wrapper).toHaveStyle({ width: '400px' })
      expect(wrapper).toHaveAttribute('data-scale', '0.47')
      expect(screen.getByText(/shrunk to fit your screen/)).toBeInTheDocument()
    })

    it('stops growing at 960 pixels', () => {
      stubContainerWidth(1400)
      render(<LogViewer logs={logs} />)
      const wrapper = screen.getByTestId('log-sheet-1').parentElement!

      expect(wrapper).toHaveStyle({ width: '960px' })
      expect(screen.queryByText(/shrunk to fit/)).toBeNull()
    })
  })
})
