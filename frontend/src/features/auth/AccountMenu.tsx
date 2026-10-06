import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, FolderOpen, LogOut } from 'lucide-react'
import clsx from 'clsx'
import type { User } from '@/api/types'

interface AccountMenuProps {
  user: User
  onOpenTrips: () => void
  onSignOut: () => void
}

function initials(user: User): string {
  const source = user.name.trim() || user.email
  return source.slice(0, 1).toUpperCase()
}

export function AccountMenu({ user, onOpenTrips, onSignOut }: AccountMenuProps) {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const label = user.name.trim() || user.email

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open])

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      items[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      items[items.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        data-testid="account-menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="on-dark flex h-10 max-w-[13rem] items-center gap-2 rounded-xl bg-white/10 py-1 pr-2.5 pl-1.5 text-sm font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/20 sm:max-w-[16rem]"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-mint-200 text-[13px] font-bold text-teal-950"
        >
          {initials(user)}
        </span>
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className={clsx(
            'size-4 shrink-0 text-white/75 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-50 mt-2 w-64 animate-pop-in overflow-hidden rounded-2xl bg-white text-ink-900 shadow-[var(--shadow-pop)] ring-1 ring-ink-200"
        >
          <div className="border-b border-ink-100 px-4 py-3">
            {user.name.trim() && <p className="truncate text-sm font-semibold">{user.name}</p>}
            <p className="truncate text-[13px] text-ink-600">{user.email}</p>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              data-testid="btn-my-trips"
              onClick={() => {
                close()
                onOpenTrips()
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-teal-50 focus-visible:bg-teal-50"
            >
              <FolderOpen aria-hidden="true" className="size-4 text-teal-700" />
              My trips
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="btn-sign-out"
              onClick={() => {
                close()
                onSignOut()
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-coral-50 focus-visible:bg-coral-50"
            >
              <LogOut aria-hidden="true" className="size-4 text-coral-600" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
