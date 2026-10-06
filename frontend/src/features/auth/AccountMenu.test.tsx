import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppHeader } from '@/components/layout/AppHeader'
import { makeUser } from '@/test/makePlan'
import { AccountMenu } from './AccountMenu'

function setup(user = makeUser()) {
  const onOpenTrips = vi.fn()
  const onSignOut = vi.fn()
  render(<AccountMenu user={user} onOpenTrips={onOpenTrips} onSignOut={onSignOut} />)
  return {
    onOpenTrips,
    onSignOut,
    user: userEvent.setup(),
    trigger: screen.getByTestId('account-menu'),
  }
}

describe('AccountMenu', () => {
  it('shows the name on the trigger and starts closed', () => {
    const { trigger } = setup()
    expect(trigger).toHaveTextContent('Dana Driver')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('falls back to the email when there is no name', () => {
    const { trigger } = setup(makeUser({ name: '  ' }))
    expect(trigger).toHaveTextContent('driver@example.com')
  })

  it('opens with the first item focused and names the account inside', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(menu).toHaveTextContent('Dana Driver')
    expect(menu).toHaveTextContent('driver@example.com')
    expect(screen.getByTestId('btn-my-trips')).toHaveFocus()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'My trips',
      'Sign out',
    ])
  })

  it('shows only the email line when there is no name', async () => {
    const { user, trigger } = setup(makeUser({ name: '' }))
    await user.click(trigger)
    expect(screen.getByRole('menu').querySelectorAll('p')).toHaveLength(1)
  })

  it('moves between items with arrows, Home and End, and wraps', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('btn-sign-out')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('btn-my-trips')).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByTestId('btn-sign-out')).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByTestId('btn-my-trips')).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByTestId('btn-sign-out')).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes when the pointer goes down outside it', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('stays open for a pointer press inside the menu', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    fireEvent.pointerDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('closes when focus tabs out', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('toggles from the trigger', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('opens My trips and closes the menu', async () => {
    const { user, trigger, onOpenTrips } = setup()
    await user.click(trigger)
    await user.click(screen.getByTestId('btn-my-trips'))
    expect(onOpenTrips).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('signs out and closes the menu', async () => {
    const { user, trigger, onSignOut } = setup()
    await user.click(trigger)
    await user.click(screen.getByTestId('btn-sign-out'))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

describe('AppHeader', () => {
  const handlers = () => ({ onOpenAuth: vi.fn(), onOpenTrips: vi.fn(), onSignOut: vi.fn() })

  it('names the product', () => {
    render(<AppHeader user={null} sessionReady {...handlers()} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Trip Planner' })).toBeInTheDocument()
    expect(screen.getByText('ELD logs and route stops')).toBeInTheDocument()
  })

  it('shows neither buttons nor the menu until the session check finishes', () => {
    render(<AppHeader user={null} sessionReady={false} {...handlers()} />)
    expect(screen.queryByTestId('btn-sign-in')).not.toBeInTheDocument()
    expect(screen.queryByTestId('btn-sign-up')).not.toBeInTheDocument()
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it('offers sign in and create account when signed out', async () => {
    const props = handlers()
    render(<AppHeader user={null} sessionReady {...props} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('btn-sign-in'))
    expect(props.onOpenAuth).toHaveBeenLastCalledWith('login')
    await user.click(screen.getByTestId('btn-sign-up'))
    expect(props.onOpenAuth).toHaveBeenLastCalledWith('register')
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it('shows the account menu when signed in', () => {
    render(<AppHeader user={makeUser()} sessionReady {...handlers()} />)
    expect(screen.getByTestId('account-menu')).toBeInTheDocument()
    expect(screen.queryByTestId('btn-sign-in')).not.toBeInTheDocument()
  })
})
