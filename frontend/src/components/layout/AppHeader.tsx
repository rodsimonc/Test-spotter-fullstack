import { Route } from 'lucide-react'
import type { User } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { AccountMenu } from '@/features/auth/AccountMenu'
import type { AuthMode } from '@/features/auth/AuthDialog'

interface AppHeaderProps {
  user: User | null
  /** False until the first session check finishes, so the buttons do not flicker in. */
  sessionReady: boolean
  onOpenAuth: (mode: AuthMode) => void
  onOpenTrips: () => void
  onSignOut: () => void
}

export function AppHeader({
  user,
  sessionReady,
  onOpenAuth,
  onOpenTrips,
  onSignOut,
}: AppHeaderProps) {
  return (
    <header className="on-dark relative overflow-hidden rounded-b-[50%/28px] bg-teal-950 pb-16 text-white print:hidden sm:pb-[4.5rem]">
      {/* Soft glow and a faint dot grid, so the bar is not a flat slab. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_20rem_at_85%_-30%,rgb(0_128_128/0.55),transparent),radial-gradient(rgb(188_221_222/0.09)_1px,transparent_1.5px)] bg-[length:auto,20px_20px]"
      />
      <div className="relative mx-auto flex max-w-[1760px] items-center justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5 desk:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="hidden size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-mint-200 ring-1 ring-white/20 min-[420px]:inline-flex sm:size-11"
          >
            <Route className="size-5 sm:size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg leading-tight font-bold tracking-tight whitespace-nowrap sm:text-xl">
              Trip Planner
            </h1>
            <p className="hidden text-[13px] leading-tight text-mint-200 sm:block">
              ELD logs and route stops
            </p>
          </div>
        </div>

        <nav aria-label="Account" className="flex shrink-0 items-center gap-2">
          {!sessionReady ? (
            <span
              aria-hidden="true"
              className="block h-10 w-40 animate-pulse rounded-xl bg-white/10"
            />
          ) : user ? (
            <AccountMenu user={user} onOpenTrips={onOpenTrips} onSignOut={onSignOut} />
          ) : (
            <>
              <Button
                variant="onDark"
                size="md"
                data-testid="btn-sign-in"
                className="px-3 sm:px-4"
                onClick={() => onOpenAuth('login')}
              >
                Sign in
              </Button>
              <Button
                size="md"
                data-testid="btn-sign-up"
                className="bg-mint-200 px-3 text-teal-950 hover:bg-white active:bg-teal-100 sm:px-4"
                onClick={() => onOpenAuth('register')}
              >
                Create account
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}
