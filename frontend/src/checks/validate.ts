// Pre-export check of the komreg move targets: does every new value the user typed
// actually land somewhere free in the target kommune? Pure functions over the rows plus a
// bag of facts read out of the registers — no fetching here, so the whole rule set is
// testable without a network or a DOM.
//
// What the checks can and cannot prove:
//
//  * The **address** side is authoritative. Geonorge's adresseregister *is* the register,
//    so "adressekode 10118 is in use in 4601" is a fact. The one blind spot: a veg
//    registered with zero addresses returns nothing and looks free.
//  * The **matrikkel** side is best-effort only, and the wording must keep saying so. No
//    open API confirms a matrikkelenhet exists — the eiendom API is geometry-driven and
//    the authoritative MatrikkelAPI needs applied-for credentials. So a hit in the Teig
//    WFS proves "occupied", but a miss proves nothing (a matrikkelenhet without a teig,
//    e.g. a seksjon, is simply invisible to us). Reporting those as "ledig" would be worse
//    than not checking at all, hence warning/info and never error.
import {
  type KomregRow,
  type NewValues,
  type AddressInfo,
  adressekodeKey,
  gnrCoverageKey,
} from '@/domain/domain'
import { fetchGnrBnr, fetchKommuner, searchAdresser } from '@/data/external'
import { resolveTarget } from '@/domain/komreg'

// 'error'  — we can prove this is wrong (bad format, unknown kommune, occupied adressekode).
// 'warning'— suspicious, or true-but-unprovable (everything matrikkel-side).
// 'info'   — a checked-and-clear confirmation, so a silent row isn't ambiguous.
export type IssueLevel = 'error' | 'warning' | 'info'

export interface KomregIssue {
  rowId: string
  level: IssueLevel
  text: string
}

// Ranges used for the sanity warnings. Deliberately warnings and not errors: these bounds
// are our expectation of Kartverket's, not a published contract, so a legitimate outlier
// must not be reported as an outright error. One place to correct if a real value trips them.
const KOMMUNENUMMER_RE = /^\d{4}$/
const MAX_GNR_BNR = 99999
const ADRESSEKODE_MIN = 1000
const ADRESSEKODE_MAX = 99999
const MAX_ADRESSENUMMER = 9999

// Repeated verbatim so every matrikkel "miss" carries its own caveat — these lines are read
// one row at a time, so a caveat stated once at the top of the table would not travel with them.
const MATRIKKEL_CAVEAT =
  'Åpne API-er kan ikke bekrefte at matrikkelenheten er ledig, kontroller i matrikkelen.'

// Key for the vegnavn lookup. Lives here rather than in domain.ts because the check is its
// only user, and it must normalise the same way on both sides of the comparison.
export function vegnavnKey(kommunenummer: string, navn: string): string {
  return `${kommunenummer}-${navn.trim().toLowerCase()}`
}

// What has to be fetched before the rules can run. Each entry carries its own map key, so
// the caller doing the fetching never re-derives one — the keys stay defined in this file
// alongside the code that reads them back out.
export interface StreetLookup {
  key: string
  kommunenummer: string
  adressekode: number
}
export interface NameLookup {
  key: string
  kommunenummer: string
  navn: string
}
export interface GnrLookup {
  key: string
  kommunenummer: string
  gardsnummer: number
}
export interface LookupPlan {
  streets: StreetLookup[]
  names: NameLookup[]
  gnr: GnrLookup[]
}

// The register facts the rules read. A key being *absent* means "not looked up" (bad
// kommune, or nothing to look up) and every rule skips it — distinct from an empty
// array/set, which is the positive fact "nothing is registered there".
export interface RegisterFacts {
  kommuner: Map<string, string> // kommunenummer → kommunenavn
  street: Map<string, AddressInfo[]> // adressekodeKey → addresses on that code
  streetByName: Map<string, AddressInfo[]> // vegnavnKey → raw search hits (filtered below)
  gnrBnr: Map<string, Set<number>> // gnrCoverageKey → bruksnummer present in the eiendomskart
}

const CHECK_CONCURRENCY = 6

async function inChunks<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CHECK_CONCURRENCY) {
    await Promise.all(items.slice(i, i + CHECK_CONCURRENCY).map(fn))
  }
}

// A target kommune is worth looking things up in only once it's a real kommune — otherwise
// the lookups 400 or return noise, and the kommune issue already explains the row.
function kommuneIsUsable(kommunenummer: string, kommuner: Map<string, string>): boolean {
  return KOMMUNENUMMER_RE.test(kommunenummer) && kommuner.has(kommunenummer)
}

