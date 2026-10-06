import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DirectionLeg, DirectionStep } from '@/api/types'
import { makePlan } from '@/test/makePlan'
import { Directions } from './Directions'

const HOSTILE = '<img src=x onerror=alert(1)>'

function setup(directions: DirectionLeg[] | undefined = makePlan().directions) {
  const onSelectPoint = vi.fn()
  render(<Directions directions={directions} onSelectPoint={onSelectPoint} />)
  return { onSelectPoint, user: userEvent.setup() }
}

/** The sample directions with one step replaced. */
function withStep(legIndex: number, stepIndex: number, patch: Partial<DirectionStep>) {
  return makePlan().directions.map((leg, li) =>
    li === legIndex
      ? {
          ...leg,
          steps: leg.steps.map((step, si) => (si === stepIndex ? { ...step, ...patch } : step)),
        }
      : leg,
  )
}

const step = (leg: number, index: number) => screen.getByTestId(`direction-step-${leg}-${index}`)

describe('Directions legs', () => {
  it('draws one card per leg with its title and distance', () => {
    setup()
    const first = screen.getByTestId('direction-leg-0')
    expect(within(first).getByRole('heading', { level: 3 })).toHaveTextContent(
      'Dallas, TX to Memphis, TN',
    )
    expect(first).toHaveTextContent('452 mi')
    expect(first).toHaveTextContent('Leg 1, to the pickup')
    const second = screen.getByTestId('direction-leg-1')
    expect(second).toHaveTextContent('Memphis, TN to Denver, CO')
    expect(second).toHaveTextContent('1,040 mi')
    expect(second).toHaveTextContent('Leg 2, to the dropoff')
  })

  it('names each card by its title for screen readers', () => {
    setup()
    expect(screen.getByRole('region', { name: 'Dallas, TX to Memphis, TN' })).toBeInTheDocument()
  })

  it('lists every step as a button, in order, with the arrival last', () => {
    setup()
    const lines = within(screen.getByTestId('direction-leg-0')).getAllByRole('button')
    expect(lines.map((b) => b.getAttribute('data-testid'))).toEqual([
      'direction-step-0-0',
      'direction-step-0-1',
      'direction-step-0-2',
      'direction-step-0-3',
      'direction-step-0-4',
    ])
    expect(step(0, 0)).toHaveTextContent('Head east on Commerce St')
    expect(step(0, 1)).toHaveTextContent('Take I-30 E')
    expect(step(0, 3)).toHaveTextContent('Continue on Union Ave')
    expect(step(0, 4)).toHaveTextContent('Arrive at Memphis')
    expect(screen.getAllByTestId(/^direction-step-1-/)).toHaveLength(5)
  })

  it('keeps the index of a leg that has steps when another has none', () => {
    const [first, second] = makePlan().directions
    setup([{ ...first, steps: [] }, second])
    expect(screen.queryByTestId('direction-leg-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('direction-leg-1')).toBeInTheDocument()
    expect(screen.getByTestId('direction-step-1-0')).toBeInTheDocument()
  })
})

describe('Directions lines', () => {
  it('shows the stretch length on the right and the trip mile under it', () => {
    setup()
    expect(within(step(0, 1)).getByText('318 mi')).toBeInTheDocument()
    expect(within(step(0, 1)).getByText('mile 1')).toBeInTheDocument()
    expect(within(step(1, 2)).getByText('346 mi')).toBeInTheDocument()
    // Leg 2 counts from the start of the whole trip, not from the pickup.
    expect(within(step(1, 2)).getByText('mile 1,136')).toBeInTheDocument()
  })

  it('keeps the tenth on a short stretch', () => {
    setup()
    expect(within(step(0, 0)).getByText('1.4 mi')).toBeInTheDocument()
    expect(within(step(0, 3)).getByText('5.8 mi')).toBeInTheDocument()
  })

  it('shows no length on the arrival line, only the mile', () => {
    setup()
    const arrive = step(0, 4)
    expect(arrive).toHaveTextContent('mile 452')
    expect(arrive).not.toHaveTextContent(/\d mi\b/)
  })

  it('turns the arrow to the compass heading', () => {
    setup()
    const turn = (leg: number, index: number) => {
      const arrow = within(step(leg, index)).getByTestId('direction-arrow')
      return [arrow.getAttribute('data-heading'), arrow.querySelector('svg')?.style.transform]
    }
    expect(turn(0, 1)).toEqual(['E', 'rotate(90deg)'])
    expect(turn(1, 1)).toEqual(['W', 'rotate(270deg)'])
    expect(turn(1, 2)).toEqual(['N', 'rotate(0deg)'])
  })

  it.each([
    ['N', 0],
    ['NE', 45],
    ['E', 90],
    ['SE', 135],
    ['S', 180],
    ['SW', 225],
    ['W', 270],
    ['NW', 315],
  ])('rotates %s by %i degrees', (heading, degrees) => {
    setup(withStep(0, 1, { heading }))
    const arrow = within(step(0, 1)).getByTestId('direction-arrow')
    expect(arrow.querySelector('svg')?.style.transform).toBe(`rotate(${degrees}deg)`)
  })

  it('draws a plain road icon when the heading is one it does not know', () => {
    setup(withStep(0, 1, { heading: '' }))
    const arrow = within(step(0, 1)).getByTestId('direction-arrow')
    expect(arrow.querySelector('svg')?.style.transform).toBe('')
  })

  it('gives the start and the arrival a map badge in place of an arrow', () => {
    setup()
    for (const [leg, index] of [
      [0, 0],
      [0, 4],
      [1, 0],
      [1, 4],
    ]) {
      const line = step(leg, index)
      expect(within(line).getByTestId('direction-icon')).toBeInTheDocument()
      expect(within(line).queryByTestId('direction-arrow')).not.toBeInTheDocument()
    }
    expect(within(step(0, 1)).queryByTestId('direction-icon')).not.toBeInTheDocument()
  })

  it('hides the icons and the repeated road from screen readers', () => {
    setup()
    expect(within(step(0, 1)).getByTestId('direction-arrow')).toHaveAttribute('aria-hidden', 'true')
    expect(within(step(0, 1)).getByText('I-30')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: /^Take I-30 E.*Show on map\./ })).toBe(step(0, 1))
  })
})

