// Cadastre domain: the types and pure helpers shared across the map, the
// arbeidsliste tabs, and the komreg export. No React / OpenLayers here.
import type { Geometry as GeoJSONGeometry } from 'geojson'
import { z } from 'zod'

// Read and write GeoJSON in EPSG:3857 (both sides already web-mercator, so no
// reprojection). Shared by the map and the export so a change can't apply to one and
// not the other — a silent coordinate mismatch is invisible until the geometry is wrong.
export const WEB_MERCATOR = { dataProjection: 'EPSG:3857', featureProjection: 'EPSG:3857' }

// Fields we read off each returned Teig feature.
export interface TeigProps {
  lokalid: number
  kommunenummer: string | null
  gardsnummer: number | null
  bruksnummer: number | null
  festenummer: number | null
  seksjonsnummer: number | null
  matrikkelnummertekst: string | null
  meterFraPunkt: number
}

// One selected teig: props for display + its geometry (EPSG:3857 GeoJSON) for
// re-drawing the highlight and exporting.
export interface SelectedTeig {
  id: number
  props: TeigProps
  geometry: GeoJSONGeometry
}

// One address on a matrikkelenhet. `point` is EPSG:3857 [x, y] for a map dot.
//
// `adressekode` is nullable because the register says so: a *matrikkeladresse* — an address
// with no street — arrives with no adressekode at all. It used to be typed `number` behind an
// `as` cast, which meant only the callers that happened to remember
// (validate.ts) guarded it. There is no street to move, so such an address can never become a
// veg/vegadresse komreg row; the type now says that instead of a comment.
export interface AddressInfo {
  adressetekst: string
  adressenavn: string
  nummer: number | null
  bokstav: string
  adressekode: number | null
  point: [number, number] | null
}

export type AddrState = AddressInfo[] | 'loading' | undefined

// A komreg movement row. `id` is a stable key (so per-row new-value edits
// survive re-derivation when the selection changes).
// 'vegadresse' = a single house number; 'veg' = a whole street (blank nummer).
type KomregType = 'matrikkelenhet' | 'vegadresse' | 'veg' | 'teig'
export interface KomregRow {
  id: string
  type: KomregType
  kommunenummer: string | null
  gardsnummer?: number
  bruksnummer?: number
  adressekode?: number
  adressenummer?: number
  teigid?: number
  // The street's name, carried along for the veg/vegadresse rows so the move check can
  // test it against the target kommune — a vegnavn must be unique within a kommune, and
  // adressekode alone can't detect a name that is already taken there under another code.
  adressenavn?: string
}
// Per-row overrides of the move target (defaults: kommune→batch, rest→current).
export interface NewValues {
  nyKommunenummer?: string
  nyGardsnummer?: number
  nyBruksnummer?: number
  nyAdressekode?: number
  nyAdressenummer?: number
}

// Everything we show when inspecting one matrikkelenhet (right-click in the map):
// the clicked teig's parsed + raw API props, all its teiger, all its addresses,
// and the summed area. `loading` is true while teiger/addresses are in flight.
export interface MatrikkelInfo {
  props: TeigProps
  rawProps: Record<string, unknown>
  teiger: SelectedTeig[]
  addresses: AddressInfo[]
  areaM2: number | null
  loading: boolean
}

// Identity of a regulering, as komreg-backend requires it (`Regulering.id/navn/dato`).
// It belongs to the regulering as a whole — the union of the saved lists — not to any
// one list, so it is page state on the regulering view rather than part of WorkingState.
export interface ReguleringMeta {
  id: string
  navn: string
  // Ikrafttredelsesdato, YYYY-MM-DD.
  dato: string
}

// The full working state persisted to / loaded from the backend (JSON blob).
export interface WorkingState {
  selected: SelectedTeig[]
  comments: Record<number, string>
  batchKommune: string
  newValues: Record<string, NewValues>
  // gnrKey()s flagged "move all bnr" → one blank-bnr komreg row per gnr.
  wholeGnr: string[]
  // adressekodeKey()s flagged "move whole street" → one blank-nummer veg row.
  wholeAdressekode: string[]
}

