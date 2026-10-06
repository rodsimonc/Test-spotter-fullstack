import type { ComponentProps, ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import clsx from 'clsx'
import { inputClasses } from './inputClasses'

export function FieldLabel({
  htmlFor,
  children,
  optional,
  className,
}: {
  htmlFor?: string
  children: ReactNode
  optional?: boolean
  className?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={clsx(
        'mb-1.5 flex items-baseline gap-1.5 text-[13px] font-semibold text-ink-800',
        className,
      )}
    >
      {children}
      {optional && <span className="text-xs font-normal text-ink-500">optional</span>}
    </label>
  )
}

export function FieldError({
  id,
  testId,
  children,
}: {
  id?: string
  testId?: string
  children: ReactNode
}) {
  if (!children) return null
  return (
    <p
      id={id}
      data-testid={testId}
      role="alert"
      className="mt-1.5 flex items-start gap-1.5 text-[13px] leading-snug font-medium text-coral-700"
    >
      <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

interface TextFieldProps extends Omit<ComponentProps<'input'>, 'className'> {
  label: string
  id: string
  error?: string
  errorTestId?: string
  optional?: boolean
  hint?: string
  className?: string
  /** Rendered inside the right edge of the input, for example a show/hide button. */
  trailing?: ReactNode
}

export function TextField({
  label,
  id,
  error,
  errorTestId,
  optional,
  hint,
  className,
  trailing,
  ...rest
}: TextFieldProps) {
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  // The hint is replaced by the error, so only one of them is on the page to point at.
  const describedBy = error ? errorId : hint ? hintId : undefined
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClasses(Boolean(error), trailing ? 'pr-11' : undefined)}
          {...rest}
        />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-[13px] text-ink-600">
          {hint}
        </p>
      )}
      <FieldError id={errorId} testId={errorTestId}>
        {error}
      </FieldError>
    </div>
  )
}