describe('road labels', () => {
  it('puts an interstate on a deep teal chip', () => {
    setup()
    const chip = within(step(0, 1)).getByText('I-30')
    expect(chip).toHaveAttribute('data-road-kind', 'interstate')
    expect(chip).toHaveClass('bg-teal-900', 'text-white')
  })

  it('puts a US or state route on an ink chip', () => {
    setup(withStep(1, 2, { road: 'TX-183', instruction: 'Take TX-183 N' }))
    const chip = within(step(1, 2)).getByText('TX-183')
    expect(chip).toHaveAttribute('data-road-kind', 'route')
    expect(chip).toHaveClass('text-ink-900', 'ring-ink-500')
    expect(chip).not.toHaveClass('bg-teal-900')
  })

  it('reads US-287 as a route chip', () => {
    setup()
    const chip = within(step(1, 2)).getByText('US-287')
    expect(chip).toHaveAttribute('data-road-kind', 'route')
    expect(chip).toHaveClass('text-ink-900')
  })

  it('shows a street name as quiet text with no chip', () => {
    setup()
    const name = within(step(0, 0)).getByText('Commerce St')
    expect(name).toHaveAttribute('data-road-kind', 'street')
    expect(name).toHaveClass('text-ink-500')
    expect(name).not.toHaveClass('bg-teal-900')
    expect(name).not.toHaveClass('ring-1')
  })

  it('shows no label when the road is empty', () => {
    setup(withStep(0, 1, { road: '', instruction: 'Continue east' }))
    expect(step(0, 1).querySelector('[data-road-kind]')).toBeNull()
  })

  it('treats a lettered interstate such as I-35E as an interstate', () => {
    setup(withStep(0, 1, { road: 'I-35E', instruction: 'Take I-35E S' }))
    expect(within(step(0, 1)).getByText('I-35E')).toHaveAttribute('data-road-kind', 'interstate')
  })
})

