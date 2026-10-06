import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { ToastProvider } from '@/components/ui/Toast'

export function createTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

/** Renders with the same providers main.tsx sets up. A fresh query cache per call. */
export function renderWithProviders(ui: ReactElement) {
  const client = createTestClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
  return Object.assign(render(ui, { wrapper }), { client })
}
