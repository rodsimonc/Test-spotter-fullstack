import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[inert]') && el.getAttribute('aria-hidden') !== 'true',
  )
}

export interface ModalProps {
  onClose: () => void
  /** Id of the element that names the dialog. */
  labelledBy: string
  children: ReactNode
  variant?: 'dialog' | 'drawer'
  /** Focus lands here on open. Defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>
  testId?: string
  className?: string
}

/**
 * Modal surface with a focus trap, Escape to close, scroll lock and focus return.
 * It renders into document.body and marks the app root inert while open.
 */
export function Modal({
  onClose,
  labelledBy,
  children,
  variant = 'dialog',
  initialFocus,
  testId,
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = document.getElementById('root')
    const previousOverflow = document.body.style.overflow
    const previousPadding = document.body.style.paddingRight
    // Hiding the scrollbar widens the page. Padding by the same amount stops the layout jumping.
    const page = document.documentElement
    const scrollbar = page.clientWidth > 0 ? window.innerWidth - page.clientWidth : 0
    root?.setAttribute('inert', '')
    document.body.style.overflow = 'hidden'
    if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`

    const panel = panelRef.current
    const target = initialFocus?.current ?? (panel ? focusableWithin(panel)[0] : null) ?? panel
    target?.focus()

    return () => {
      root?.removeAttribute('inert')
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPadding
      if (returnTo?.isConnected) returnTo.focus()
    }
    // The trap is set up once per mount. Later prop changes must not steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCloseRef.current()
      return
    }
    if (event.key !== 'Tab' || !panelRef.current) return
    const items = focusableWithin(panelRef.current)
    if (items.length === 0) {
      event.preventDefault()
      panelRef.current.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const isDrawer = variant === 'drawer'

  return createPortal(
    <div
      className={clsx(
        'fixed inset-0 z-[1100] flex animate-fade-in',
        isDrawer ? 'justify-end' : 'items-end justify-center p-0 sm:items-center sm:p-6',
      )}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-teal-950/55 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={onKeyDown}
        className={clsx(
          'relative flex max-h-full flex-col bg-white shadow-[var(--shadow-pop)] outline-none',
          isDrawer
            ? 'h-full w-full max-w-[460px] animate-drawer-in sm:rounded-l-3xl'
            : 'w-full max-w-[440px] animate-pop-in rounded-t-3xl sm:rounded-3xl',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
