import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlanRequest, PlanResponse } from '@/api/types'
import { encodeTrip } from '@/lib/share'
import { makePlan, makeTrip, makeTripSummary, makeUser, sampleRequest } from '@/test/makePlan'
import {
  apiError,
  deferred,
  geocodeHit,
  installApi,
  sessionRoutes,
  type Handler,
} from '@/test/mockApi'
import { renderWithProviders } from '@/test/render'
import { MAP_CLICK } from '@/test/tripMapStub'
import { App } from './App'

vi.mock('@/features/logs', () => import('@/test/logsMock'))
vi.mock('@/features/map/TripMap', () => import('@/test/tripMapStub'))

const PLAN = 'POST /api/plan'
const SAVE = 'POST /api/trips'

interface SetupOptions {
  user?: ReturnType<typeof makeUser> | null
  routes?: Record<string, Handler>
  url?: string
}

function setup({ user = null, routes = {}, url }: SetupOptions = {}) {
  if (url) window.history.pushState(null, '', url)
  const mock = installApi({
    ...sessionRoutes(user),
    [PLAN]: { body: makePlan() },
    'GET /api/geocode/search': {
      body: { results: [geocodeHit('Dallas, Texas, United States', 32.7767, -96.797)] },
    },
    ...routes,
  })
  renderWithProviders(<App />)
  return { mock, user: userEvent.setup() }
}

async function planExample(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('btn-example'))
  await user.click(screen.getByTestId('btn-plan'))
  await screen.findByTestId('stats-strip')
}

const field = (key: string) => screen.getByTestId(`field-${key}`) as HTMLInputElement

describe('page load', () => {
  it('fetches the CSRF cookie first, then asks who is signed in', async () => {
    const { mock } = setup()
    await screen.findByTestId('btn-sign-in')
    expect(mock.calls.slice(0, 2).map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/auth/csrf',
      'GET /api/auth/me',
    ])
  })

  it('shows the sign in and create account buttons for a visitor', async () => {
    setup()
    expect(await screen.findByTestId('btn-sign-in')).toBeInTheDocument()
    expect(screen.getByTestId('btn-sign-up')).toBeInTheDocument()
  })

  it('shows the account menu for a signed-in user', async () => {
    setup({ user: makeUser() })
    expect(await screen.findByTestId('account-menu')).toHaveTextContent('Dana Driver')
    expect(screen.queryByTestId('btn-sign-in')).not.toBeInTheDocument()
  })

  it('treats a failed session check as signed out, not as a broken page', async () => {
    setup({ routes: { 'GET /api/auth/me': apiError(500, 'server_error', 'Oops.') } })
    expect(await screen.findByTestId('btn-sign-in')).toBeInTheDocument()
    expect(screen.getByTestId('btn-plan')).toBeInTheDocument()
  })

  it('starts on the empty form with no results, errors or loading state', async () => {
    setup()
    await screen.findByTestId('btn-sign-in')
    expect(screen.getByRole('heading', { level: 1, name: 'Trip Planner' })).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stops', '0')
    expect(screen.queryByTestId('stats-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument()
  })

  it('credits OpenStreetMap and GeoNames in the footer', async () => {
    setup()
    await screen.findByTestId('btn-sign-in')
    expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    )
    expect(screen.getByRole('link', { name: 'GeoNames' })).toHaveAttribute(
      'href',
      'https://www.geonames.org/',
    )
  })
})

