import { useState } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import clsx from 'clsx'
import { LEGEND_KINDS, ROUTE_COLORS, STOP_KIND_STYLE } from './stopKinds'

function RouteSwatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return (
    <svg aria-hidden="true" width="28" height="8" viewBox="0 0 28 8" className="shrink-0">
      <line
        x1="2"
        y1="4"
        x2="26"
        y2="4"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={dashed ? '1 7' : undefined}
      />
    </svg>
  )
}

export function MapLegend() {
  // Starts closed on phones, where the map is short.
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640)

  return (
    <div
      data-testid="map-legend"
      className="absolute bottom-7 left-3 z-[500] max-w-[calc(100%-1.5rem)] rounded-2xl bg-white/95 text-[13px] shadow-[var(--shadow-card)] ring-1 ring-ink-200 backdrop-blur sm:max-w-[min(38rem,calc(100%-1.5rem))]"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 font-semibold text-ink-800"
      >
        <Layers aria-hidden="true" className="size-4 text-teal-700" />
        Legend
        <ChevronDown
          aria-hidden="true"
          className={clsx('ml-auto size-4 text-ink-500 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-ink-100 px-3 pt-2.5 pb-3">
          <li className="flex items-center gap-2 whitespace-nowrap text-ink-700">
            <RouteSwatch color={ROUTE_COLORS.toPickup} dashed />
            To pickup, empty
          </li>
          <li className="flex items-center gap-2 whitespace-nowrap text-ink-700">
            <RouteSwatch color={ROUTE_COLORS.loaded} />
            To dropoff, loaded
          </li>
          {LEGEND_KINDS.map((kind) => {
            const { label, color, Icon } = STOP_KIND_STYLE[kind]
            return (
              <li key={kind} className="flex items-center gap-2 whitespace-nowrap text-ink-700">
                <span
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-white"
                  style={{ background: color }}
                >
                  <Icon aria-hidden="true" className="size-3" strokeWidth={2.5} />
                </span>
                {label}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