// Runtime schema for a persisted WorkingState, used to validate a list loaded
// from the backend (its `data` blob is opaque JSON). Defaults fill fields that
// older saved lists predate, so adding a field never breaks loading old lists;
// a genuinely malformed blob throws instead of corrupting the app silently.
// Geometry stays near-opaque (z.custom only requires an object) — we hand it
// to OpenLayers, so there's little for us to validate, but a missing geometry
// must fail here rather than crash the map render later.
const teigPropsSchema = z.object({
  lokalid: z.number(),
  kommunenummer: z.string().nullable(),
  gardsnummer: z.number().nullable(),
  bruksnummer: z.number().nullable(),
  festenummer: z.number().nullable(),
  seksjonsnummer: z.number().nullable(),
  matrikkelnummertekst: z.string().nullable(),
  meterFraPunkt: z.number(),
})
const selectedTeigSchema = z.object({
  id: z.number(),
  props: teigPropsSchema,
  geometry: z.custom<GeoJSONGeometry>((v) => typeof v === 'object' && v !== null),
})
const newValuesSchema = z.object({
  nyKommunenummer: z.string().optional(),
  nyGardsnummer: z.number().optional(),
  nyBruksnummer: z.number().optional(),
  nyAdressekode: z.number().optional(),
  nyAdressenummer: z.number().optional(),
})
export const workingStateSchema = z.object({
  selected: z.array(selectedTeigSchema).default([]),
  comments: z.record(z.string(), z.string()).default({}),
  batchKommune: z.string().default(''),
  newValues: z.record(z.string(), newValuesSchema).default({}),
  wholeGnr: z.array(z.string()).default([]),
  wholeAdressekode: z.array(z.string()).default([]),
})

// Which kommuner a saved list touches: where its teiger are now, and where they are
// headed. Derived from the blob alone — no address lookups, no row derivation — so the
// landing screen can label every list without doing the export's work.
//
// A *label*, not the authoritative grouping. The export resolves each row through
// resolveTarget and the backend groups the result into endringer, which can differ from
// this. Returned as two sets rather than pairs on purpose: pairing them would mean
// deriving rows, and guessing a cross product would invent kommunepar that don't exist.
//
// Nothing enforces one kommune per list either — a grunnkrets selection routinely spans
// two, since a krets boundary doesn't stop at a kommune boundary.
export function kommuneScope(ws: WorkingState): { fra: string[]; til: string[] } {
  const fra = new Set<string>()
  for (const t of ws.selected) {
    if (t.props.kommunenummer) fra.add(t.props.kommunenummer)
  }
  const til = new Set<string>()
  for (const v of Object.values(ws.newValues)) {
    if (v.nyKommunenummer) til.add(v.nyKommunenummer)
  }
  // The batch kommune is the default for every row without an override, so it only
  // counts as a destination when something is actually selected to move.
  if (ws.batchKommune && fra.size) til.add(ws.batchKommune)
  return { fra: [...fra].sort(), til: [...til].sort() }
}

// The raw properties bag a teig arrives in, whatever the source. Every field but lokalid is
// nullish because the three sources each omit a different subset: the eiendom API's GeoJSON
// (map click, via OpenLayers feature properties), the geokoding GeoJSON
// (fetchMatrikkelTeiger), and the Teig WFS GML (parseTeigGml).
//
// Deliberately NOT .strict(): OL hands us a `geometry` key and upstream may add fields, and
// neither should break a lookup. Unknown keys are stripped, the same posture as the backend's
// ignoreUnknownKeys. What this does catch is a field that changed *type* or disappeared.
const teigPropsInputSchema = z.object({
  lokalid: z.number(),
  kommunenummer: z.string().nullish(),
  gardsnummer: z.number().nullish(),
  bruksnummer: z.number().nullish(),
  festenummer: z.number().nullish(),
  seksjonsnummer: z.number().nullish(),
  matrikkelnummertekst: z.string().nullish(),
  meterFraPunkt: z.number().nullish(),
})

// Pick the named fields off a raw properties bag (API feature or OL feature).
//
// This is the one choke point every teig passes through from all three sources, which is why
// the gnr-0 normalisation below lives here and not in the parsers — and it is the same reason
// the schema does. One place decides what a teig is allowed to look like.
export function toTeigProps(p: Record<string, unknown>): TeigProps {
  // lokalid is the teig's identity everywhere (selection, comments, saved lists).
  // If the upstream shape ever drifts, fail here — the alternative is undefined ids
  // silently persisted into saved lists.
  const result = teigPropsInputSchema.safeParse(p)
  if (!result.success) {
    // Name the fields: "Teig mangler lokalid" was the only shape drift this used to
    // report, and every other one arrived later as an unrelated crash.
    const felt = result.error.issues.map((i) => i.path.join('.') || '(rot)').join(', ')
    throw new Error(`Teig har uventet form (${felt})`)
  }
  const v = result.data
  // gnr 0 means "no matrikkelnummer" (water, unregistered — "Mnr mangler"). The two
  // sources disagree on how to say it: the eiendom API leaves gardsnummer null, the Teig
  // WFS writes 0. Everything downstream keys off null — buildKomregRows emits a `teig`
  // row instead of a matrikkelenhet one, matrikkelKey skips the address lookup — so
  // normalise at this single choke point rather than in each parser, where a new source
  // would quietly reintroduce bogus 0/0 rows.
  const gardsnummer = v.gardsnummer ?? null
  return {
    lokalid: v.lokalid,
    kommunenummer: v.kommunenummer ?? null,
    gardsnummer: gardsnummer === 0 ? null : gardsnummer,
    bruksnummer: v.bruksnummer ?? null,
    festenummer: v.festenummer ?? null,
    seksjonsnummer: v.seksjonsnummer ?? null,
    matrikkelnummertekst: v.matrikkelnummertekst ?? null,
    meterFraPunkt: v.meterFraPunkt ?? 0,
  }
}

