import { useEffect, useState } from 'react'

const MESSAGES = [
  'Finding the route',
  'Working out drive time',
  'Placing fuel stops and rests',
  'Filling in the log sheets',
]
const STEP_MS = 2200

/** A status line that moves through the planning steps while `active`, and returns null otherwise. */
export function usePlanningMessage(active: boolean): string | null {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setTick((n) => n + 1), STEP_MS)
    return () => {
      window.clearInterval(timer)
      setTick(0)
    }
  }, [active])

  if (!active) return null
  // Stay on the last message instead of looping back, so a slow request does not seem to restart.
  return MESSAGES[Math.min(tick, MESSAGES.length - 1)]
}
