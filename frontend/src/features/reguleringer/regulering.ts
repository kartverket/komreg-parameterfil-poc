// Client + row mapping for the backend's /regulering endpoint, which turns the komreg
// movement rows into komreg-backend's `Regulering` payload (the "parameterfil").
//
// The wire format itself lives in the backend (`no.komreg.regulering`), in Kotlin,
// where komreg-backend's own DTOs can be mirrored type-for-type and the payload can be
// round-tripped through the very same kotlinx decoder komreg-backend uses. Building it
// here in TypeScript would mean maintaining a hand-written imitation of that decoder.
//
// What stays on this side is the decision-making: buildKomregRows and resolveTarget,
// which validate.ts shares so the check and the export can't drift. This module only
// flattens those into the request.
import { API_BASE, apiError } from '@/data/http'
import type { KomregRow, NewValues, ReguleringMeta } from '@/domain/domain'
import { resolveTarget } from '@/domain/komreg'

// One movement, current values plus new. Strings because leading zeros are meaningful
// ("0301") and these end up as strings inside fra/til anyway. Blank `bruksnummer` means the whole gård — that blank
// is the instruction, not a missing value.
export interface RadDTO {
  id: string
  type: KomregRow['type']
  kommunenummer: string
  nyKommunenummer: string
  gardsnummer: string
  bruksnummer: string
  nyGardsnummer: string
  nyBruksnummer: string
  adressekode: string
  nyAdressekode: string
  adressenummer: string
  nyAdressenummer: string
  teigid: string
}

export interface ReguleringFil {
  key: string
  fra: string | null
  til: string | null
  filnavn: string
  antall: Record<string, number>
  // The finished payload, already serialized by kotlinx on the backend. Downloaded
  // verbatim — don't re-serialize it here, or JavaScript starts deciding the format.
  json: string
}

export interface GenererResponse {
  samlet: ReguleringFil
  perPar: ReguleringFil[]
}

const s = (v: string | number | null | undefined) => (v == null ? '' : String(v))

// Flatten one row plus its resolved target into the request shape.
export function buildRad(
  r: KomregRow,
  batchKommune: string,
  newValues: Record<string, NewValues>,
): RadDTO {
  const t = resolveTarget(r, batchKommune, newValues)
  return {
    id: r.id,
    type: r.type,
    kommunenummer: s(r.kommunenummer),
    nyKommunenummer: s(t.kommunenummer),
    gardsnummer: s(r.gardsnummer),
    bruksnummer: s(r.bruksnummer),
    nyGardsnummer: s(t.gardsnummer),
    nyBruksnummer: s(t.bruksnummer),
    adressekode: s(r.adressekode),
    nyAdressekode: s(t.adressekode),
    adressenummer: s(r.adressenummer),
    nyAdressenummer: s(t.adressenummer),
    teigid: s(r.teigid),
  }
}

export interface GenererRequest extends ReguleringMeta {
  rader: RadDTO[]
}

export async function generateRegulering(req: GenererRequest): Promise<GenererResponse> {
  const r = await fetch(`${API_BASE}/regulering`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  // A 400 carries every validation error at once (`feil`, and the same lines in the message):
  // they get fixed in the komreg table, and you want the full list.
  if (!r.ok) throw await apiError(r, 'Kunne ikke generere parameterfil')
  return r.json()
}