// Every distinct lookup the rows need, deduped: rows sharing a target street or gnr share
// one request. Needs the kommune list up front, so it runs after that single fetch.
export function planLookups(
  rows: KomregRow[],
  batchKommune: string,
  newValues: Record<string, NewValues>,
  kommuner: Map<string, string>,
): LookupPlan {
  const streets = new Map<string, StreetLookup>()
  const names = new Map<string, NameLookup>()
  const gnr = new Map<string, GnrLookup>()

  for (const r of rows) {
    const t = resolveTarget(r, batchKommune, newValues)
    const k = t.kommunenummer
    if (!kommuneIsUsable(k, kommuner)) continue

    if (t.adressekode != null && Number.isInteger(t.adressekode) && t.adressekode > 0) {
      const key = adressekodeKey(k, t.adressekode)
      streets.set(key, { key, kommunenummer: k, adressekode: t.adressekode })
    }
    // The vegnavn travels with the row unchanged — it is the *current* name we are trying
    // to place in the new kommune, so it is never overridden by a "ny" value.
    const navn = r.adressenavn?.trim()
    if (navn) {
      const key = vegnavnKey(k, navn)
      names.set(key, { key, kommunenummer: k, navn })
    }
    if (t.gardsnummer != null && Number.isInteger(t.gardsnummer) && t.gardsnummer > 0) {
      const key = gnrCoverageKey(k, t.gardsnummer)
      gnr.set(key, { key, kommunenummer: k, gardsnummer: t.gardsnummer })
    }
  }
  return { streets: [...streets.values()], names: [...names.values()], gnr: [...gnr.values()] }
}

// "4601 Bergen" when the name is known, else the bare number.
function kommuneLabel(kommunenummer: string, kommuner: Map<string, string>): string {
  const navn = kommuner.get(kommunenummer)
  return navn ? `${kommunenummer} ${navn}` : kommunenummer
}

// Format/range check for one typed number. `undefined` is not an error here — a blank bnr
// on a whole-gnr row is the "alle bruksnummer" instruction, and blank elsewhere just means
// the row keeps its current value.
function numberIssues(
  rowId: string,
  label: string,
  v: number | undefined,
  min: number,
  max: number,
): KomregIssue[] {
  if (v === undefined) return []
  if (!Number.isInteger(v)) return [{ rowId, level: 'error', text: `${label} må være et heltall` }]
  if (v <= 0) return [{ rowId, level: 'error', text: `${label} må være større enn 0` }]
  if (v < min || v > max) {
    return [
      {
        rowId,
        level: 'warning',
        text: `${label} ${v} er utenfor forventet område (${min}–${max})`,
      },
    ]
  }
  return []
}

// Rows landing on the same target as another row in the same list. Pure — no register
// involved; this catches collisions the user creates themselves, which no lookup would see
// because neither number is registered anywhere yet.
function duplicateTargetIssues(
  rows: KomregRow[],
  batchKommune: string,
  newValues: Record<string, NewValues>,
): KomregIssue[] {
  const byTarget = new Map<string, { rowIds: string[]; label: string }>()
  for (const r of rows) {
    const t = resolveTarget(r, batchKommune, newValues)
    const k = t.kommunenummer
    if (!k) continue
    let key: string | null = null
    let label = ''
    if (r.type === 'matrikkelenhet' && t.gardsnummer != null) {
      const bnr = t.bruksnummer ?? 'alle'
      key = `m:${k}-${t.gardsnummer}/${bnr}`
      label = `${k} ${t.gardsnummer}/${bnr}`
    } else if (r.type === 'vegadresse' && t.adressekode != null && t.adressenummer != null) {
      key = `v:${k}-${t.adressekode}-${t.adressenummer}`
      label = `${k} adressekode ${t.adressekode} nr ${t.adressenummer}`
    } else if (r.type === 'veg' && t.adressekode != null) {
      key = `g:${k}-${t.adressekode}`
      label = `${k} adressekode ${t.adressekode} (hele vegen)`
    }
    if (!key) continue
    const hit = byTarget.get(key)
    if (hit) hit.rowIds.push(r.id)
    else byTarget.set(key, { rowIds: [r.id], label })
  }

  const out: KomregIssue[] = []
  for (const { rowIds, label } of byTarget.values()) {
    if (rowIds.length < 2) continue
    for (const rowId of rowIds) {
      out.push({
        rowId,
        level: 'error',
        text: `${rowIds.length} rader flyttes til samme mål (${label})`,
      })
    }
  }
  return out
}

