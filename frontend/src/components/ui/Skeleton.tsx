import clsx from 'clsx'

/** Decorative placeholder. The surrounding region carries the loading announcement. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx('skeleton', className)} />
}
