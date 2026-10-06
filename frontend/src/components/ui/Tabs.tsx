import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import { panelId, tabId } from './tabIds'

export interface TabItem<T extends string> {
  id: T
  label: string
  icon?: ReactNode
  testId?: string
  /** Small count or note shown after the label. */
  badge?: ReactNode
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Prefix used to build the ids that tie each tab to its panel. */
  idBase: string
  label: string
  variant?: 'underline' | 'segmented'
  className?: string
}

/** Tab strip with roving tabindex and arrow-key navigation. Panels are rendered by the caller. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  idBase,
  label,
  variant = 'underline',
  className,
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null)

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const index = tabs.findIndex((t) => t.id === value)
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = tabs.length - 1
    onChange(tabs[next].id)
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={clsx(
        variant === 'underline' && 'flex gap-1 border-b border-ink-200',
        variant === 'segmented' && 'grid auto-cols-fr grid-flow-col rounded-xl bg-ink-100 p-1',
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            id={tabId(idBase, tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idBase, tab.id)}
            tabIndex={selected ? 0 : -1}
            data-testid={tab.testId}
            onClick={() => onChange(tab.id)}
            className={clsx(
              'inline-flex items-center justify-center gap-2 font-semibold transition-colors duration-150',
              variant === 'underline' &&
                clsx(
                  '-mb-px h-11 border-b-2 px-3 text-sm sm:px-4',
                  selected
                    ? 'border-teal-600 text-teal-950'
                    : 'border-transparent text-ink-600 hover:text-teal-950',
                ),
              variant === 'segmented' &&
                clsx(
                  'h-9 rounded-lg px-3 text-sm',
                  selected
                    ? 'bg-white text-teal-950 shadow-sm'
                    : 'text-ink-600 hover:text-teal-950',
                ),
            )}
          >
            {tab.icon ? (
              // Three labelled tabs don't fit beside their icons on a 390 px phone, so the icons give way.
              <span
                aria-hidden="true"
                className={variant === 'underline' ? 'hidden sm:inline-flex' : 'inline-flex'}
              >
                {tab.icon}
              </span>
            ) : null}
            <span className="whitespace-nowrap">{tab.label}</span>
            {tab.badge}
          </button>
        )
      })}
    </div>
  )
}
