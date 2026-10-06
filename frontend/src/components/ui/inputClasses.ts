import clsx from 'clsx'

/** Shared look for text-like inputs and selects. */
export function inputClasses(invalid?: boolean, extra?: string): string {
  return clsx(
    // 16px on phones: iOS Safari zooms the page when a smaller field gets focus.
    'block h-11 w-full rounded-xl bg-white px-3.5 text-base text-ink-900 shadow-[var(--shadow-field)] sm:text-[15px]',
    'ring-1 ring-inset transition-shadow duration-150 placeholder:text-ink-500',
    'hover:ring-ink-400 focus:outline-none focus-visible:outline-none',
    'focus:ring-2 focus:ring-teal-600',
    'disabled:bg-ink-50 disabled:text-ink-500',
    invalid ? 'ring-coral-500 hover:ring-coral-600 focus:ring-coral-600' : 'ring-ink-300',
    extra,
  )
}
