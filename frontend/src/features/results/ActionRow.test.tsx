import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlanResponse } from '@/api/types'
import { downloadBlob, exportLogsToPdf } from '@/features/logs'
import { decodeTrip } from '@/lib/share'
import { makePlan, sampleRequest } from '@/test/makePlan'
import { deferred } from '@/test/mockApi'
import { renderWithProviders } from '@/test/render'
import { ActionRow } from './ActionRow'

vi.mock('@/features/logs', () => import('@/test/logsMock'))

interface Options {
  plan?: PlanResponse
  saving?: boolean
  saved?: boolean
  onSave?: () => void
}

function setup({
  plan = makePlan(),
  saving = false,
  saved = false,
  onSave = () => {},
}: Options = {}) {
  const user = userEvent.setup()
  renderWithProviders(<ActionRow plan={plan} saving={saving} saved={saved} onSave={onSave} />)
  return { user, plan }
}

describe('share link', () => {
  it('copies a link that opens the same trip, and says so', async () => {
    const { user } = setup()
    await user.click(screen.getByTestId('btn-share'))

    const copied = await navigator.clipboard.readText()
    const url = new URL(copied)
    expect(url.origin).toBe(window.location.origin)
    expect(decodeTrip(url.searchParams.get('trip') ?? '')).toEqual(sampleRequest)
    expect(
      await screen.findByText('Link copied. Anyone with it can plan this trip.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('toast')).toBeInTheDocument()
  })

  it('falls back to the address bar when copying is blocked', async () => {
    const { user } = setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.click(screen.getByTestId('btn-share'))

    expect(
      await screen.findByText("Couldn't copy automatically. The link is now in your address bar."),
    ).toBeInTheDocument()
    expect(new URLSearchParams(window.location.search).get('trip')).not.toBeNull()
  })
})

describe('PDF download', () => {
  it('builds the PDF for every log and saves it under a dated name', async () => {
    const { user, plan } = setup()
    await user.click(screen.getByTestId('btn-pdf'))

    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(exportLogsToPdf).toHaveBeenCalledWith(plan.logs, 'eld-logs-2026-10-07.pdf')
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0]
    expect(blob).toBeInstanceOf(Blob)
    expect(filename).toBe('eld-logs-2026-10-07.pdf')
    expect(await screen.findByText('Downloaded 3 log sheets as a PDF.')).toBeInTheDocument()
  })

  it('uses the singular for one sheet', async () => {
    const plan = makePlan()
    const { user } = setup({ plan: { ...plan, logs: plan.logs.slice(0, 1) } })
    await user.click(screen.getByTestId('btn-pdf'))
    expect(await screen.findByText('Downloaded 1 log sheet as a PDF.')).toBeInTheDocument()
  })

  it('shows progress while the file builds', async () => {
    const build = deferred<Blob>()
    vi.mocked(exportLogsToPdf).mockReturnValueOnce(build.promise)
    const { user } = setup()
    await user.click(screen.getByTestId('btn-pdf'))
    expect(screen.getByTestId('btn-pdf')).toBeDisabled()
    expect(screen.getByTestId('btn-pdf')).toHaveAttribute('aria-busy', 'true')
    build.resolve(new Blob(['%PDF-']))
    await waitFor(() => expect(screen.getByTestId('btn-pdf')).toBeEnabled())
  })

  it('reports a failure and offers print instead', async () => {
    vi.mocked(exportLogsToPdf).mockRejectedValueOnce(new Error('boom'))
    const { user } = setup()
    await user.click(screen.getByTestId('btn-pdf'))
    expect(
      await screen.findByText("Couldn't build the PDF. Try again, or use Print."),
    ).toBeInTheDocument()
    expect(downloadBlob).not.toHaveBeenCalled()
    expect(screen.getByTestId('btn-pdf')).toBeEnabled()
  })
})

describe('print', () => {
  it('opens the browser print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { user } = setup()
    await user.click(screen.getByTestId('btn-print'))
    expect(print).toHaveBeenCalledTimes(1)
  })
})

describe('save', () => {
  it('asks the parent to save', async () => {
    const onSave = vi.fn()
    const { user } = setup({ onSave })
    const save = screen.getByTestId('btn-save')
    expect(save).toHaveTextContent('Save trip')
    await user.click(save)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('shows progress while saving', () => {
    setup({ saving: true })
    expect(screen.getByTestId('btn-save')).toBeDisabled()
    expect(screen.getByTestId('btn-save')).toHaveAttribute('aria-busy', 'true')
  })

  it('shows Saved and stops accepting clicks once saved', async () => {
    const onSave = vi.fn()
    const { user } = setup({ saved: true, onSave })
    const save = screen.getByTestId('btn-save')
    expect(save).toHaveTextContent('Saved')
    expect(save).toBeDisabled()
    await user.click(save)
    expect(onSave).not.toHaveBeenCalled()
  })
})

describe('buttons', () => {
  it('each has a visible name', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Share link' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save trip' })).toBeInTheDocument()
  })
})
