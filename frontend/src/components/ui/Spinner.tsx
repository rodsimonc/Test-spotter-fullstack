import { LoaderCircle } from 'lucide-react'
import clsx from 'clsx'

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden="true" className={clsx('animate-spin', className)} />
}
