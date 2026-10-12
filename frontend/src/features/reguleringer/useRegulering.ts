import type { QueryClient } from '@tanstack/react-query'
import { getList, type ListSummary } from '@/data/lists'
import {
  type WorkingState,
  compareMatrikkel,
  type KomregRow,
  type NewValues,
  workingStateSchema,
} from '@/domain/domain'
import { buildKomregRows } from '@/domain/komreg'
import { downloadText } from '@/lib/download'
import { buildRad, type RadDTO, type ReguleringFil } from './regulering'
import { fetchAddressesFor } from '@/data/useAddresses'
import { LIVE_HENTERE, oppsummer, sjekkMotMatrikkelen } from '@/checks/matrikkelsjekk'
import { checkKomreg } from '@/checks/validate'

// The movement rows of one saved list, resolved against *its own* batch kommune and
// per-row overrides — those are per list, so they have to be applied before the rows
// from different lists are pooled.
//
// This repeats what the map shell does live (read the working state, resolve the
// addresses, derive the rows) but against a list fetched on demand rather than the
// store. Same functions, so the two paths can't disagree about what a list contains.
export interface ResolvedListRows {
  rows: RadDTO[]
  checkRows: KomregRow[]
  batchKommune: string
  newValues: Record<string, NewValues>
  updatedAt: string
  name: string
}

export async function rowsForList(
  summary: ListSummary,
  queryClient: QueryClient,
): Promise<ResolvedListRows> {
  const full = await getList(summary.id)
  // The blob is opaque to the backend; the schema is ours to enforce. A list that no
  // longer parses is a different problem from an unreachable backend, so let it throw
  // with its own message rather than folding into a generic failure.
  const ws = workingStateSchema.parse(full.data) as WorkingState
  const sorted = [...ws.selected].sort(compareMatrikkel)
  const addresses = await fetchAddressesFor(sorted, queryClient)
  // Derived the same way as in the live session (useExports).
  const checkRows = buildKomregRows(sorted, addresses, ws.wholeGnr, ws.wholeAdressekode)
  return {
    rows: checkRows.map((r) => buildRad(r, ws.batchKommune, ws.newValues)),
    checkRows,
    batchKommune: ws.batchKommune,
    newValues: ws.newValues,
    updatedAt: full.updatedAt,
    name: full.name,
  }
}

// What a preview or a test run is made from: the rows of every chosen list pooled, which
// version of each list they came from, and each list's own rows for the move check.
export interface ResolvedLists {
  rows: RadDTO[]
  sources: { listId: number; name: string; updatedAt: string }[]
  checks: Pick<ResolvedListRows, 'name' | 'checkRows' | 'batchKommune' | 'newValues'>[]
}

export async function resolveLists(
  chosen: ListSummary[],
  queryClient: QueryClient,
): Promise<ResolvedLists> {
  const values = await Promise.all(chosen.map((l) => rowsForList(l, queryClient)))
  return {
    rows: values.flatMap((v) => v.rows),
    sources: chosen.map((l, i) => ({
      listId: l.id,
      name: values[i].name,
      updatedAt: values[i].updatedAt,
    })),
    checks: values,
  }
}

// The same, refused if the move check finds an error in any list. Every error from every
// list in one message: they are fixed in the komreg table, and you want the full list.
export async function resolveAndCheckLists(
  chosen: ListSummary[],
  queryClient: QueryClient,
): Promise<ResolvedLists> {
  const d = await resolveLists(chosen, queryClient)
  const findings = await Promise.all(
    d.checks.map(async (check) => ({
      name: check.name,
      issues: await checkKomreg(check.checkRows, check.batchKommune, check.newValues),
    })),
  )
  const errors = findings.flatMap(({ name, issues }) =>
    issues.filter((issue) => issue.level === 'error').map((issue) => `«${name}»: ${issue.text}`),
  )
  if (errors.length) {
    throw new Error(
      `Parameterfilen kan ikke lages før disse feilene er rettet:\n${errors.join('\n')}`,
    )
  }
  return d
}

// The matrikkel check, run on the chosen lists as they are SAVED (the run sends saved
// versions), as one more paragraph in the send confirm. A warning, never a gate: the open
// data can be wrong or behind, and the person sending is the one who knows the vedtak. A
// list that can't be checked says so instead of passing silently. ADR-0007.
export async function matrikkelAdvarsel(chosen: ListSummary[]): Promise<string> {
  const linjer = await Promise.all(
    chosen.map(async (l) => {
      try {
        const ws = workingStateSchema.parse((await getList(l.id)).data)
        return oppsummer(l.name, await sjekkMotMatrikkelen(ws.selected, LIVE_HENTERE))
      } catch (e) {
        console.error(e)
        return `«${l.name}»: kunne ikke sjekkes (${(e as Error).message}).`
      }
    }),
  )
  const funn = linjer.filter(Boolean)
  return funn.length
    ? `Matrikkelen har endret seg siden lista ble lagret — ${funn.join(' ')} Se «Sjekk mot matrikkelen» på arbeidslista.`
    : ''
}

// The payload is downloaded exactly as kotlinx serialized it on the backend.
export function downloadFile(fil: ReguleringFil) {
  downloadText(fil.filnavn, fil.json, 'application/json')
}
