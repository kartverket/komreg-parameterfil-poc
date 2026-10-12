import { API_BASE, apiError } from '@/data/http'
import type { RadDTO } from './regulering'

export interface SavedReguleringSummary {
  id: number
  baseId: string
  navn: string
  dato: string
  listCount: number
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  latestRunStatus: string | null
}

export interface SavedRegulering {
  id: number
  baseId: string
  navn: string
  dato: string
  listIds: number[]
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RunSource {
  listId: number
  name: string
  updatedAt: string
}

export interface TestRun {
  id: number
  externalId: string
  status: string
  sources: RunSource[]
  sendStatus: number | null
  sendMessage: string | null
  startStatus: number | null
  startMessage: string | null
  createdAt: string
  updatedAt: string
}

// What a run's `status` is called on the page. An unknown one is shown as it came.
export const RUN_STATUS_TEXT: Record<string, string> = {
  prepared: 'Klargjort',
  sent: 'Sendt, ikke startet',
  send_rejected: 'Sending avvist',
  send_unknown: 'Ukjent etter sending',
  start_rejected: 'Start avvist',
  start_unknown: 'Ukjent etter start',
  start_accepted: 'Start akseptert',
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, init)
  if (!response.ok) throw await apiError(response, `Kallet feilet (${response.status})`)
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const listReguleringer = (archived = false) =>
  json<SavedReguleringSummary[]>(`/reguleringer${archived ? '?arkiverte=1' : ''}`)

export const getRegulering = (id: number) => json<SavedRegulering>(`/reguleringer/${id}`)

export async function createRegulering(input: {
  navn: string
  dato: string
  listIds: number[]
}): Promise<number> {
  const result = await json<{ id: number }>('/reguleringer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return result.id
}

export const updateRegulering = (
  id: number,
  input: Omit<SavedRegulering, 'id' | 'archivedAt' | 'createdAt'>,
) =>
  json<unknown>(`/reguleringer/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, expectedUpdatedAt: input.updatedAt }),
  })

export const setReguleringArchived = (id: number, archived: boolean) =>
  json<unknown>(`/reguleringer/${id}/${archived ? 'arkiver' : 'gjenopprett'}`, { method: 'POST' })

export const listTestRuns = (id: number) => json<TestRun[]>(`/reguleringer/${id}/testkjoringer`)

// Both calls that put something into komreg-backend say which one the user was shown
// (`expectedKomregUrl`). The backend refuses when it is pointed somewhere else.
export const startTestRun = (
  id: number,
  input: {
    expectedKomregUrl: string
    expectedReguleringUpdatedAt: string
    sources: RunSource[]
    rader: RadDTO[]
    // false = send to komreg-backend only; the row stays in `sent` until startSentRun.
    start: boolean
  },
) =>
  json<TestRun>(`/reguleringer/${id}/testkjoringer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

export const startSentRun = (reguleringId: number, runId: number, expectedKomregUrl: string) =>
  json<TestRun>(`/reguleringer/${reguleringId}/testkjoringer/${runId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedKomregUrl }),
  })

export function testRunPayloadUrl(reguleringId: number, runId: number): string {
  return `${API_BASE}/reguleringer/${reguleringId}/testkjoringer/${runId}/payload`
}

// The stored payload as text, for the review view. Same URL as the download; the string is
// read, never re-serialized.
export async function getTestRunPayload(reguleringId: number, runId: number): Promise<string> {
  const response = await fetch(testRunPayloadUrl(reguleringId, runId))
  if (!response.ok) {
    throw await apiError(response, `Kunne ikke hente parameterfila (${response.status})`)
  }
  return response.text()
}
