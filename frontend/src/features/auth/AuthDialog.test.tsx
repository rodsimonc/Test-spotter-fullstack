import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@/api/types'
import { apiError, deferred, installApi, type Handler } from '@/test/mockApi'
import { renderWithProviders } from '@/test/render'
import { AuthDialog, type AuthMode } from './AuthDialog'

const USER: User = { id: 7, email: 'dana@example.com', name: 'Dana' }

interface HarnessProps {
  initialMode?: AuthMode
  startOpen?: boolean
  reason?: string
  onSuccess?: (user: User, mode: AuthMode) => void
  onClose?: () => void
}

function Harness({
  initialMode = 'login',
  startOpen = true,
  reason,
  onSuccess = () => {},
  onClose,
}: HarnessProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [open, setOpen] = useState(startOpen)
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <AuthDialog
          mode={mode}
          reason={reason}
          onModeChange={setMode}
          onClose={() => {
            onClose?.()
            setOpen(false)
          }}
          onSuccess={onSuccess}
        />
      )}
    </>
  )
}

function setup(props: HarnessProps = {}, routes: Record<string, Handler> = {}) {
  const mock = installApi({
    'GET /api/auth/csrf': { body: { csrf: 'test-csrf' } },
    'POST /api/auth/login': { body: { user: USER } },
    'POST /api/auth/register': { status: 201, body: { user: USER } },
    ...routes,
  })
  renderWithProviders(<Harness {...props} />)
  return { mock, user: userEvent.setup() }
}

const email = () => screen.getByTestId('input-auth-email') as HTMLInputElement
const password = () => screen.getByTestId('input-auth-password') as HTMLInputElement

