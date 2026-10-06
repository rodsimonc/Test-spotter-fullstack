import { useEffect, useRef, useState } from 'react'

/**
 * Width of an element in CSS pixels, kept current with a ResizeObserver.
 * Stays null until the browser reports a real size, which is also what happens in jsdom.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = entries[entries.length - 1]?.contentRect.width ?? 0
      setWidth(next > 0 ? Math.round(next) : null)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, width] as const
}