// The veg / vegadresse rules, run only once the target kommune is known-good.
function vegIssues(
  r: KomregRow,
  target: ReturnType<typeof resolveTarget>,
  newValues: Record<string, NewValues>,
  facts: RegisterFacts,
): KomregIssue[] {
  const out: KomregIssue[] = []
  const rowId = r.id
  const k = target.kommunenummer
  const label = kommuneLabel(k, facts.kommuner)
  const kode = target.adressekode
  if (kode == null || !Number.isInteger(kode) || kode <= 0) return out

  const onCode = facts.street.get(adressekodeKey(k, kode))
  if (onCode !== undefined) {
    if (onCode.length > 0) {
      const navn = [...new Set(onCode.map((a) => a.adressenavn))].join(', ')
      if (r.type === 'veg') {
        // Leaving the field blank silently carries the current code into the new kommune.
        // That would create a second veg with the same business key.
        const blank = newValues[rowId]?.nyAdressekode == null
        out.push({
          rowId,
          level: 'error',
          text: blank
            ? `Ingen ny adressekode satt — dagens kode ${kode} følger med og er allerede i bruk i ${label} (${navn})`
            : `Adressekode ${kode} er allerede i bruk i ${label} (${navn})`,
        })
      } else if (r.type === 'vegadresse') {
        // An individual address belongs on the existing target veg; only its house number
        // must be unused.
        const nr = target.adressenummer
        if (nr != null && onCode.some((a) => a.nummer === nr)) {
          out.push({
            rowId,
            level: 'error',
            text: `Nr ${nr} er allerede i bruk på adressekode ${kode} i ${label}`,
          })
        }
      }
    } else {
      out.push({ rowId, level: 'info', text: `Adressekode ${kode} er ledig i ${label}` })
    }
  }

  // A vegnavn must be unique within a kommune, so a free adressekode is not enough when
  // creating a whole veg. A vegadresse instead attaches to the target's existing veg.
  if (r.type !== 'veg') return out
  const navn = r.adressenavn?.trim()
  if (navn) {
    const hits = facts.streetByName.get(vegnavnKey(k, navn))
    if (hits !== undefined) {
      // The upstream search is a broad match ("Storgata" also returns "Storgaten"), so
      // compare the names ourselves rather than trusting a hit to mean a collision.
      const clash = [
        ...new Set(
          hits
            .filter((a) => a.adressenavn.trim().toLowerCase() === navn.toLowerCase())
            .map((a) => a.adressekode)
            // A matrikkeladresse has no code to clash with, and a null would survive a
            // bare `!== kode` and print as "adressekode null".
            .filter((c): c is number => c != null && c !== kode),
        ),
      ]
      if (clash.length) {
        out.push({
          rowId,
          level: 'error',
          text: `Vegnavnet «${navn}» finnes allerede i ${label} (adressekode ${clash.join(', ')})`,
        })
      }
    }
  }
  return out
}

// The matrikkelenhet rules. Everything here is warning/info by construction — see the
// file header for why "not found" can never be reported as proof the number is free.
function matrikkelIssues(
  r: KomregRow,
  target: ReturnType<typeof resolveTarget>,
  facts: RegisterFacts,
): KomregIssue[] {
  const rowId = r.id
  const k = target.kommunenummer
  const label = kommuneLabel(k, facts.kommuner)
  const gnr = target.gardsnummer
  if (gnr == null || !Number.isInteger(gnr) || gnr <= 0) return []

  const bnrSet = facts.gnrBnr.get(gnrCoverageKey(k, gnr))
  if (bnrSet === undefined) return []

  const bnr = target.bruksnummer
  // Blank bnr = "alle bruksnummer under dette gnr", so the whole series must be free.
  if (bnr == null) {
    return bnrSet.size
      ? [
          {
            rowId,
            level: 'warning',
            text: `Gnr ${gnr} i ${label} har allerede ${bnrSet.size} bruksnummer i eiendomskartet`,
          },
        ]
      : [
          {
            rowId,
            level: 'info',
            text: `Gnr ${gnr} ikke funnet i eiendomskartet i ${label}. ${MATRIKKEL_CAVEAT}`,
          },
        ]
  }
  return bnrSet.has(bnr)
    ? [
        {
          rowId,
          level: 'warning',
          text: `${gnr}/${bnr} finnes allerede i eiendomskartet i ${label}`,
        },
      ]
    : [
        {
          rowId,
          level: 'info',
          text: `${gnr}/${bnr} ikke funnet i eiendomskartet i ${label}. ${MATRIKKEL_CAVEAT}`,
        },
      ]
}