// Build a matrikkelnummer string (gnr/bnr[/fnr][/snr]) from the parts, or fall
// back to the API's ready-made text when there are no parcel numbers.
export function formatMatrikkel(p: TeigProps): string {
  if (p.gardsnummer == null) return p.matrikkelnummertekst ?? '–'
  let s = `${p.gardsnummer}/${p.bruksnummer ?? 0}`
  if (p.festenummer) s += `/${p.festenummer}`
  if (p.seksjonsnummer) s += `/${p.seksjonsnummer}`
  return s
}

// Order teiger by matrikkelnummer: kommune, then gnr, then bnr (then fnr/snr,
// then teig id for a stable tiebreak). Teiger without parcel numbers (null gnr,
// e.g. water) sort last.
export function compareMatrikkel(a: SelectedTeig, b: SelectedTeig): number {
  const pa = a.props
  const pb = b.props
  const kom = (pa.kommunenummer ?? '').localeCompare(pb.kommunenummer ?? '', undefined, {
    numeric: true,
  })
  if (kom) return kom
  const num = (x: number | null) => (x == null ? Infinity : x)
  return (
    num(pa.gardsnummer) - num(pb.gardsnummer) ||
    num(pa.bruksnummer) - num(pb.bruksnummer) ||
    num(pa.festenummer) - num(pb.festenummer) ||
    num(pa.seksjonsnummer) - num(pb.seksjonsnummer) ||
    a.id - b.id
  )
}

// Cache/query key for a teig's addresses: addresses sit on gnr/bnr/fnr (not
// seksjon), and many teiger share one matrikkelnummer — so this dedupes lookups.
// Returns null for teiger without parcel numbers (water / "Mnr mangler").
export function matrikkelKey(p: TeigProps): string | null {
  if (p.gardsnummer == null) return null
  return `${p.kommunenummer}-${p.gardsnummer}/${p.bruksnummer ?? 0}/${p.festenummer ?? 0}`
}

// Key for a gnr-series (kommune+gnr), used to flag "move all bnr" and to key its
// coverage lookup. gnrKey takes a teig; gnrCoverageKey takes the parts, for callers
// that have the numbers but no teig (mirrors adressekodeKey below).
export function gnrCoverageKey(kommunenummer: string | null, gardsnummer: number): string {
  return `${kommunenummer}-${gardsnummer}`
}
export function gnrKey(p: TeigProps): string | null {
  return p.gardsnummer == null ? null : gnrCoverageKey(p.kommunenummer, p.gardsnummer)
}

// Key for a street (kommune+adressekode), used to flag "move the whole veg".
export function adressekodeKey(kommunenummer: string | null, adressekode: number): string {
  return `${kommunenummer}-${adressekode}`
}

// Status badge text: surface "Mnr (vann) mangler" when present, else registered.
export function statusText(p: TeigProps): string {
  if (p.matrikkelnummertekst && /mangler/i.test(p.matrikkelnummertekst)) {
    return p.matrikkelnummertekst
  }
  return 'Registrert'
}

// Matrikkelnummer label, prefixed with kommunenr when there are parcel numbers;
// otherwise the "Mnr (vann) mangler" text (via formatMatrikkel's fallback).
export function matrikkelLabel(p: TeigProps): string {
  return p.gardsnummer != null ? `${p.kommunenummer}-${formatMatrikkel(p)}` : formatMatrikkel(p)
}

// React key for one address row. Its own function only because three components
// render address lists and had drifted into three different formats — one of which
// omitted a separator, so nummer 12 + bokstav "" collided with 1 + "2".
export function addressKey(a: AddressInfo): string {
  return `${a.adressekode}-${a.nummer}-${a.bokstav}`
}
