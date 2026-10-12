import { queryOptions } from '@tanstack/react-query'
import { getRegulering, getTestRunPayload, listReguleringer, listTestRuns } from './reguleringer'

// The saved reguleringer as server state. The keys nest on purpose: everything about one
// regulering sits under `reguleringQuery(id)`, so invalidating that after a save also
// refreshes its test runs.

/** Prefix of both overview variants (with and without the archived ones). */
export const REGULERINGER_KEY = ['reguleringer'] as const

export const reguleringerQuery = (archived: boolean) =>
  queryOptions({
    queryKey: [...REGULERINGER_KEY, archived],
    queryFn: () => listReguleringer(archived),
  })

export const reguleringQuery = (id: number) =>
  queryOptions({ queryKey: ['regulering', id], queryFn: () => getRegulering(id) })

export const testRunsQuery = (id: number) =>
  queryOptions({ queryKey: ['regulering', id, 'runs'], queryFn: () => listTestRuns(id) })

/** The parameterfil one test run sent. `runId` is null while no run is opened for review. */
export const testRunPayloadQuery = (id: number, runId: number | null) =>
  queryOptions({
    queryKey: ['regulering', id, 'runs', runId, 'payload'],
    queryFn: () => getTestRunPayload(id, runId!),
    enabled: runId != null,
    // A stored payload never changes (the row is immutable once written).
    staleTime: Infinity,
  })
