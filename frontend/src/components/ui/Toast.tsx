import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import clsx from 'clsx'

export type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void
}

const ToastContext = createContext<ToastApi | null>(null)
const LIFETIME_MS = 4500

const ICON = { success: CircleCheck, error: CircleAlert, info: Info }
const TONE: Record<ToastKind, string> = {
  success: 'text-teal-700',
  error: 'text-coral-600',
  info: 'text-teal-700',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = nextId.current++
    setItems((current) => [...current.slice(-2), { id, kind, message }])
  }, [])

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[1200] flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6 print:hidden"
        >
          {items.map((item) => (
            <ToastView key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = ICON[item.kind]

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(item.id), LIFETIME_MS)
    return () => window.clearTimeout(timer)
  }, [item.id, onDismiss])

  return (
    <div
      data-testid="toast"
      className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-2xl bg-teal-950 py-3 pr-2 pl-4 text-sm text-white shadow-[var(--shadow-pop)]"
    >
      <span className={clsx('mt-0.5 shrink-0 rounded-full bg-white', TONE[item.kind])}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="min-w-0 flex-1 py-0.5 leading-snug break-words">{item.message}</p>
      <button
        type="button"
        aria-label="Dismiss message"
        onClick={() => onDismiss(item.id)}
        className="on-dark inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/15 hover:text-white"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast needs a ToastProvider above it.')
  return api
}
