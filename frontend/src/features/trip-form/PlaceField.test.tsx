import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { deferred, geocodeHit, installApi } from '@/test/mockApi'
import { renderWithProviders } from '@/test/render'
import { EMPTY_PLACE, type PlaceValue } from './formState'
import { MIN_QUERY_LENGTH, PlaceField, SEARCH_DELAY_MS } from './PlaceField'

const SEARCH = 'GET /api/geocode/search'

const DALLAS = geocodeHit('Dallas, Texas, United States', 32.7767, -96.797, 'Texas, United States')
const DALLAS_GA = geocodeHit(
  'Dallas, Georgia, United States',
  33.9237,
  -84.8408,
  'Georgia, United States',
)
const DALLAS_OR = geocodeHit(
  'Dallas, Oregon, United States',
  44.9193,
  -123.317,
  'Oregon, United States',
)

interface HarnessProps {
  initial?: PlaceValue
  error?: string
  picking?: boolean
  onTogglePick?: () => void
  onValue?: (value: PlaceValue) => void
}

function Harness({
  initial = EMPTY_PLACE,
  error,
  picking = false,
  onTogglePick = () => {},
  onValue,
}: HarnessProps) {
  const [value, setValue] = useState(initial)
  return (
    <PlaceField
      field="current"
      label="Current location"
      placeholder="City, address or place"
      value={value}
      error={error}
      picking={picking}
      onChange={(next) => {
        onValue?.(next)
        setValue(next)
      }}
      onTogglePick={onTogglePick}
    />
  )
}

function setup(props: HarnessProps = {}, results = [DALLAS, DALLAS_GA, DALLAS_OR]) {
  const mock = installApi({ [SEARCH]: { body: { results } } })
  renderWithProviders(<Harness {...props} />)
  return {
    mock,
    user: userEvent.setup(),
    input: screen.getByTestId('field-current') as HTMLInputElement,
  }
}