describe('planning a trip', () => {
  it('sends the example trip with the CSRF header and shows the results', async () => {
    const { mock, user } = setup()
    await planExample(user)

    const [call] = mock.callsTo(PLAN)
    expect(call.headers.get('X-CSRFToken')).toBe('test-csrf')
    expect(call.credentials).toBe('same-origin')
    const body = call.body as PlanRequest
    expect(body.current).toEqual({
      label: 'Dallas, Texas, United States',
      lat: 32.7767,
      lon: -96.797,
    })
    expect(body.pickup.lat).toBe(35.1495)
    expect(body.dropoff.lon).toBe(-104.9903)
    expect(body.cycle_used_hours).toBe(24)
    expect(body.departure).toMatch(/T06:00$/)

    expect(screen.getByTestId('stat-distance')).toHaveTextContent('1,492 mi')
    expect(screen.getByTestId('panel-itinerary')).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-stops', String(makePlan().stops.length))
  })

  it('shows a skeleton with a rotating status line while it waits, then removes it', async () => {
    const pending = deferred<{ body: unknown }>()
    const { user } = setup({ routes: { [PLAN]: () => pending.promise } })
    await user.click(screen.getByTestId('btn-example'))
    await user.click(screen.getByTestId('btn-plan'))

    const loading = await screen.findByTestId('loading')
    expect(loading).toHaveTextContent('Finding the route')
    expect(screen.getByTestId('btn-plan')).toBeDisabled()
    expect(screen.getByTestId('btn-plan')).toHaveTextContent('Planning trip')
    expect(screen.getByTestId('map')).toHaveAttribute('data-planning', 'Finding the route')

    pending.resolve({ body: makePlan() })
    await screen.findByTestId('stats-strip')
    expect(screen.queryByTestId('loading')).not.toBeInTheDocument()
    expect(screen.getByTestId('btn-plan')).toBeEnabled()
  })

  it('moves focus to the results heading when they arrive', async () => {
    const { user } = setup()
    await planExample(user)
    expect(
      screen.getByRole('heading', { level: 2, name: 'Dallas to Denver via Memphis' }),
    ).toHaveFocus()
  })

  it('does not call the API when the form is invalid', async () => {
    const { mock, user } = setup()
    await screen.findByTestId('btn-sign-in')
    await user.click(screen.getByTestId('btn-plan'))
    expect(screen.getByTestId('form-error-current')).toBeInTheDocument()
    expect(field('current')).toHaveFocus()
    expect(mock.callsTo(PLAN)).toHaveLength(0)
  })

  it('puts API field errors back on the form and offers no retry for them', async () => {
    const { user } = setup({
      routes: {
        [PLAN]: apiError(400, 'validation_error', 'Check the highlighted fields.', {
          cycle_used_hours: ['Must be between 0 and 70.'],
        }),
      },
    })
    await user.click(screen.getByTestId('btn-example'))
    await user.click(screen.getByTestId('btn-plan'))

    const banner = await screen.findByTestId('error-banner')
    expect(banner).toHaveTextContent('Check the highlighted fields.')
    expect(screen.queryByTestId('btn-retry')).not.toBeInTheDocument()
    expect(screen.getByTestId('form-error-cycle')).toHaveTextContent('Must be between 0 and 70.')
    expect(screen.getByTestId('input-cycle')).toHaveFocus()
  })

  it('adds messages that have no field to the banner', async () => {
    const { user } = setup({
      routes: {
        [PLAN]: apiError(400, 'validation_error', 'Check the highlighted fields.', {
          non_field_errors: ['Current, pickup and dropoff must not all match.'],
        }),
      },
    })
    await user.click(screen.getByTestId('btn-example'))
    await user.click(screen.getByTestId('btn-plan'))
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'Check the highlighted fields. Current, pickup and dropoff must not all match.',
    )
  })

  it('shows a router failure with Retry, and Retry plans again', async () => {
    let attempts = 0
    const { mock, user } = setup({
      routes: {
        [PLAN]: () =>
          ++attempts === 1
            ? apiError(502, 'upstream_error', 'The routing service is not answering.')
            : { body: makePlan() },
      },
    })
    await user.click(screen.getByTestId('btn-example'))
    await user.click(screen.getByTestId('btn-plan'))

    const banner = await screen.findByTestId('error-banner')
    expect(banner).toHaveTextContent('The routing service is not answering.')
    await user.click(screen.getByTestId('btn-retry'))

    await screen.findByTestId('stats-strip')
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument()
    expect(mock.callsTo(PLAN)).toHaveLength(2)
    expect(mock.callsTo(PLAN)[1].body).toEqual(mock.callsTo(PLAN)[0].body)
  })

  it('shows a no-route answer as a banner', async () => {
    const { user } = setup({
      routes: { [PLAN]: apiError(422, 'no_route', "Those places can't be joined by road.") },
    })
    await user.click(screen.getByTestId('btn-example'))
    await user.click(screen.getByTestId('btn-plan'))
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      "Those places can't be joined by road.",
    )
    expect(screen.getByTestId('btn-retry')).toBeInTheDocument()
  })

  it('shows a dropped connection as a banner', async () => {
    const { user } = setup({ routes: { [PLAN]: { networkError: true } } })
    await user.click(screen.getByTestId('btn-example'))
    await user.click(screen.getByTestId('btn-plan'))
    expect(await screen.findByTestId('error-banner')).toHaveTextContent("Can't reach the server")
  })

  it('starts the next plan on the itinerary tab and hides the old error', async () => {
    const { user } = setup()
    await planExample(user)
    await user.click(screen.getByTestId('tab-summary'))
    expect(screen.getByTestId('tab-summary')).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByTestId('btn-plan'))
    await waitFor(() =>
      expect(screen.getByTestId('tab-itinerary')).toHaveAttribute('aria-selected', 'true'),
    )
  })

  it('shows the warnings the API sends', async () => {
    const plan: PlanResponse = { ...makePlan(), warnings: ['A 34-hour restart was added.'] }
    const { user } = setup({ routes: { [PLAN]: { body: plan } } })
    await planExample(user)
    expect(screen.getByTestId('warnings')).toHaveTextContent('A 34-hour restart was added.')
  })

  it('sends the log details that were filled in', async () => {
    const { mock, user } = setup()
    await user.click(screen.getByTestId('btn-example'))
    await user.click(screen.getByTestId('btn-log-details'))
    await user.type(screen.getByTestId('input-carrier-name'), 'Acme Freight')
    await user.click(screen.getByTestId('btn-plan'))
    await screen.findByTestId('stats-strip')
    expect((mock.callsTo(PLAN)[0].body as PlanRequest).header).toEqual({
      carrier_name: 'Acme Freight',
    })
  })
})

