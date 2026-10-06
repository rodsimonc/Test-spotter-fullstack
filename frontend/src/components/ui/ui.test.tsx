import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Banner } from './Banner'
import { Button, IconButton } from './Button'
import { FieldError, TextField } from './Field'
import { Modal } from './Modal'
import { Tabs } from './Tabs'
import { ToastProvider, useToast, type ToastKind } from './Toast'

function ToastButtons({ messages }: { messages: { text: string; kind?: ToastKind }[] }) {
  const toast = useToast()
  return (
    <button type="button" onClick={() => messages.forEach((m) => toast.show(m.text, m.kind))}>
      Show
    </button>
  )
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
  afterEach(() => vi.useRealTimers())

  function setup(messages: { text: string; kind?: ToastKind }[]) {
    render(
      <ToastProvider>
        <ToastButtons messages={messages} />
      </ToastProvider>,
    )
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  }

  it('announces a message politely and gives it a test id', async () => {
    const user = setup([{ text: 'Trip saved.' }])
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByTestId('toast')).toHaveTextContent('Trip saved.')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('goes away by itself after 4.5 seconds', async () => {
    const user = setup([{ text: 'Trip saved.' }])
    await user.click(screen.getByRole('button', { name: 'Show' }))
    act(() => void vi.advanceTimersByTime(4400))
    expect(screen.getByTestId('toast')).toBeInTheDocument()
    act(() => void vi.advanceTimersByTime(200))
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument()
  })

  it('goes away when dismissed', async () => {
    const user = setup([{ text: 'Trip saved.' }])
    await user.click(screen.getByRole('button', { name: 'Show' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument()
  })

  it('keeps only the three newest', async () => {
    const user = setup([{ text: 'One' }, { text: 'Two' }, { text: 'Three' }, { text: 'Four' }])
    await user.click(screen.getByRole('button', { name: 'Show' }))
    const shown = screen.getAllByTestId('toast').map((t) => t.textContent)
    expect(shown).toHaveLength(3)
    expect(shown.join(' ')).not.toContain('One')
    expect(shown.join(' ')).toContain('Four')
  })

  it('shows markup in a message as text', async () => {
    const user = setup([{ text: '<img src=x onerror=alert(1)>', kind: 'error' }])
    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByTestId('toast')).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(screen.getByTestId('toast').querySelector('img')).toBeNull()
  })

  it('refuses to work without a provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useToast())).toThrow('useToast needs a ToastProvider above it.')
    quiet.mockRestore()
  })
})

describe('Button', () => {
  it('defaults to type button so it never submits a form by accident', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' })).toHaveAttribute('type', 'button')
  })

  it('blocks clicks and flags itself busy while loading', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.setup().click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('needs an accessible name on an icon button', () => {
    render(
      <IconButton aria-label="Close">
        <span aria-hidden="true">x</span>
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})

describe('Banner', () => {
  it('shows a title, body and action', () => {
    render(
      <Banner
        tone="warning"
        title="Heads up"
        testId="b"
        action={<button type="button">Fix</button>}
      >
        <p>Something happened.</p>
      </Banner>,
    )
    expect(screen.getByTestId('b')).toHaveTextContent('Heads up')
    expect(screen.getByTestId('b')).toHaveTextContent('Something happened.')
    expect(screen.getByRole('button', { name: 'Fix' })).toBeInTheDocument()
  })
})

describe('Field', () => {
  it('renders nothing for an empty error', () => {
    const { container } = render(<FieldError>{''}</FieldError>)
    expect(container).toBeEmptyDOMElement()
  })

  it('links the label, hint and error to the input', () => {
    const { rerender } = render(<TextField id="x" label="Email" hint="Use your work email." />)
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('aria-describedby')).toBe('x-hint')

    rerender(<TextField id="x" label="Email" hint="Use your work email." error="Required." />)
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    // The error takes the hint's place, so the input points only at what is on the page.
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe('x-error')
    expect(screen.queryByText('Use your work email.')).not.toBeInTheDocument()
  })

  it('marks an optional field', () => {
    render(<TextField id="n" label="Name" optional />)
    expect(screen.getByText('optional')).toBeInTheDocument()
  })
})

describe('Tabs', () => {
  const tabs = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta' },
  ]

  it('marks the active tab and ties each to a panel id', () => {
    render(<Tabs tabs={tabs} value="b" onChange={() => {}} idBase="t" label="Letters" />)
    expect(screen.getByRole('tablist', { name: 'Letters' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-controls')
  })

  it('wraps around with the arrow keys', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} value="b" onChange={onChange} idBase="t" label="Letters" />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Beta' }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith('a')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Beta' }), { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith('a')
  })

  it('ignores other keys', () => {
    const onChange = vi.fn()
    render(<Tabs tabs={tabs} value="a" onChange={onChange} idBase="t" label="Letters" />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'x' })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Modal', () => {
  it('marks the app root inert while open and frees it after', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.append(root)
    const { unmount } = render(
      <Modal onClose={() => {}} labelledBy="t">
        <h2 id="t">Title</h2>
        <button type="button">Inside</button>
      </Modal>,
    )
    expect(root).toHaveAttribute('inert')
    unmount()
    expect(root).not.toHaveAttribute('inert')
    root.remove()
  })

  it('pads the page by the scrollbar width so the layout does not jump', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      get: () => 1009,
    })
    const { unmount } = render(
      <Modal onClose={() => {}} labelledBy="t">
        <h2 id="t">Title</h2>
      </Modal>,
    )
    // jsdom's window is 1024 wide, so the stubbed page leaves 15px for a scrollbar.
    expect(document.body.style.paddingRight).toBe('15px')
    unmount()
    expect(document.body.style.paddingRight).toBe('')
    delete (document.documentElement as { clientWidth?: number }).clientWidth
  })

  it('puts focus on the panel when it has nothing focusable', () => {
    render(
      <Modal onClose={() => {}} labelledBy="t" testId="m">
        <h2 id="t">Title</h2>
      </Modal>,
    )
    expect(screen.getByTestId('m')).toHaveFocus()
  })

  it('keeps Tab on the panel when it has nothing focusable', async () => {
    render(
      <Modal onClose={() => {}} labelledBy="t" testId="m">
        <h2 id="t">Title</h2>
      </Modal>,
    )
    await userEvent.setup().tab()
    expect(screen.getByTestId('m')).toHaveFocus()
  })

  it('uses the latest onClose without reopening', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(
      <Modal onClose={first} labelledBy="t">
        <button type="button">Inside</button>
        <h2 id="t">Title</h2>
      </Modal>,
    )
    rerender(
      <Modal onClose={second} labelledBy="t">
        <button type="button">Inside</button>
        <h2 id="t">Title</h2>
      </Modal>,
    )
    await userEvent.setup().keyboard('{Escape}')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
