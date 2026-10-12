// Read-only client for komreg-backend's own state: what it holds, whether a kjøring is
// running, and which komreg-backend we are pointed at.
//
// Execution is NOT here. A test run starts from its saved regulering
// (`reguleringer.ts` → `POST /reguleringer/{id}/testkjoringer`), so membership, source
// versions and the exact payload are journalled together — ../docs/adr/0004.
//
// Everything goes through our own backend (`/kjoring/*`), never straight at
// komreg-backend: it installs no CORS plugin, and the Entra token has to live
// server-side rather than in the browser. See ../docs/adr/0003 and ../docs/adr/0005.
import { API_BASE, apiError } from './http'

/**
 * `antallEndringer` counts EndringDTOer, and the backend emits one per kommunepar — so it
 * is 1–2 for a grensejustering however big the job is. The size of a kjøring is
 * `antallTransformasjoner`, and what it consists of is `transformasjonerPerType`
 * (type -> count, in payload order). Counted server-side; the full listing is megabytes.
 */
export interface ReguleringSammendrag {
  id: string
  navn: string
  dato: string
  antallEndringer: number
  antallTransformasjoner: number
  transformasjonerPerType: Record<string, number>
}

/**
 * Which komreg-backend the backend is pointed at, and whether it has a token for it.
 *
 * Read from the server rather than a build-time variable: the backend owns the target,
 * and a `VITE_` copy would drift the moment someone restarts with a different
 * `KOMREG_TARGET`.
 */
export interface Miljo {
  navn: string
  url: string
  kreverToken: boolean
  tokenOk: boolean
  tokenFeil?: string
}

export async function fetchMiljo(): Promise<Miljo> {
  const r = await fetch(`${API_BASE}/kjoring/miljo`)
  if (!r.ok) throw await apiError(r, 'Kunne ikke hente miljøet')
  return r.json()
}

export async function fetchKomregReguleringer(): Promise<ReguleringSammendrag[]> {
  const r = await fetch(`${API_BASE}/kjoring/reguleringer`)
  if (!r.ok) throw await apiError(r, 'Kunne ikke hente reguleringer fra komreg-backend')
  return r.json()
}

export async function fetchKjorerNa(): Promise<boolean> {
  const r = await fetch(`${API_BASE}/kjoring/status`)
  if (!r.ok) throw await apiError(r, 'Kunne ikke hente kjøringsstatus')
  return (await r.json()).kjorer
}