describe('results actions', () => {
  it('clicking a stop card focuses that stop on the map', async () => {
    const { user } = setup()
    await planExample(user)
    expect(screen.getByTestId('map')).toHaveAttribute('data-focus', '')
    await user.click(screen.getByTestId('stop-card-stop-2'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-focus', 'stop-2')
    await user.click(screen.getByTestId('stop-card-stop-6'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-focus', 'stop-6')
  })

  it('switches between the three tabs', async () => {
    const { user } = setup()
    await planExample(user)
    await user.click(screen.getByTestId('tab-logs'))
    expect(screen.getByTestId('log-viewer')).toBeInTheDocument()
    await user.click(screen.getByTestId('tab-summary'))
    expect(screen.getByTestId('cycle-meter')).toBeInTheDocument()
    await user.click(screen.getByTestId('tab-itinerary'))
    expect(screen.getByTestId('tab-itinerary')).toHaveAttribute('aria-selected', 'true')
  })
})

describe('saving a trip', () => {
  const login: Record<string, Handler> = {
    'POST /api/auth/login': { body: { user: makeUser() } },
  }

  it('opens the sign in dialog first when signed out', async () => {
    const { mock, user } = setup({ routes: login })
    await planExample(user)
    await user.click(screen.getByTestId('btn-save'))

    const dialog = await screen.findByTestId('auth-dialog')
    expect(dialog).toHaveTextContent('Sign in or create an account to save this trip.')
    expect(mock.callsTo(SAVE)).toHaveLength(0)
  })

  it('finishes the save after signing in', async () => {
    const { mock, user } = setup({
      routes: { ...login, [SAVE]: { status: 201, body: makeTrip({ id: 'new-id' }) } },
    })
    await planExample(user)
    await user.click(screen.getByTestId('btn-save'))
    await user.type(await screen.findByTestId('input-auth-email'), 'driver@example.com')
    await user.type(screen.getByTestId('input-auth-password'), 'a-long-passphrase')
    await user.click(screen.getByTestId('btn-auth-submit'))

    await screen.findByText('Trip saved. Find it under My trips.')
    expect(screen.queryByTestId('auth-dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('account-menu')).toBeInTheDocument()
    expect(screen.getByTestId('btn-save')).toHaveTextContent('Saved')
    expect(screen.getByTestId('btn-save')).toBeDisabled()

    const [call] = mock.callsTo(SAVE)
    // The save sends the server's own echo of the request, not the raw form values.
    expect(call.body).toEqual({ title: 'Dallas to Denver', request: sampleRequest })
    expect(call.headers.get('X-CSRFToken')).toBe('test-csrf')
  })

  it('does not save later if the dialog was closed without signing in', async () => {
    const { mock, user } = setup({
      routes: { ...login, [SAVE]: { status: 201, body: makeTrip() } },
    })
    await planExample(user)
    await user.click(screen.getByTestId('btn-save'))
    await screen.findByTestId('auth-dialog')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('auth-dialog')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('btn-sign-in'))
    await user.type(await screen.findByTestId('input-auth-email'), 'driver@example.com')
    await user.type(screen.getByTestId('input-auth-password'), 'a-long-passphrase')
    await user.click(screen.getByTestId('btn-auth-submit'))
    await screen.findByTestId('account-menu')
    expect(mock.callsTo(SAVE)).toHaveLength(0)
    expect(screen.getByTestId('btn-save')).toHaveTextContent('Save trip')
  })

  it('saves straight away when already signed in', async () => {
    const { mock, user } = setup({
      user: makeUser(),
      routes: { [SAVE]: { status: 201, body: makeTrip() } },
    })
    await screen.findByTestId('account-menu')
    await planExample(user)
    await user.click(screen.getByTestId('btn-save'))
    await screen.findByText('Trip saved. Find it under My trips.')
    expect(screen.queryByTestId('auth-dialog')).not.toBeInTheDocument()
    expect(mock.callsTo(SAVE)).toHaveLength(1)
  })

  it('keeps the button live and shows the error when saving fails', async () => {
    const { user } = setup({
      user: makeUser(),
      routes: {
        [SAVE]: apiError(
          502,
          'upstream_error',
          'The route service is down, so the trip was not saved.',
        ),
      },
    })
    await screen.findByTestId('account-menu')
    await planExample(user)
    await user.click(screen.getByTestId('btn-save'))
    expect(
      await screen.findByText('The route service is down, so the trip was not saved.'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('btn-save')).toBeEnabled()
    expect(screen.getByTestId('btn-save')).toHaveTextContent('Save trip')
  })
})

describe('accounts', () => {
  it('creates an account from the header and says so', async () => {
    const { mock, user } = setup({
      routes: {
        'POST /api/auth/register': {
          status: 201,
          body: { user: makeUser({ name: 'New Driver' }) },
        },
      },
    })
    await user.click(await screen.findByTestId('btn-sign-up'))
    expect(screen.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByTestId('input-auth-email'), 'new@example.com')
    await user.type(screen.getByTestId('input-auth-password'), 'a-long-passphrase')
    await user.click(screen.getByTestId('btn-auth-submit'))

    await screen.findByText('Account created. You are signed in.')
    expect(await screen.findByTestId('account-menu')).toHaveTextContent('New Driver')
    expect(mock.callsTo('POST /api/auth/register')).toHaveLength(1)
  })

  it('opens sign in from the header and greets the person by name', async () => {
    const { user } = setup({ routes: { 'POST /api/auth/login': { body: { user: makeUser() } } } })
    await user.click(await screen.findByTestId('btn-sign-in'))
    expect(screen.getByTestId('tab-auth-login')).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByTestId('input-auth-email'), 'driver@example.com')
    await user.type(screen.getByTestId('input-auth-password'), 'a-long-passphrase')
    await user.click(screen.getByTestId('btn-auth-submit'))
    expect(await screen.findByText('Signed in as Dana Driver.')).toBeInTheDocument()
  })

  it('shows a wrong password inside the dialog and keeps it open', async () => {
    const { user } = setup({
      routes: {
        'POST /api/auth/login': apiError(
          400,
          'validation_error',
          'That email and password do not match.',
        ),
      },
    })
    await user.click(await screen.findByTestId('btn-sign-in'))
    await user.type(screen.getByTestId('input-auth-email'), 'driver@example.com')
    await user.type(screen.getByTestId('input-auth-password'), 'nope-nope-nope')
    await user.click(screen.getByTestId('btn-auth-submit'))
    expect(await screen.findByTestId('auth-error')).toHaveTextContent(
      'That email and password do not match.',
    )
    expect(screen.getByTestId('auth-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it('signs out from the menu', async () => {
    const { mock, user } = setup({
      user: makeUser(),
      routes: { 'POST /api/auth/logout': { status: 204 } },
    })
    await user.click(await screen.findByTestId('account-menu'))
    await user.click(screen.getByTestId('btn-sign-out'))

    await screen.findByText('Signed out.')
    expect(await screen.findByTestId('btn-sign-in')).toBeInTheDocument()
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
    expect(mock.callsTo('POST /api/auth/logout')[0].headers.get('X-CSRFToken')).toBe('test-csrf')
  })

  it('reports a sign out that failed and stays signed in', async () => {
    const { user } = setup({
      user: makeUser(),
      routes: { 'POST /api/auth/logout': apiError(500, 'server_error', 'Oops.') },
    })
    await user.click(await screen.findByTestId('account-menu'))
    await user.click(screen.getByTestId('btn-sign-out'))
    expect(await screen.findByText("Couldn't sign out. Try again.")).toBeInTheDocument()
    expect(screen.getByTestId('account-menu')).toBeInTheDocument()
  })
})

describe('my trips', () => {
  const saved = makeTripSummary({ id: 'trip-1', title: 'Dallas to Denver' })
  const routes: Record<string, Handler> = {
    'GET /api/trips': { body: { results: [saved], count: 1 } },
    'GET /api/trips/trip-1': { body: makeTrip({ id: 'trip-1', title: 'Dallas to Denver' }) },
  }

  async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByTestId('account-menu'))
    await user.click(screen.getByTestId('btn-my-trips'))
    return screen.findByTestId('trips-drawer')
  }

  it('opens from the menu and lists saved trips', async () => {
    const { user } = setup({ user: makeUser(), routes })
    const drawer = await openDrawer(user)
    expect(await within(drawer).findByTestId('trip-row-trip-1')).toBeInTheDocument()
  })

  it('loads a saved trip into the form and the results, and closes the drawer', async () => {
    const { user } = setup({ user: makeUser(), routes })
    await openDrawer(user)
    await user.click(await screen.findByTestId('btn-open-trip-trip-1'))

    await screen.findByText('Opened "Dallas to Denver".')
    expect(screen.queryByTestId('trips-drawer')).not.toBeInTheDocument()
    expect(await screen.findByTestId('stats-strip')).toBeInTheDocument()
    expect(field('current')).toHaveValue('Dallas, Texas, United States')
    expect(field('dropoff')).toHaveValue('Denver, Colorado, United States')
    expect(screen.getByTestId('input-cycle')).toHaveValue(24)
    expect(screen.getByTestId('btn-save')).toHaveTextContent('Saved')
  })

  it('shows the empty state for a new account', async () => {
    const { user } = setup({
      user: makeUser(),
      routes: { 'GET /api/trips': { body: { results: [], count: 0 } } },
    })
    const drawer = await openDrawer(user)
    expect(await within(drawer).findByTestId('trips-empty')).toBeInTheDocument()
  })

  it('closes with its button', async () => {
    const { user } = setup({ user: makeUser(), routes })
    await openDrawer(user)
    await user.click(screen.getByTestId('btn-close-trips'))
    expect(screen.queryByTestId('trips-drawer')).not.toBeInTheDocument()
  })

  it('can be reached again after signing out and back in', async () => {
    const { user } = setup({
      user: makeUser(),
      routes: {
        ...routes,
        'POST /api/auth/logout': { status: 204 },
        'POST /api/auth/login': { body: { user: makeUser() } },
      },
    })
    await user.click(await screen.findByTestId('account-menu'))
    await user.click(screen.getByTestId('btn-sign-out'))
    await user.click(await screen.findByTestId('btn-sign-in'))
    await user.type(screen.getByTestId('input-auth-email'), 'driver@example.com')
    await user.type(screen.getByTestId('input-auth-password'), 'a-long-passphrase')
    await user.click(screen.getByTestId('btn-auth-submit'))
    await openDrawer(user)
    expect(await screen.findByTestId('trip-row-trip-1')).toBeInTheDocument()
  })
})

describe('pick on map', () => {
  const REVERSE = 'GET /api/geocode/reverse'
  const picked = {
    label: 'Chicago, Illinois, United States',
    lat: MAP_CLICK.lat,
    lon: MAP_CLICK.lon,
  }

  it('fills the field from a map click and leaves pick mode', async () => {
    const { mock, user } = setup({ routes: { [REVERSE]: { body: { place: picked } } } })
    await screen.findByTestId('btn-sign-in')
    await user.click(screen.getByTestId('btn-pick-pickup'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-pick', 'pickup')

    await user.click(screen.getByRole('button', { name: 'Click the map' }))
    await waitFor(() => expect(field('pickup')).toHaveValue('Chicago, Illinois, United States'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-pick', '')
    expect(screen.getByTestId('btn-pick-pickup')).toHaveAttribute('aria-pressed', 'false')

    const [call] = mock.callsTo(REVERSE)
    expect(call.search.get('lat')).toBe('41.500000')
    expect(call.search.get('lon')).toBe('-87.250000')
  })

  it('stays in pick mode and says so when the spot cannot be named', async () => {
    const { user } = setup({
      routes: { [REVERSE]: apiError(502, 'upstream_error', 'Lookup failed.') },
    })
    await screen.findByTestId('btn-sign-in')
    await user.click(screen.getByTestId('btn-pick-dropoff'))
    await user.click(screen.getByRole('button', { name: 'Click the map' }))
    expect(
      await screen.findByText("Couldn't name that spot. Click somewhere else on the map."),
    ).toBeInTheDocument()
    expect(screen.getByTestId('map')).toHaveAttribute('data-pick', 'dropoff')
    expect(field('dropoff')).toHaveValue('')
  })

  it('leaves pick mode on Escape', async () => {
    const { user } = setup()
    await screen.findByTestId('btn-sign-in')
    await user.click(screen.getByTestId('btn-pick-current'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-pick', 'current')
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('map')).toHaveAttribute('data-pick', '')
  })

  it('leaves pick mode from the map cancel button', async () => {
    const { user } = setup()
    await screen.findByTestId('btn-sign-in')
    await user.click(screen.getByTestId('btn-pick-current'))
    await user.click(screen.getByRole('button', { name: 'Cancel pick' }))
    expect(screen.getByTestId('map')).toHaveAttribute('data-pick', '')
  })

  it('ends pick mode when the form is submitted', async () => {
    const { user } = setup()
    await screen.findByTestId('btn-sign-in')
    await user.click(screen.getByTestId('btn-pick-current'))
    await user.click(screen.getByTestId('btn-plan'))
    expect(screen.getByTestId('map')).toHaveAttribute('data-pick', '')
  })

  it('shows chosen places on the map before planning', async () => {
    const { user } = setup()
    await user.click(await screen.findByTestId('btn-example'))
    expect(screen.getByTestId('map').getAttribute('data-places')).toBe(
      'Dallas, Texas, United States|Memphis, Tennessee, United States|Denver, Colorado, United States',
    )
  })
})

describe('share link on load', () => {
  const request: PlanRequest = sampleRequest

  it('fills the form and plans straight away', async () => {
    const { mock } = setup({ url: `/?trip=${encodeTrip(request)}` })
    await screen.findByTestId('stats-strip')
    expect(mock.callsTo(PLAN)).toHaveLength(1)
    expect(mock.callsTo(PLAN)[0].body).toEqual(request)
    expect(field('current')).toHaveValue('Dallas, Texas, United States')
    expect(field('pickup')).toHaveValue('Memphis, Tennessee, United States')
    expect(screen.getByTestId('input-cycle')).toHaveValue(24)
    expect((screen.getByTestId('input-departure') as HTMLInputElement).value).toBe(
      '2026-10-07T06:00',
    )
    expect((screen.getByTestId('select-timezone') as HTMLSelectElement).value).toBe(
      'America/Chicago',
    )
  })

  it('carries the log details through the link', async () => {
    const withHeader: PlanRequest = { ...request, header: { driver_name: 'Dana Driver' } }
    setup({ url: `/?trip=${encodeTrip(withHeader)}` })
    await screen.findByTestId('stats-strip')
    await userEvent.setup().click(screen.getByTestId('btn-log-details'))
    expect(screen.getByTestId('input-driver-name')).toHaveValue('Dana Driver')
  })

  it('tells the person when the link is damaged and does not plan', async () => {
    const { mock } = setup({ url: '/?trip=%25%25%25' })
    expect(
      await screen.findByText("That share link is damaged, so it couldn't be opened."),
    ).toBeInTheDocument()
    await screen.findByTestId('btn-sign-in')
    expect(mock.callsTo(PLAN)).toHaveLength(0)
    expect(field('current')).toHaveValue('')
  })

  it('rejects a link with an out-of-range cycle without calling the API', async () => {
    const hostile = encodeTrip({ ...request, cycle_used_hours: 24 }).slice(0, 10) + '!!!'
    const { mock } = setup({ url: `/?trip=${hostile}` })
    expect(await screen.findByText(/damaged/)).toBeInTheDocument()
    expect(mock.callsTo(PLAN)).toHaveLength(0)
  })

  it('shows the error banner when the linked trip cannot be planned', async () => {
    setup({
      url: `/?trip=${encodeTrip(request)}`,
      routes: { [PLAN]: apiError(502, 'upstream_error', 'The routing service is not answering.') },
    })
    expect(await screen.findByTestId('error-banner')).toHaveTextContent(
      'The routing service is not answering.',
    )
    expect(screen.getByTestId('btn-retry')).toBeInTheDocument()
  })

  it('does nothing special without the parameter', async () => {
    const { mock } = setup({ url: '/?other=1' })
    await screen.findByTestId('btn-sign-in')
    expect(mock.callsTo(PLAN)).toHaveLength(0)
  })
})
