import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff, X } from 'lucide-react'
import { ApiError } from '@/api/client'
import { useRegister, useSignIn } from '@/api/hooks'
import type { User } from '@/api/types'
import { Banner } from '@/components/ui/Banner'
import { Button, IconButton } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { panelId, tabId } from '@/components/ui/tabIds'
import { Tabs, type TabItem } from '@/components/ui/Tabs'

export type AuthMode = 'login' | 'register'

interface AuthDialogProps {
  mode: AuthMode
  /** Shown above the form, for example why the person was asked to sign in. */
  reason?: string
  onModeChange: (mode: AuthMode) => void
  onClose: () => void
  onSuccess: (user: User, mode: AuthMode) => void
}

type FieldName = 'email' | 'password' | 'name'

const TABS: TabItem<AuthMode>[] = [
  { id: 'login', label: 'Sign in', testId: 'tab-auth-login' },
  { id: 'register', label: 'Create account', testId: 'tab-auth-register' },
]

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AuthDialog({ mode, reason, onModeChange, onClose, onSuccess }: AuthDialogProps) {
  const titleId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [errorStamp, setErrorStamp] = useState(0)

  const signIn = useSignIn()
  const register = useRegister()
  const pending = signIn.isPending || register.isPending
  const registering = mode === 'register'

  useEffect(() => {
    if (errorStamp === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errorStamp])

  function switchMode(next: AuthMode) {
    if (next === mode) return
    setFieldErrors({})
    setFormError(null)
    onModeChange(next)
  }

  function fail(errors: Partial<Record<FieldName, string>>, message: string | null) {
    setFieldErrors(errors)
    setFormError(message)
    setErrorStamp((n) => n + 1)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const local: Partial<Record<FieldName, string>> = {}
    if (!email.trim()) local.email = 'Enter your email address.'
    else if (!EMAIL_SHAPE.test(email.trim())) local.email = 'That email address looks incomplete.'
    if (!password) local.password = registering ? 'Choose a password.' : 'Enter your password.'
    if (Object.keys(local).length > 0) {
      fail(local, null)
      return
    }

    setFieldErrors({})
    setFormError(null)
    const handleError = (error: unknown) => {
      if (!(error instanceof ApiError)) {
        fail({}, 'Something went wrong. Try again.')
        return
      }
      const mapped: Partial<Record<FieldName, string>> = {}
      for (const key of ['email', 'password', 'name'] as const) {
        const messages = error.fields[key]
        if (messages?.length) mapped[key] = messages.join(' ')
      }
      fail(mapped, error.message)
    }

    const credentials = { email: email.trim(), password }
    if (registering) {
      register.mutate(
        { ...credentials, name: name.trim() || undefined },
        { onSuccess: (user) => onSuccess(user, 'register'), onError: handleError },
      )
    } else {
      signIn.mutate(credentials, {
        onSuccess: (user) => onSuccess(user, 'login'),
        onError: handleError,
      })
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={titleId} initialFocus={emailRef} testId="auth-dialog">
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div>
          <h2 id={titleId} className="text-xl font-bold text-teal-950">
            {registering ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            {reason ??
              (registering
                ? 'Save trips and open them again from any device.'
                : 'Sign in to save trips and open the ones you saved.')}
          </p>
        </div>
        <IconButton
          aria-label="Close"
          data-testid="btn-auth-close"
          onClick={onClose}
          className="-mt-1 -mr-2"
        >
          <X aria-hidden="true" className="size-5" />
        </IconButton>
      </div>

      <div className="px-6 pt-5">
        <Tabs
          tabs={TABS}
          value={mode}
          onChange={switchMode}
          idBase="auth"
          label="Account"
          variant="segmented"
        />
      </div>

      <div
        role="tabpanel"
        id={panelId('auth', mode)}
        aria-labelledby={tabId('auth', mode)}
        className="overflow-y-auto px-6 pt-5 pb-6"
      >
        <form ref={formRef} noValidate onSubmit={onSubmit} className="space-y-4">
          {formError && (
            <Banner tone="error" testId="auth-error" role="alert">
              {formError}
            </Banner>
          )}
          {registering && (
            <TextField
              id="auth-name"
              data-testid="input-auth-name"
              label="Name"
              optional
              autoComplete="name"
              value={name}
              maxLength={80}
              error={fieldErrors.name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
          <TextField
            ref={emailRef}
            id="auth-email"
            data-testid="input-auth-email"
            label="Email"
            type="email"
            autoComplete={registering ? 'email' : 'username'}
            inputMode="email"
            value={email}
            error={fieldErrors.email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            id="auth-password"
            data-testid="input-auth-password"
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete={registering ? 'new-password' : 'current-password'}
            value={password}
            error={fieldErrors.password}
            hint={
              registering
                ? 'At least 8 characters, and not a common password or all digits.'
                : undefined
            }
            onChange={(event) => setPassword(event.target.value)}
            trailing={
              <IconButton
                size="sm"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                data-testid="btn-toggle-password"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" className="size-[18px]" />
                ) : (
                  <Eye aria-hidden="true" className="size-[18px]" />
                )}
              </IconButton>
            }
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={pending}
            data-testid="btn-auth-submit"
            className="w-full"
          >
            {registering ? 'Create account' : 'Sign in'}
          </Button>
          <p className="text-center text-sm text-ink-600">
            {registering ? 'Already have an account? ' : 'New here? '}
            <button
              type="button"
              onClick={() => switchMode(registering ? 'login' : 'register')}
              className="font-semibold text-teal-700 underline-offset-2 hover:underline"
            >
              {registering ? 'Sign in' : 'Create an account'}
            </button>
          </p>
        </form>
      </div>
    </Modal>
  )
}