describe('choosing a line', () => {
  it('sends the spot where that stretch begins', async () => {
    const { onSelectPoint, user } = setup()
    const target = makePlan().directions[1].steps[2]
    await user.click(step(1, 2))
    expect(onSelectPoint).toHaveBeenCalledTimes(1)
    expect(onSelectPoint).toHaveBeenCalledWith({ lat: target.lat, lon: target.lon })
  })

  it('works on the start and the arrival too', async () => {
    const { onSelectPoint, user } = setup()
    const [first, last] = [makePlan().directions[0].steps[0], makePlan().directions[0].steps[4]]
    await user.click(step(0, 0))
    await user.click(step(0, 4))
    expect(onSelectPoint).toHaveBeenNthCalledWith(1, { lat: first.lat, lon: first.lon })
    expect(onSelectPoint).toHaveBeenNthCalledWith(2, { lat: last.lat, lon: last.lon })
  })

  it('makes every line a tab stop', async () => {
    const { user } = setup()
    await user.tab()
    expect(step(0, 0)).toHaveFocus()
    await user.tab()
    expect(step(0, 1)).toHaveFocus()
    for (const line of screen.getAllByTestId(/^direction-step-/)) {
      expect(line).not.toHaveAttribute('tabindex', '-1')
      expect(line.tagName).toBe('BUTTON')
      expect(line).toHaveAttribute('type', 'button')
    }
  })

  it('answers Enter and Space', async () => {
    const { onSelectPoint, user } = setup()
    step(0, 2).focus()
    await user.keyboard('{Enter}')
    expect(onSelectPoint).toHaveBeenCalledTimes(1)
    await user.keyboard(' ')
    expect(onSelectPoint).toHaveBeenCalledTimes(2)
    expect(onSelectPoint).toHaveBeenLastCalledWith({
      lat: makePlan().directions[0].steps[2].lat,
      lon: makePlan().directions[0].steps[2].lon,
    })
  })
})

describe('without directions', () => {
  const MESSAGE =
    "Road-by-road directions aren't available for this trip. The route on the map and the stops are unaffected."

  it('says so, in plain words', () => {
    setup([])
    expect(screen.getByTestId('directions-empty')).toHaveTextContent(MESSAGE)
    expect(screen.queryByTestId(/^direction-leg-/)).not.toBeInTheDocument()
  })

  it('does not dress the empty state as an error', () => {
    setup([])
    const empty = screen.getByTestId('directions-empty')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(empty).not.toHaveAttribute('role', 'alert')
    expect(empty.className).not.toMatch(/coral|red/)
  })

  it('shows the empty state when every leg has no steps', () => {
    const legs = makePlan().directions.map((leg) => ({ ...leg, steps: [] }))
    setup(legs)
    expect(screen.getByTestId('directions-empty')).toBeInTheDocument()
  })

  it('reads a missing field as empty, for a trip saved before directions existed', () => {
    render(<Directions directions={undefined} onSelectPoint={() => {}} />)
    expect(screen.getAllByTestId('directions-empty')).toHaveLength(1)
  })
})

describe('text from the API', () => {
  it('renders a hostile road, instruction and title as plain text', () => {
    const base = makePlan().directions
    const directions = base.map((leg, li) => ({
      ...leg,
      title: li === 0 ? `${HOSTILE} to Memphis` : leg.title,
      steps: leg.steps.map((s, si) =>
        li === 0 && si === 1
          ? { ...s, road: HOSTILE, instruction: `Take ${HOSTILE} E` }
          : li === 0 && si === 4
            ? { ...s, instruction: `Arrive at ${HOSTILE}` }
            : s,
      ),
    }))
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    setup(directions)
    const panel = screen.getByTestId('direction-leg-0')
    expect(panel.querySelector('img, script')).toBeNull()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(step(0, 1)).toHaveTextContent(`Take ${HOSTILE} E`)
    expect(step(0, 1)).toHaveTextContent(HOSTILE)
    expect(step(0, 4)).toHaveTextContent(`Arrive at ${HOSTILE}`)
    expect(within(panel).getByRole('heading', { level: 3 })).toHaveTextContent(HOSTILE)
    expect(alert).not.toHaveBeenCalled()
    alert.mockRestore()
  })

  it('treats a hostile road as a street name, not a chip', () => {
    setup(withStep(0, 1, { road: HOSTILE, instruction: `Continue on ${HOSTILE}` }))
    expect(within(step(0, 1)).getByText(HOSTILE)).toHaveAttribute('data-road-kind', 'street')
  })
})
