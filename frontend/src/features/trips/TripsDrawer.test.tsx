import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Trip, TripSummary } from '@/api/types'
import { makeTrip, makeTripSummary } from '@/test/makePlan'
import { apiError, deferred, installApi, type Handler } from '@/test/mockApi'
import { renderWithProviders } from '@/test/render'
import { TripsDrawer } from './TripsDrawer'

const A = makeTripSummary({ id: 'aaaa', title: 'Dallas to Denver', days: 3, distance_miles: 1492 })
const B = makeTripSummary({
  id: 'bbbb',
  title: 'Short hop',
  days: 1,
  distance_miles: 212,
  current_label: 'Austin, Texas, United States',
  pickup_label: 'Waco, Texas, United States',
  dropoff_label: 'Dallas, Texas, United States',
})

function listReply(rows: TripSummary[]): Handler {
  return { body: { results: rows, count: rows.length } }
}

interface SetupOptions {
  routes?: Record<string, Handler>
  onClose?: () => void
  onOpenTrip?: (trip: Trip) => void
}

function setup({ routes = {}, onClose = () => {}, onOpenTrip = () => {} }: SetupOptions = {}) {
  const mock = installApi({
    'GET /api/auth/csrf': { body: { csrf: 'test-csrf' } },
    'GET /api/trips': listReply([A, B]),
    ...routes,
  })
  renderWithProviders(<TripsDrawer onClose={onClose} onOpenTrip={onOpenTrip} />)
  return { mock, user: userEvent.setup() }
}

const row = (id: string) => screen.findByTestId(`trip-row-${id}`)

