import type { ReactNode } from 'react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import clsx from 'clsx'

type Tone = 'error' | 'warning' | 'info'

const STYLE: Record<Tone, { box: string; icon: string; Icon: typeof Info }> = {
  error: {
    box: 'bg-coral-50 ring-coral-200 text-coral-800',
    icon: 'text-coral-600',
    Icon: CircleAlert,
  },
  warning: {
    box: 'bg-amber-50 ring-amber-300 text-amber-950',
    icon: 'text-amber-700',
    Icon: TriangleAlert,
  },
  info: { box: 'bg-teal-50 ring-teal-200 text-teal-950', icon: 'text-teal-700', Icon: Info },
}

export function Banner({
  tone,
  title,
  children,
  action,
  testId,
  role,
  className,
}: {
  tone: Tone
  title?: string
  children?: ReactNode
  action?: ReactNode
  testId?: string
  role?: 'alert' | 'status'
  className?: string
}) {
  const { box, icon, Icon } = STYLE[tone]
  return (
    <div
      role={role}
      data-testid={testId}
      className={clsx(
        'flex items-start gap-3 rounded-2xl p-4 text-sm ring-1 ring-inset',
        box,
        className,
      )}
    >
      <Icon aria-hidden="true" className={clsx('mt-0.5 size-5 shrink-0', icon)} />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
      {action}
    </div>
  )
}
