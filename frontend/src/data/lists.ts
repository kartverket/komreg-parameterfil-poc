import { API_BASE, apiError } from './http'

// Client for the saved lists. A list is stored with an opaque JSON `data` blob (the
// frontend's working state), so this stays generic.

export interface ListSummary {
  id: number
  name: string
  createdAt: string
  updatedAt: string
}
export interface ListFull<T = unknown> extends ListSummary {
  data: T
}

export async function listLists(): Promise<ListSummary[]> {
  const r = await fetch(`${API_BASE}/lists`)
  if (!r.ok) throw await apiError(r, 'Kunne ikke hente grensejusteringer')
  return r.json()
}

export async function getList<T = unknown>(id: number): Promise<ListFull<T>> {
  const r = await fetch(`${API_BASE}/lists/${id}`)
  if (!r.ok) throw await apiError(r, 'Kunne ikke hente grensejusteringen')
  return r.json()
}

// Both writes return the list's new updatedAt; the next PUT has to send it back.
export async function saveList(
  name: string,
  data: unknown,
): Promise<{ id: number; updatedAt: string }> {
  const r = await fetch(`${API_BASE}/lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data }),
  })
  if (!r.ok) throw await apiError(r, 'Kunne ikke lagre grensejusteringen')
  return r.json()
}

export async function updateList(
  id: number,
  name: string,
  data: unknown,
  expectedUpdatedAt: string,
): Promise<string> {
  const r = await fetch(`${API_BASE}/lists/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data, expectedUpdatedAt }),
  })
  if (!r.ok) throw await apiError(r, 'Kunne ikke oppdatere grensejusteringen')
  return (await r.json()).updatedAt
}

// A list that is a member of a saved regulering is refused (409, `i-bruk`) with the names of
// those reguleringer. `force` is the answer to that: remove it from them and delete it anyway.
export async function deleteList({
  id,
  force = false,
}: {
  id: number
  force?: boolean
}): Promise<void> {
  const r = await fetch(`${API_BASE}/lists/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' })
  if (!r.ok) throw await apiError(r, 'Kunne ikke slette grensejusteringen')
}