describe('TripsDrawer', () => {
  describe('shell', () => {
    it('is a labelled dialog with focus on its close button', async () => {
      setup()
      const drawer = screen.getByTestId('trips-drawer')
      expect(drawer).toHaveAttribute('role', 'dialog')
      expect(drawer).toHaveAccessibleName('My trips')
      expect(screen.getByTestId('btn-close-trips')).toHaveFocus()
      await row('aaaa')
    })

    it('closes with the button and with Escape', async () => {
      const onClose = vi.fn()
      const { user } = setup({ onClose })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-close-trips'))
      expect(onClose).toHaveBeenCalledTimes(1)
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(2)
    })
  })

  describe('loading', () => {
    it('shows a labelled skeleton while the list loads', async () => {
      const pending = deferred<{ body: unknown }>()
      setup({ routes: { 'GET /api/trips': () => pending.promise } })
      const skeleton = screen.getByRole('status', { name: 'Loading your trips' })
      expect(skeleton).toHaveAttribute('aria-busy', 'true')
      pending.resolve({ body: { results: [A], count: 1 } })
      await row('aaaa')
      expect(screen.queryByRole('status', { name: 'Loading your trips' })).not.toBeInTheDocument()
    })
  })

  describe('empty', () => {
    it('explains how a trip gets here', async () => {
      setup({ routes: { 'GET /api/trips': listReply([]) } })
      const empty = await screen.findByTestId('trips-empty')
      expect(empty).toHaveTextContent('No saved trips yet')
      expect(empty).toHaveTextContent('Plan a trip, then press Save trip.')
      expect(screen.queryByText(/saved, newest first/)).not.toBeInTheDocument()
    })
  })

  describe('error', () => {
    it('shows the reason and retries', async () => {
      const calls = { n: 0 }
      const { user } = setup({
        routes: {
          'GET /api/trips': () =>
            ++calls.n === 1
              ? apiError(502, 'upstream_error', 'The server is busy.')
              : { body: { results: [A], count: 1 } },
        },
      })
      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent("We couldn't load your trips")
      expect(alert).toHaveTextContent('The server is busy.')

      await user.click(screen.getByTestId('btn-retry-trips'))
      await row('aaaa')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('uses a plain fallback when the error has no message of its own', async () => {
      setup({ routes: { 'GET /api/trips': { networkError: true } } })
      expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the server")
    })
  })

  describe('list', () => {
    it('shows each trip with its route, distance, days and age', async () => {
      setup()
      const first = await row('aaaa')
      expect(within(first).getByRole('heading', { name: 'Dallas to Denver' })).toBeInTheDocument()
      expect(first).toHaveTextContent('Dallas')
      expect(first).toHaveTextContent('Memphis')
      expect(first).toHaveTextContent('Denver')
      expect(first).toHaveTextContent('1,492 mi')
      expect(first).toHaveTextContent('3 days')
      expect(first).toHaveTextContent(/Saved .+/)
      expect(screen.getByText('2 saved, newest first')).toBeInTheDocument()
    })

    it('uses the singular for one day', async () => {
      setup()
      expect(await row('bbbb')).toHaveTextContent('1 day')
      expect(screen.getByTestId('trip-row-bbbb')).not.toHaveTextContent('1 days')
    })

    it('renders a title with markup as plain text', async () => {
      const hostile = makeTripSummary({ id: 'cccc', title: '<img src=x onerror=alert(1)>Run' })
      setup({ routes: { 'GET /api/trips': listReply([hostile]) } })
      const item = await row('cccc')
      expect(item).toHaveTextContent('<img src=x onerror=alert(1)>Run')
      expect(item.querySelector('img')).toBeNull()
      expect(document.querySelector('img')).toBeNull()
    })
  })

  describe('opening a trip', () => {
    it('loads the full trip and hands it over', async () => {
      const trip = makeTrip({ id: 'aaaa', title: 'Dallas to Denver' })
      const onOpenTrip = vi.fn()
      const { mock, user } = setup({
        routes: { 'GET /api/trips/aaaa': { body: trip } },
        onOpenTrip,
      })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-open-trip-aaaa'))
      await waitFor(() => expect(onOpenTrip).toHaveBeenCalledTimes(1))
      expect((onOpenTrip.mock.calls[0][0] as Trip).id).toBe('aaaa')
      expect(mock.callsTo('GET /api/trips/aaaa')).toHaveLength(1)
    })

    it('shows progress on that row and holds the others back', async () => {
      const pending = deferred<{ body: unknown }>()
      const { user } = setup({ routes: { 'GET /api/trips/aaaa': () => pending.promise } })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-open-trip-aaaa'))
      expect(screen.getByTestId('btn-open-trip-aaaa')).toHaveAttribute('aria-busy', 'true')
      expect(screen.getByTestId('btn-open-trip-bbbb')).toBeDisabled()
      pending.resolve({ body: makeTrip({ id: 'aaaa' }) })
    })

    it('reports a failure and lets the person try again', async () => {
      const onOpenTrip = vi.fn()
      const { user } = setup({
        routes: { 'GET /api/trips/aaaa': apiError(404, 'not_found', 'That trip is gone.') },
        onOpenTrip,
      })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-open-trip-aaaa'))
      expect(await screen.findByText('That trip is gone.')).toBeInTheDocument()
      expect(onOpenTrip).not.toHaveBeenCalled()
      expect(screen.getByTestId('btn-open-trip-aaaa')).toBeEnabled()
      expect(screen.getByTestId('btn-open-trip-bbbb')).toBeEnabled()
    })
  })

  describe('renaming', () => {
    it('opens an input with the title selected and saves on Enter', async () => {
      const { mock, user } = setup({
        routes: {
          'PATCH /api/trips/aaaa': (call) => ({
            body: makeTrip({ id: 'aaaa', title: (call.body as { title: string }).title }),
          }),
        },
      })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-rename-trip-aaaa'))
      const input = screen.getByTestId('input-rename-trip-aaaa') as HTMLInputElement
      expect(input).toHaveFocus()
      expect(input).toHaveValue('Dallas to Denver')
      expect(input.selectionStart).toBe(0)
      expect(input.selectionEnd).toBe('Dallas to Denver'.length)

      await user.keyboard('Hauling to Denver{Enter}')
      await screen.findByText('Trip renamed.')
      const [call] = mock.callsTo('PATCH /api/trips/aaaa')
      expect(call.body).toEqual({ title: 'Hauling to Denver' })
      expect(call.headers.get('X-CSRFToken')).toBe('test-csrf')
      expect(screen.queryByTestId('input-rename-trip-aaaa')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Hauling to Denver' })).toBeInTheDocument()
    })

    it('saves with the check button', async () => {
      const { mock, user } = setup({
        routes: { 'PATCH /api/trips/aaaa': { body: makeTrip({ id: 'aaaa', title: 'New' }) } },
      })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-rename-trip-aaaa'))
      await user.clear(screen.getByTestId('input-rename-trip-aaaa'))
      await user.type(screen.getByTestId('input-rename-trip-aaaa'), '  New ')
      await user.click(screen.getByRole('button', { name: 'Save name' }))
      await waitFor(() => expect(mock.callsTo('PATCH /api/trips/aaaa')).toHaveLength(1))
      expect(mock.callsTo('PATCH /api/trips/aaaa')[0].body).toEqual({ title: 'New' })
    })

    it('cancels with Escape without closing the drawer or sending anything', async () => {
      const onClose = vi.fn()
      const { mock, user } = setup({ onClose })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-rename-trip-aaaa'))
      await user.keyboard('Changed{Escape}')
      expect(screen.queryByTestId('input-rename-trip-aaaa')).not.toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByTestId('trips-drawer')).toBeInTheDocument()
      expect(mock.callsTo('PATCH /api/trips/aaaa')).toHaveLength(0)
      expect(screen.getByRole('heading', { name: 'Dallas to Denver' })).toBeInTheDocument()
    })

    it('cancels with the cancel button', async () => {
      const { user } = setup()
      await row('aaaa')
      await user.click(screen.getByTestId('btn-rename-trip-aaaa'))
      await user.click(screen.getByRole('button', { name: 'Cancel rename' }))
      expect(screen.queryByTestId('input-rename-trip-aaaa')).not.toBeInTheDocument()
    })

    it('will not save an empty name', async () => {
      const { mock, user } = setup()
      await row('aaaa')
      await user.click(screen.getByTestId('btn-rename-trip-aaaa'))
      await user.clear(screen.getByTestId('input-rename-trip-aaaa'))
      expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
      await user.keyboard('{Enter}')
      expect(mock.callsTo('PATCH /api/trips/aaaa')).toHaveLength(0)
    })

    it('keeps the input open and says why when the save fails', async () => {
      const { user } = setup({
        routes: {
          'PATCH /api/trips/aaaa': apiError(400, 'validation_error', 'That name is too long.'),
        },
      })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-rename-trip-aaaa'))
      await user.keyboard('x{Enter}')
      expect(await screen.findByText('That name is too long.')).toBeInTheDocument()
      expect(screen.getByTestId('input-rename-trip-aaaa')).toBeInTheDocument()
    })

    it('closes an open delete prompt when rename starts', async () => {
      const { user } = setup()
      await row('aaaa')
      await user.click(screen.getByTestId('btn-delete-trip-aaaa'))
      await user.click(screen.getByTestId('btn-rename-trip-aaaa'))
      expect(screen.queryByTestId('btn-confirm-delete')).not.toBeInTheDocument()
    })
  })

  describe('deleting', () => {
    it('asks first, and Keep it backs out', async () => {
      const { mock, user } = setup()
      await row('aaaa')
      await user.click(screen.getByTestId('btn-delete-trip-aaaa'))
      const prompt = screen.getByRole('alertdialog', { name: 'Delete Dallas to Denver?' })
      expect(prompt).toHaveTextContent("This can't be undone.")
      expect(screen.queryByTestId('btn-open-trip-aaaa')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('btn-cancel-delete'))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(screen.getByTestId('btn-open-trip-aaaa')).toBeInTheDocument()
      expect(mock.callsTo('DELETE /api/trips/aaaa')).toHaveLength(0)
    })

    it('deletes after confirmation and drops the row', async () => {
      const { mock, user } = setup({ routes: { 'DELETE /api/trips/aaaa': { status: 204 } } })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-delete-trip-aaaa'))
      await user.click(screen.getByTestId('btn-confirm-delete'))

      await screen.findByText('Trip deleted.')
      expect(mock.callsTo('DELETE /api/trips/aaaa')[0].headers.get('X-CSRFToken')).toBe('test-csrf')
      expect(screen.queryByTestId('trip-row-aaaa')).not.toBeInTheDocument()
      expect(screen.getByTestId('trip-row-bbbb')).toBeInTheDocument()
      expect(screen.getByText('1 saved, newest first')).toBeInTheDocument()
    })

    it('shows the empty state after the last trip goes', async () => {
      const { user } = setup({
        routes: { 'GET /api/trips': listReply([A]), 'DELETE /api/trips/aaaa': { status: 204 } },
      })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-delete-trip-aaaa'))
      await user.click(screen.getByTestId('btn-confirm-delete'))
      expect(await screen.findByTestId('trips-empty')).toBeInTheDocument()
    })

    it('keeps the row and says so when the delete fails', async () => {
      const { user } = setup({
        routes: {
          'DELETE /api/trips/aaaa': apiError(404, 'not_found', 'That trip was already deleted.'),
        },
      })
      await row('aaaa')
      await user.click(screen.getByTestId('btn-delete-trip-aaaa'))
      await user.click(screen.getByTestId('btn-confirm-delete'))
      expect(await screen.findByText('That trip was already deleted.')).toBeInTheDocument()
      expect(screen.getByTestId('trip-row-aaaa')).toBeInTheDocument()
    })

    it('moves the prompt when another row is chosen', async () => {
      const { user } = setup()
      await row('aaaa')
      await user.click(screen.getByTestId('btn-delete-trip-aaaa'))
      await user.click(screen.getByTestId('btn-delete-trip-bbbb'))
      expect(screen.getAllByTestId('btn-confirm-delete')).toHaveLength(1)
      expect(screen.getByRole('alertdialog')).toHaveAccessibleName('Delete Short hop?')
    })
  })
})