describe('AuthDialog', () => {
  describe('structure', () => {
    it('is a labelled modal dialog with focus on the email field', () => {
      setup()
      const dialog = screen.getByTestId('auth-dialog')
      expect(dialog).toHaveAttribute('role', 'dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAccessibleName('Welcome back')
      expect(email()).toHaveFocus()
    })

    it('lists the two modes as tabs', () => {
      setup()
      expect(screen.getByRole('tablist', { name: 'Account' })).toBeInTheDocument()
      expect(screen.getByTestId('tab-auth-login')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Sign in')
    })

    it('shows the reason it was opened for', () => {
      setup({ reason: 'Sign in or create an account to save this trip.' })
      expect(
        screen.getByText('Sign in or create an account to save this trip.'),
      ).toBeInTheDocument()
    })

    it('opens straight on the create account tab', () => {
      setup({ initialMode: 'register' })
      expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
      expect(screen.getByTestId('input-auth-name')).toBeInTheDocument()
      expect(screen.getByTestId('btn-auth-submit')).toHaveTextContent('Create account')
      expect(
        screen.getByText('At least 8 characters, and not a common password or all digits.'),
      ).toBeInTheDocument()
    })
  })

  describe('tabs', () => {
    it('switches to create account and adds the name field', async () => {
      const { user } = setup()
      expect(screen.queryByTestId('input-auth-name')).not.toBeInTheDocument()
      await user.click(screen.getByTestId('tab-auth-register'))
      expect(screen.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('input-auth-name')).toBeInTheDocument()
      expect(screen.getByTestId('btn-auth-submit')).toHaveTextContent('Create account')
    })

    it('switches with the link under the form', async () => {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Create an account' }))
      expect(screen.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'true')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
      expect(screen.getByTestId('tab-auth-login')).toHaveAttribute('aria-selected', 'true')
    })

    it('moves between tabs with the arrow keys', async () => {
      const { user } = setup()
      screen.getByTestId('tab-auth-login').focus()
      await user.keyboard('{ArrowRight}')
      expect(screen.getByTestId('tab-auth-register')).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByTestId('tab-auth-register')).toHaveFocus()
      await user.keyboard('{ArrowLeft}')
      expect(screen.getByTestId('tab-auth-login')).toHaveFocus()
    })

    it('keeps what was typed and clears old errors when switching', async () => {
      const { user } = setup()
      await user.click(screen.getByTestId('btn-auth-submit'))
      expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
      await user.type(email(), 'dana@example.com')
      await user.click(screen.getByTestId('tab-auth-register'))
      expect(email()).toHaveValue('dana@example.com')
      expect(screen.queryByText('Enter your email address.')).not.toBeInTheDocument()
    })
  })

  describe('checks before sending', () => {
    it('asks for both fields and sends nothing', async () => {
      const { mock, user } = setup()
      await user.click(screen.getByTestId('btn-auth-submit'))
      expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
      expect(screen.getByText('Enter your password.')).toBeInTheDocument()
      expect(mock.callsTo('POST /api/auth/login')).toHaveLength(0)
    })

    it('moves focus to the first field with a problem', async () => {
      const { user } = setup()
      await user.type(email(), 'dana@example.com')
      await user.click(screen.getByTestId('btn-auth-submit'))
      expect(password()).toHaveFocus()
      expect(password()).toHaveAttribute('aria-invalid', 'true')
    })

    it('words the missing password for the mode', async () => {
      const { user } = setup({ initialMode: 'register' })
      await user.click(screen.getByTestId('btn-auth-submit'))
      expect(screen.getByText('Choose a password.')).toBeInTheDocument()
    })

    it('catches an email without a dot or an at sign', async () => {
      const { mock, user } = setup()
      await user.type(email(), 'dana@example')
      await user.type(password(), 'secret-pass-1')
      await user.click(screen.getByTestId('btn-auth-submit'))
      expect(screen.getByText('That email address looks incomplete.')).toBeInTheDocument()
      expect(email()).toHaveFocus()
      expect(mock.callsTo('POST /api/auth/login')).toHaveLength(0)
    })
  })

  describe('signing in', () => {
    it('posts trimmed credentials with the CSRF header and reports the user', async () => {
      const onSuccess = vi.fn()
      const { mock, user } = setup({ onSuccess })
      await user.type(email(), '  dana@example.com ')
      await user.type(password(), 'secret-pass-1')
      await user.click(screen.getByTestId('btn-auth-submit'))

      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(USER, 'login'))
      const [call] = mock.callsTo('POST /api/auth/login')
      expect(call.body).toEqual({ email: 'dana@example.com', password: 'secret-pass-1' })
      expect(call.headers.get('X-CSRFToken')).toBe('test-csrf')
      expect(call.credentials).toBe('same-origin')
    })

    it('submits with Enter', async () => {
      const onSuccess = vi.fn()
      const { user } = setup({ onSuccess })
      await user.type(email(), 'dana@example.com')
      await user.type(password(), 'secret-pass-1{Enter}')
      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled())
    })

    it('disables the button while the request is out', async () => {
      const pending = deferred<{ body: unknown }>()
      const { user } = setup({}, { 'POST /api/auth/login': () => pending.promise })
      await user.type(email(), 'dana@example.com')
      await user.type(password(), 'secret-pass-1')
      await user.click(screen.getByTestId('btn-auth-submit'))
      expect(screen.getByTestId('btn-auth-submit')).toBeDisabled()
      expect(screen.getByTestId('btn-auth-submit')).toHaveAttribute('aria-busy', 'true')
      pending.resolve({ body: { user: USER } })
      await vi.waitFor(() => expect(screen.getByTestId('btn-auth-submit')).toBeEnabled())
    })

    it('shows a wrong-password message as an alert without naming a field', async () => {
      const onSuccess = vi.fn()
      const { user } = setup(
        { onSuccess },
        {
          'POST /api/auth/login': apiError(
            400,
            'validation_error',
            'That email and password do not match.',
          ),
        },
      )
      await user.type(email(), 'dana@example.com')
      await user.type(password(), 'wrong-pass')
      await user.click(screen.getByTestId('btn-auth-submit'))

      const alert = await screen.findByTestId('auth-error')
      expect(alert).toHaveAttribute('role', 'alert')
      expect(alert).toHaveTextContent('That email and password do not match.')
      expect(onSuccess).not.toHaveBeenCalled()
      expect(email()).not.toHaveAttribute('aria-invalid')
    })

    it('says so when the server is unreachable', async () => {
      const { user } = setup({}, { 'POST /api/auth/login': { networkError: true } })
      await user.type(email(), 'dana@example.com')
      await user.type(password(), 'secret-pass-1')
      await user.click(screen.getByTestId('btn-auth-submit'))
      expect(await screen.findByTestId('auth-error')).toHaveTextContent("Can't reach the server")
    })
  })

  describe('creating an account', () => {
    it('sends the name when given and reports a register success', async () => {
      const onSuccess = vi.fn()
      const { mock, user } = setup({ initialMode: 'register', onSuccess })
      await user.type(screen.getByTestId('input-auth-name'), ' Dana ')
      await user.type(email(), 'dana@example.com')
      await user.type(password(), 'a-long-passphrase')
      await user.click(screen.getByTestId('btn-auth-submit'))
      await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledWith(USER, 'register'))
      expect(mock.callsTo('POST /api/auth/register')[0].body).toEqual({
        email: 'dana@example.com',
        password: 'a-long-passphrase',
        name: 'Dana',
      })
    })

    it('leaves the name out when it is blank', async () => {
      const { mock, user } = setup({ initialMode: 'register' })
      await user.type(email(), 'dana@example.com')
      await user.type(password(), 'a-long-passphrase')
      await user.click(screen.getByTestId('btn-auth-submit'))
      await vi.waitFor(() => expect(mock.callsTo('POST /api/auth/register')).toHaveLength(1))
      expect(mock.callsTo('POST /api/auth/register')[0].body).not.toHaveProperty('name')
    })

    it('puts API field errors under their fields and focuses the first', async () => {
      const { user } = setup(
        { initialMode: 'register' },
        {
          'POST /api/auth/register': apiError(
            400,
            'validation_error',
            'Check the highlighted fields.',
            {
              email: ['An account with that email already exists.'],
              password: ['This password is too common.', 'This password is entirely numeric.'],
            },
          ),
        },
      )
      await user.type(email(), 'dana@example.com')
      await user.type(password(), '12345678')
      await user.click(screen.getByTestId('btn-auth-submit'))

      expect(
        await screen.findByText('An account with that email already exists.'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('This password is too common. This password is entirely numeric.'),
      ).toBeInTheDocument()
      expect(screen.getByTestId('auth-error')).toHaveTextContent('Check the highlighted fields.')
      expect(email()).toHaveAttribute('aria-invalid', 'true')
      expect(password()).toHaveAttribute('aria-invalid', 'true')
      expect(email()).toHaveFocus()
      expect(email().getAttribute('aria-describedby')).toContain('auth-email-error')
    })

    it('shows a name error from the API on the name field', async () => {
      const { user } = setup(
        { initialMode: 'register' },
        {
          'POST /api/auth/register': apiError(
            400,
            'validation_error',
            'Check the highlighted fields.',
            {
              name: ['Names can be at most 80 characters.'],
            },
          ),
        },
      )
      await user.type(email(), 'dana@example.com')
      await user.type(password(), 'a-long-passphrase')
      await user.click(screen.getByTestId('btn-auth-submit'))
      expect(await screen.findByText('Names can be at most 80 characters.')).toBeInTheDocument()
      expect(screen.getByTestId('input-auth-name')).toHaveFocus()
    })
  })

  describe('show and hide password', () => {
    it('toggles the field type and the button name', async () => {
      const { user } = setup()
      const toggle = screen.getByTestId('btn-toggle-password')
      expect(password()).toHaveAttribute('type', 'password')
      expect(toggle).toHaveAccessibleName('Show password')
      expect(toggle).toHaveAttribute('aria-pressed', 'false')

      await user.click(toggle)
      expect(password()).toHaveAttribute('type', 'text')
      expect(toggle).toHaveAccessibleName('Hide password')
      expect(toggle).toHaveAttribute('aria-pressed', 'true')

      await user.click(toggle)
      expect(password()).toHaveAttribute('type', 'password')
    })

    it('does not submit the form', async () => {
      const { mock, user } = setup()
      await user.click(screen.getByTestId('btn-toggle-password'))
      expect(mock.calls).toHaveLength(0)
    })
  })

  describe('closing and focus', () => {
    it('closes on Escape', async () => {
      const onClose = vi.fn()
      const { user } = setup({ onClose })
      await user.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('auth-dialog')).not.toBeInTheDocument()
    })

    it('closes with the close button', async () => {
      const onClose = vi.fn()
      const { user } = setup({ onClose })
      await user.click(screen.getByTestId('btn-auth-close'))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(screen.queryByTestId('auth-dialog')).not.toBeInTheDocument()
    })

    it('closes when the backdrop is clicked, not when the panel is', async () => {
      const onClose = vi.fn()
      const { user } = setup({ onClose })
      await user.click(screen.getByRole('heading', { name: 'Welcome back' }))
      expect(onClose).not.toHaveBeenCalled()
      await user.click(screen.getByTestId('auth-dialog').previousElementSibling as HTMLElement)
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('hands focus back to the button that opened it', async () => {
      const { user } = setup({ startOpen: false })
      const opener = screen.getByTestId('opener')
      await user.click(opener)
      expect(email()).toHaveFocus()
      await user.keyboard('{Escape}')
      expect(opener).toHaveFocus()
    })

    it('wraps Tab from the last control to the first', async () => {
      const { user } = setup()
      screen.getByRole('button', { name: 'Create an account' }).focus()
      await user.tab()
      expect(screen.getByTestId('btn-auth-close')).toHaveFocus()
    })

    it('wraps Shift+Tab from the first control to the last', async () => {
      const { user } = setup()
      screen.getByTestId('btn-auth-close').focus()
      await user.tab({ shift: true })
      expect(screen.getByRole('button', { name: 'Create an account' })).toHaveFocus()
    })

    it('keeps Tab inside the dialog all the way around', async () => {
      const { user } = setup()
      const dialog = screen.getByTestId('auth-dialog')
      for (let i = 0; i < 12; i++) {
        await user.tab()
        expect(dialog).toContainElement(document.activeElement as HTMLElement)
      }
    })

    it('locks page scroll while open and restores it after', async () => {
      const { user } = setup()
      expect(document.body.style.overflow).toBe('hidden')
      await user.keyboard('{Escape}')
      expect(document.body.style.overflow).toBe('')
    })
  })
})
