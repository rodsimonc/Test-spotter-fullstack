import { RotateCw } from 'lucide-react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'

export function WarningsBanner({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <Banner
      tone="warning"
      testId="warnings"
      role="status"
      title={warnings.length === 1 ? 'Heads up' : `${warnings.length} things to know`}
    >
      <ul className="mt-1 space-y-1">
        {warnings.map((warning) => (
          <li key={warning} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-700" />
            <span>{warning}</span>
          </li>
        ))}
      </ul>
    </Banner>
  )
}

export function PlanError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner
      tone="error"
      testId="error-banner"
      role="alert"
      title="We couldn't plan that trip"
      action={
        onRetry && (
          <Button
            size="sm"
            variant="secondary"
            data-testid="btn-retry"
            icon={<RotateCw aria-hidden="true" className="size-4" />}
            onClick={onRetry}
          >
            Retry
          </Button>
        )
      }
    >
      <p className="mt-0.5">{message}</p>
    </Banner>
  )
}

/** Placeholder results while the plan is on its way. The message rotates as the work moves along. */
export function ResultsLoading({ message }: { message: string }) {
  return (
    <div
      data-testid="loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-5 rounded-3xl bg-white p-5 shadow-[var(--shadow-card)] ring-1 ring-ink-200 sm:p-6"
    >
      <div className="flex items-center gap-3">
        <Spinner className="size-5 text-teal-600" />
        <p className="text-[15px] font-semibold text-teal-950">{message}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 desk:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[84px]" />
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex gap-3.5">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3.5 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