// Every issue across the list, in row order. Rows with nothing to say produce nothing.
export function validateKomreg(
  rows: KomregRow[],
  batchKommune: string,
  newValues: Record<string, NewValues>,
  facts: RegisterFacts,
): KomregIssue[] {
  const out: KomregIssue[] = [...duplicateTargetIssues(rows, batchKommune, newValues)]

  for (const r of rows) {
    const t = resolveTarget(r, batchKommune, newValues)
    const k = t.kommunenummer

    // Kommune first: it gates every register lookup below.
    if (!k) {
      out.push({ rowId: r.id, level: 'error', text: 'Ingen ny kommune satt' })
    } else if (!KOMMUNENUMMER_RE.test(k)) {
      out.push({
        rowId: r.id,
        level: 'error',
        text: `Ugyldig kommunenummer «${k}» — må være 4 siffer`,
      })
    } else if (!facts.kommuner.has(k)) {
      out.push({ rowId: r.id, level: 'error', text: `Kommune ${k} finnes ikke` })
    } else if (k === r.kommunenummer) {
      out.push({
        rowId: r.id,
        level: 'warning',
        text: `Ny kommune er den samme som dagens (${k})`,
      })
    }

    // Format checks don't depend on the kommune, so they run even when it's wrong —
    // otherwise fixing the kommune would reveal a second round of errors.
    out.push(...numberIssues(r.id, 'Gårdsnummer', t.gardsnummer, 1, MAX_GNR_BNR))
    out.push(...numberIssues(r.id, 'Bruksnummer', t.bruksnummer, 1, MAX_GNR_BNR))
    out.push(...numberIssues(r.id, 'Adressekode', t.adressekode, ADRESSEKODE_MIN, ADRESSEKODE_MAX))
    out.push(...numberIssues(r.id, 'Adressenummer', t.adressenummer, 1, MAX_ADRESSENUMMER))

    if (!kommuneIsUsable(k, facts.kommuner)) continue
    out.push(...vegIssues(r, t, newValues, facts))
    out.push(...matrikkelIssues(r, t, facts))
  }
  return out
}

// Fetch the live register facts immediately before an export or send. A result is deliberately
// not persisted: a saved list must be checked again against the register as it exists now.
export async function checkKomreg(
  rows: KomregRow[],
  batchKommune: string,
  newValues: Record<string, NewValues>,
): Promise<KomregIssue[]> {
  const kommuner = await fetchKommuner()
  const plan = planLookups(rows, batchKommune, newValues, kommuner)

  const street = new Map<string, AddressInfo[]>()
  const streetByName = new Map<string, AddressInfo[]>()
  const gnrBnr = new Map<string, Set<number>>()
  await inChunks(plan.streets, async (l) => {
    street.set(l.key, await searchAdresser(l.kommunenummer, { adressekode: l.adressekode }))
  })
  await inChunks(plan.names, async (l) => {
    streetByName.set(l.key, await searchAdresser(l.kommunenummer, { sok: l.navn }))
  })
  await inChunks(plan.gnr, async (l) => {
    gnrBnr.set(l.key, await fetchGnrBnr(l.kommunenummer, l.gardsnummer))
  })

  return validateKomreg(rows, batchKommune, newValues, { kommuner, street, streetByName, gnrBnr })
}

// The inputs the check ran against. Compared with the live values so an edit made after a
// check turns the result stale instead of leaving a reassuring all-clear on screen that no
// longer describes what would be exported. Includes the row ids, since changing the
// selection changes which rows the counts refer to. A false "stale" only costs a re-run;
// a false "fresh" is the failure this exists to prevent.
export function checkSnapshot(
  rows: KomregRow[],
  batchKommune: string,
  newValues: Record<string, NewValues>,
): string {
  return JSON.stringify({ rows: rows.map((r) => r.id), batchKommune, newValues })
}

// Issues grouped by row, for rendering one cell per row.
export function issuesByRow(issues: KomregIssue[]): Map<string, KomregIssue[]> {
  const out = new Map<string, KomregIssue[]>()
  for (const i of issues) {
    const list = out.get(i.rowId)
    if (list) list.push(i)
    else out.set(i.rowId, [i])
  }
  return out
}

// Error/warning counts for the header summary. Info lines are confirmations, not problems,
// so they're deliberately not counted.
export function countIssues(issues: KomregIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warning').length,
  }
}
