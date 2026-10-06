import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  bootstrapSession,
  createTrip,
  deleteTrip,
  listTrips,
  login,
  logout,
  register,
  renameTrip,
  searchPlaces,
} from './endpoints'
import type { PlanRequest, TripSummary, User } from './types'

export const queryKeys = {
  session: ['session'] as const,
  trips: ['trips'] as const,
  places: (query: string) => ['places', query] as const,
}

/** Loads the CSRF cookie, then asks who is signed in. A failure reads as signed out. */
export function useSession(): { user: User | null; ready: boolean } {
  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: bootstrapSession,
    staleTime: Infinity,
    retry: false,
  })
  return { user: query.data ?? null, ready: !query.isPending }
}

export function useSignIn() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      client.setQueryData(queryKeys.session, user)
      void client.invalidateQueries({ queryKey: queryKeys.trips })
    },
  })
}

export function useRegister() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: register,
    onSuccess: (user) => {
      client.setQueryData(queryKeys.session, user)
      void client.invalidateQueries({ queryKey: queryKeys.trips })
    },
  })
}

export function useSignOut() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      client.setQueryData(queryKeys.session, null)
      client.removeQueries({ queryKey: queryKeys.trips })
    },
  })
}

/** Debounce the term before calling this. Stays idle below 2 characters. */
export function usePlaceSearch(term: string, enabled: boolean) {
  const clean = term.trim()
  return useQuery({
    queryKey: queryKeys.places(clean),
    queryFn: ({ signal }) => searchPlaces(clean, signal),
    enabled: enabled && clean.length >= 2,
    // Keep the last list on screen while the next one loads, so typing doesn't flash.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useTrips(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.trips,
    queryFn: listTrips,
    enabled,
    retry: false,
  })
}

export function useSaveTrip() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { title?: string; request: PlanRequest }) => createTrip(input),
    onSuccess: () => void client.invalidateQueries({ queryKey: queryKeys.trips }),
  })
}

export function useRenameTrip() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameTrip(id, title),
    onSuccess: (trip) => {
      client.setQueryData<{ results: TripSummary[]; count: number }>(queryKeys.trips, (old) =>
        old
          ? {
              ...old,
              results: old.results.map((t) => (t.id === trip.id ? { ...t, title: trip.title } : t)),
            }
          : old,
      )
    },
  })
}

export function useDeleteTrip() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: deleteTrip,
    onSuccess: (_data, id) => {
      client.setQueryData<{ results: TripSummary[]; count: number }>(queryKeys.trips, (old) =>
        old
          ? { count: Math.max(0, old.count - 1), results: old.results.filter((t) => t.id !== id) }
          : old,
      )
    },
  })
}