describe('PlaceField combobox', () => {
  it('exposes the combobox role and a label', () => {
    const { input } = setup()
    expect(screen.getByRole('combobox', { name: 'Current location' })).toBe(input)
    expect(input).toHaveAttribute('aria-autocomplete', 'list')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveAttribute('placeholder', 'City, address or place')
  })

  it('searches once, after the debounce, with the typed text', async () => {
    const { mock, user, input } = setup()
    await user.type(input, 'dallas')
    expect(SEARCH_DELAY_MS).toBe(300)
    expect(mock.callsTo(SEARCH)).toHaveLength(0)

    expect(await screen.findAllByTestId('suggestion')).toHaveLength(3)
    const calls = mock.callsTo(SEARCH)
    expect(calls).toHaveLength(1)
    expect(calls[0].search.get('q')).toBe('dallas')
    expect(calls[0].search.get('limit')).toBe('6')
    expect(calls[0].search.has('lat')).toBe(true)
    expect(calls[0].search.has('lon')).toBe(true)
  })

  it('does not search below the minimum length', async () => {
    const { mock, user, input } = setup()
    expect(MIN_QUERY_LENGTH).toBe(2)
    await user.type(input, 'd')
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 100))
    expect(mock.callsTo(SEARCH)).toHaveLength(0)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('trims the query before sending it', async () => {
    const { mock, user, input } = setup()
    await user.type(input, '  da ')
    await screen.findAllByTestId('suggestion')
    expect(mock.callsTo(SEARCH)[0].search.get('q')).toBe('da')
  })

  it('lists each match with its city and detail, and announces the count', async () => {
    const { user, input } = setup()
    await user.type(input, 'dal')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveTextContent('Dallas')
    expect(options[0]).toHaveTextContent('Texas, United States')
    expect(screen.getByText('3 matches available')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
  })

  it('falls back to the rest of the label when the API sends no detail', async () => {
    const { user, input } = setup({}, [geocodeHit('Dallas, Texas, United States', 1, 2, '')])
    await user.type(input, 'dal')
    const [option] = await screen.findAllByTestId('suggestion')
    expect(option).toHaveTextContent('Texas, United States')
  })

  it('uses the singular for one match', async () => {
    const { user, input } = setup({}, [DALLAS])
    await user.type(input, 'dal')
    await screen.findAllByTestId('suggestion')
    expect(screen.getByText('1 match available')).toBeInTheDocument()
  })

  describe('keyboard', () => {
    it('moves the highlight with the arrow keys and wraps at both ends', async () => {
      const { user, input } = setup()
      await user.type(input, 'dal')
      const options = await screen.findAllByRole('option')

      await user.keyboard('{ArrowDown}')
      expect(options[0]).toHaveAttribute('aria-selected', 'true')
      expect(input).toHaveAttribute('aria-activedescendant', options[0].id)

      await user.keyboard('{ArrowDown}{ArrowDown}')
      expect(options[2]).toHaveAttribute('aria-selected', 'true')

      await user.keyboard('{ArrowDown}')
      expect(options[0]).toHaveAttribute('aria-selected', 'true')

      await user.keyboard('{ArrowUp}')
      expect(options[2]).toHaveAttribute('aria-selected', 'true')
    })

    it('starts from the last match when ArrowUp comes first', async () => {
      const { user, input } = setup()
      await user.type(input, 'dal')
      const options = await screen.findAllByRole('option')
      await user.keyboard('{ArrowUp}')
      expect(options[2]).toHaveAttribute('aria-selected', 'true')
    })

    it('picks the highlighted match on Enter', async () => {
      const onValue = vi.fn()
      const { user, input } = setup({ onValue })
      await user.type(input, 'dal')
      await screen.findAllByRole('option')
      await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
      expect(onValue).toHaveBeenLastCalledWith({
        text: DALLAS_GA.label,
        place: { label: DALLAS_GA.label, lat: DALLAS_GA.lat, lon: DALLAS_GA.lon },
      })
      expect(input).toHaveValue(DALLAS_GA.label)
    })

    it('takes the top match on Enter when nothing is highlighted', async () => {
      const { user, input } = setup()
      await user.type(input, 'dal')
      await screen.findAllByRole('option')
      await user.keyboard('{Enter}')
      expect(input).toHaveValue(DALLAS.label)
    })

    it('does nothing on Enter while there are no matches, so the form can submit', async () => {
      const { user, input } = setup({}, [])
      await user.type(input, 'zzzz')
      await screen.findByText('No matches. Try a city name or a street address.')
      const onKeyDown = vi.fn((event: KeyboardEvent) => event.defaultPrevented)
      input.addEventListener('keydown', onKeyDown)
      await user.keyboard('{Enter}')
      expect(onKeyDown).toHaveReturnedWith(false)
    })

    it('closes the list on Escape and keeps the event from reaching the page', async () => {
      const { user, input } = setup()
      await user.type(input, 'dal')
      await screen.findAllByRole('option')

      const pageListener = vi.fn()
      document.addEventListener('keydown', pageListener)
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(input).toHaveAttribute('aria-expanded', 'false')
      expect(pageListener).not.toHaveBeenCalled()

      await user.keyboard('{Escape}')
      expect(pageListener).toHaveBeenCalledTimes(1)
      document.removeEventListener('keydown', pageListener)
    })

    it('reopens the list with ArrowDown after Escape', async () => {
      const { user, input } = setup()
      await user.type(input, 'dal')
      await screen.findAllByRole('option')
      await user.keyboard('{Escape}')
      await user.keyboard('{ArrowDown}')
      expect(await screen.findAllByRole('option')).toHaveLength(3)
    })
  })

  describe('choosing', () => {
    it('picks a match with the mouse, closes the list and keeps focus in the field', async () => {
      const onValue = vi.fn()
      const { user, input } = setup({ onValue })
      await user.type(input, 'dal')
      const options = await screen.findAllByRole('option')
      await user.click(options[1])

      expect(input).toHaveValue(DALLAS_GA.label)
      expect(input).toHaveAttribute('title', DALLAS_GA.label)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(input).toHaveFocus()
      expect(onValue).toHaveBeenLastCalledWith({
        text: DALLAS_GA.label,
        place: { label: DALLAS_GA.label, lat: DALLAS_GA.lat, lon: DALLAS_GA.lon },
      })
    })

    it('forgets the picked place as soon as the text is edited', async () => {
      const onValue = vi.fn()
      const { user, input } = setup({ onValue })
      await user.type(input, 'dal')
      await user.click((await screen.findAllByRole('option'))[0])
      await user.type(input, 'x')
      expect(onValue).toHaveBeenLastCalledWith({ text: `${DALLAS.label}x`, place: null })
    })

    it('does not search for a place that is already picked', async () => {
      const { mock, user, input } = setup({
        initial: {
          text: DALLAS.label,
          place: { label: DALLAS.label, lat: DALLAS.lat, lon: DALLAS.lon },
        },
      })
      await user.click(input)
      await new Promise((resolve) => setTimeout(resolve, SEARCH_DELAY_MS + 100))
      expect(mock.callsTo(SEARCH)).toHaveLength(0)
    })
  })

  describe('states', () => {
    it('shows a loading row until the first answer arrives', async () => {
      const pending = deferred<{ body: unknown }>()
      const mock = installApi({ [SEARCH]: () => pending.promise })
      renderWithProviders(<Harness />)
      const user = userEvent.setup()
      await user.type(screen.getByTestId('field-current'), 'dal')

      expect((await screen.findAllByText('Searching places')).length).toBeGreaterThan(0)
      expect(screen.queryByRole('option')).not.toBeInTheDocument()

      pending.resolve({ body: { results: [DALLAS] } })
      expect(await screen.findAllByRole('option')).toHaveLength(1)
      expect(screen.queryByText('Searching places')).not.toBeInTheDocument()
      expect(mock.callsTo(SEARCH)).toHaveLength(1)
    })

    it('keeps the old list on screen while the next search loads', async () => {
      const next = deferred<{ body: unknown }>()
      installApi({
        [SEARCH]: (call) =>
          call.search.get('q') === 'dal'
            ? { body: { results: [DALLAS, DALLAS_GA] } }
            : next.promise,
      })
      renderWithProviders(<Harness />)
      const user = userEvent.setup()
      const input = screen.getByTestId('field-current')
      await user.type(input, 'dal')
      expect(await screen.findAllByRole('option')).toHaveLength(2)

      await user.type(input, 'l')
      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))
      next.resolve({ body: { results: [DALLAS] } })
      await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    })

    it('says so when nothing matches', async () => {
      const { user, input } = setup({}, [])
      await user.type(input, 'qqqq')
      expect(
        await screen.findByText('No matches. Try a city name or a street address.'),
      ).toBeInTheDocument()
      expect(screen.getAllByText('No matches').length).toBeGreaterThan(0)
    })

    it('points to the map when search fails', async () => {
      installApi({
        [SEARCH]: {
          status: 502,
          body: { error: { code: 'upstream_error', message: 'Search is down.' } },
        },
      })
      renderWithProviders(<Harness />)
      const user = userEvent.setup()
      await user.type(screen.getByTestId('field-current'), 'dal')
      expect(
        await screen.findByText('Search is unavailable right now. Pick on the map instead.'),
      ).toBeInTheDocument()
    })
  })

  describe('buttons', () => {
    it('shows the clear button only when there is text, and clears and refocuses', async () => {
      const onValue = vi.fn()
      const { user, input } = setup({ onValue })
      expect(screen.queryByTestId('btn-clear-current')).not.toBeInTheDocument()

      await user.type(input, 'dal')
      const clear = screen.getByTestId('btn-clear-current')
      expect(clear).toHaveAccessibleName('Clear current location')

      await user.click(clear)
      expect(input).toHaveValue('')
      expect(input).toHaveFocus()
      expect(onValue).toHaveBeenLastCalledWith({ text: '', place: null })
      expect(screen.queryByTestId('btn-clear-current')).not.toBeInTheDocument()
    })

    it('reflects pick-on-map mode and reports clicks', async () => {
      const onTogglePick = vi.fn()
      const { user } = setup({ onTogglePick })
      const pick = screen.getByTestId('btn-pick-current')
      expect(pick).toHaveAccessibleName('Pick current location on the map')
      expect(pick).toHaveAttribute('aria-pressed', 'false')
      await user.click(pick)
      expect(onTogglePick).toHaveBeenCalledTimes(1)
    })

    it('shows the pressed state while picking', () => {
      setup({ picking: true })
      expect(screen.getByTestId('btn-pick-current')).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('validation message', () => {
    it('links the error to the input', () => {
      const { input } = setup({ error: 'Add your current location.' })
      const message = screen.getByTestId('form-error-current')
      expect(message).toHaveTextContent('Add your current location.')
      expect(message).toHaveAttribute('role', 'alert')
      expect(input).toHaveAttribute('aria-invalid', 'true')
      expect(input.getAttribute('aria-describedby')).toBe(message.id)
    })

    it('has no invalid state without an error', () => {
      const { input } = setup()
      expect(input).not.toHaveAttribute('aria-invalid')
      expect(screen.queryByTestId('form-error-current')).not.toBeInTheDocument()
    })
  })

  describe('untrusted text', () => {
    it('renders an HTML place label as plain text', async () => {
      const hostile = '<img src=x onerror=alert(1)>'
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
      const { user, input } = setup({}, [
        geocodeHit(`${hostile}, <b>Texas</b>`, 1, 2, '<script>alert(2)</script>'),
      ])
      await user.type(input, 'hos')
      const [option] = await screen.findAllByRole('option')

      expect(option).toHaveTextContent(hostile)
      expect(option).toHaveTextContent('<script>alert(2)</script>')
      expect(option.querySelector('img, script, b')).toBeNull()
      expect(document.querySelector('img')).toBeNull()
      expect(alert).not.toHaveBeenCalled()

      await user.keyboard('{Enter}')
      expect(input).toHaveValue(`${hostile}, <b>Texas</b>`)
      expect(document.querySelector('img')).toBeNull()
    })
  })
})
