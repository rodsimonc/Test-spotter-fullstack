import type { ComponentProps, ReactNode } from 'react'
import clsx from 'clsx'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger' | 'onDark'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-coral-600 text-white shadow-[0_8px_18px_-8px_rgb(220_49_72/0.7)] hover:bg-coral-700 active:bg-coral-800 disabled:shadow-none',
  secondary:
    'bg-white text-teal-950 ring-1 ring-inset ring-ink-300 hover:bg-teal-50 hover:ring-teal-600 active:bg-teal-100',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 active:bg-ink-200',
  dark: 'bg-teal-950 text-white hover:bg-teal-900 active:bg-teal-800',
  danger: 'bg-coral-600 text-white hover:bg-coral-700 active:bg-coral-800',
  onDark:
    'bg-white/10 text-white ring-1 ring-inset ring-white/25 hover:bg-white/20 active:bg-white/25',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-9 gap-1.5 rounded-lg px-3 text-[13px]',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-12 gap-2.5 rounded-xl px-5 text-base',
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner, keeps the width and blocks clicks. */
  loading?: boolean
  icon?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap select-none',
        'transition-[background-color,box-shadow,transform,color] duration-150 active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0',
        VARIANT[variant],
        SIZE[size],
        variant === 'onDark' && 'on-dark',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  )
}

export interface IconButtonProps extends ComponentProps<'button'> {
  /** Required: icon-only buttons need a name for screen readers. */
  'aria-label': string
  size?: 'sm' | 'md'
  tone?: 'default' | 'danger' | 'onDark'
}

export function IconButton({
  size = 'md',
  tone = 'default',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'size-8' : 'size-9',
        tone === 'default' && 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 active:bg-ink-200',
        tone === 'danger' &&
          'text-ink-600 hover:bg-coral-50 hover:text-coral-700 active:bg-coral-100',
        tone === 'onDark' && 'on-dark text-white/85 hover:bg-white/15 hover:text-white',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
