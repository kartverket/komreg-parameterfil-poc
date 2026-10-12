// Komreg movement-row derivation. Pure functions over the working selection; the UI
// passes in the selection, addresses, and the whole-gnr / whole-street decisions made
// on the arbeidsliste.
//
// The rows derived here are turned into the komreg-backend `Regulering` payload by
// `regulering.ts`. That payload is the app's only output — there is no CSV path.
import {
  type SelectedTeig,
  type AddrState,
  type KomregRow,
  type NewValues,
  matrikkelKey,
  gnrKey,
  adressekodeKey,
} from './domain'

// Derive the deduped komreg rows from the working selection.
export function buildKomregRows(
  selected: SelectedTeig[],
  addresses: Record<string, AddrState>,
  wholeGnr: string[],
  wholeAdressekode: string[],
): KomregRow[] {
  const whole = new Set(wholeGnr)
  const wholeKode = new Set(wholeAdressekode)
  const matrikkelenhet: KomregRow[] = []
  // Both address row kinds, in one bucket: a flagged adressekode becomes a `veg`
  // transformasjon, an individual house number a `vegadresse` one.
  const veg: KomregRow[] = []
  const teig: KomregRow[] = []
  const seenMnr = new Set<string>()
  const seenVeg = new Set<string>()
  const seenWholeVeg = new Set<string>()
  const seenKey = new Set<string>()

  for (const s of selected) {
    const p = s.props
    if (p.gardsnummer == null) {
      // No matrikkelnummer → move the teig by id.
      teig.push({
        id: `t:${s.id}`,
        type: 'teig',
        kommunenummer: p.kommunenummer,
        teigid: s.id,
      })
      continue
    }

    // Matrikkelenhet row: when the gnr is flagged "alle", one blank-bnr row per
    // gnr; otherwise one row per distinct gnr/bnr. Address rows are kept either
    // way — komreg still needs the vegadresse parameter.
    const gKey = gnrKey(p)
    const isWhole = !!(gKey && whole.has(gKey))
    const mnrId = isWhole
      ? `${gKey}/all`
      : `${p.kommunenummer}-${p.gardsnummer}/${p.bruksnummer ?? 0}`
    if (!seenMnr.has(mnrId)) {
      seenMnr.add(mnrId)
      matrikkelenhet.push({
        id: `m:${mnrId}`,
        type: 'matrikkelenhet',
        kommunenummer: p.kommunenummer,
        gardsnummer: p.gardsnummer,
        bruksnummer: isWhole ? undefined : (p.bruksnummer ?? 0),
      })
    }

    // Its addresses → one vegadresse row per distinct adressekode+nummer.
    const key = matrikkelKey(p)
    if (!key || seenKey.has(key)) continue
    seenKey.add(key)
    const addr = addresses[key]
    if (!Array.isArray(addr)) continue
    for (const a of addr) {
      if (a.nummer == null) continue
      // A matrikkeladresse carries no adressekode, so there is no street to move and no
      // key to build — without this the row would be keyed "<kommune>-null". The nummer
      // check above happens to catch it today; this says so rather than relying on it.
      if (a.adressekode == null) continue
      const kodeKey = adressekodeKey(p.kommunenummer, a.adressekode)
      // Whole street flagged → one blank-nummer row per adressekode (like
      // isWhole blanks the bnr for a gnr); skip its per-number rows.
      if (wholeKode.has(kodeKey)) {
        if (seenWholeVeg.has(kodeKey)) continue
        seenWholeVeg.add(kodeKey)
        veg.push({
          id: `v:${kodeKey}/all`,
          type: 'veg',
          kommunenummer: p.kommunenummer,
          adressekode: a.adressekode,
          adressenavn: a.adressenavn,
        })
        continue
      }
      const vegId = `${p.kommunenummer}-${a.adressekode}-${a.nummer}`
      if (seenVeg.has(vegId)) continue
      seenVeg.add(vegId)
      veg.push({
        id: `v:${vegId}`,
        type: 'vegadresse',
        kommunenummer: p.kommunenummer,
        adressekode: a.adressekode,
        adressenummer: a.nummer,
        adressenavn: a.adressenavn,
      })
    }
  }

  return [...matrikkelenhet, ...veg, ...teig]
}

// Shift the gårdsnummer of a grensejustering's rows. The target kommune's low gårdsnummer
// are almost always taken — moving 1525's gnr 1-9 into 1578 Fjord lands every one of them
// on an occupied gnr — and the fix is always to shift the whole series by a round number,
// so +200 turns 1, 2, 58 into 201, 202, 258.
//
// Written per row into newValues rather than stored as an offset: resolveTarget already
// reads nyGardsnummer, so this reuses that path instead of adding a resolution rule, and
// every row stays hand-editable afterwards.
//
// Each row is computed from its *own current* gårdsnummer, never from a value already in
// newValues, so pressing the button twice lands on the same numbers rather than shifting a
// shifted series. Only `matrikkelenhet` rows carry a gårdsnummer; a value written onto a
// veg/vegadresse/teig row id would be stored and then silently dropped by resolveTarget,
// which is why the type is the filter here.
export function rowGnrOffsetValues(rows: KomregRow[], offset: number): Record<string, NewValues> {
  const out: Record<string, NewValues> = {}
  for (const r of rows) {
    if (r.type !== 'matrikkelenhet' || r.gardsnummer == null) continue
    out[r.id] = { nyGardsnummer: r.gardsnummer + offset }
  }
  return out
}

// Undo: drop the new gårdsnummer from every matrikkelenhet row, keeping whatever else was
// set on it. A hand-typed bruksnummer or målkommune is somebody's decision, not part of the
// offset.
export function clearedRowGnrValues(
  rows: KomregRow[],
  newValues: Record<string, NewValues>,
): Record<string, NewValues> {
  const out: Record<string, NewValues> = {}
  for (const r of rows) {
    if (r.type !== 'matrikkelenhet') continue
    const nv = newValues[r.id]
    if (nv?.nyGardsnummer == null) continue
    out[r.id] = { ...nv, nyGardsnummer: undefined }
  }
  return out
}

// Effective move target for a numeric field: per-row override, else current.
function effectiveNum(
  nv: NewValues | undefined,
  field: keyof NewValues,
  current: number | undefined,
): number | undefined {
  const v = nv?.[field]
  return typeof v === 'number' ? v : current
}
// Effective new kommune: per-row override, else the batch target.
function effectiveKommune(nv: NewValues | undefined, batch: string): string {
  return nv?.nyKommunenummer || batch
}

// Where one komreg row actually ends up: the per-row overrides resolved against the batch
// kommune and the row's current values. `undefined` on bruksnummer is meaningful — for a
// whole-gnr row it *is* the "alle bruksnummer" instruction, not a missing value, and
// regulering.ts turns it into a transformasjon with no `bruksnummer` map at all.
export interface MoveTarget {
  kommunenummer: string
  gardsnummer?: number
  bruksnummer?: number
  adressekode?: number
  adressenummer?: number
}

// Exported and used by both the Regulering builder (regulering.ts) and the pre-export
// check (validate.ts): the check has to look at the values that will actually be written,
// so the fallback rules live here once instead of being mirrored in two files that drift
// apart.
export function resolveTarget(
  r: KomregRow,
  batchKommune: string,
  newValues: Record<string, NewValues>,
): MoveTarget {
  const nv = newValues[r.id]
  const isMatrikkel = r.type === 'matrikkelenhet'
  const isVeg = r.type === 'vegadresse' || r.type === 'veg'
  return {
    kommunenummer: effectiveKommune(nv, batchKommune),
    // New numeric fields only apply to the row's own type.
    gardsnummer: isMatrikkel ? effectiveNum(nv, 'nyGardsnummer', r.gardsnummer) : undefined,
    bruksnummer: isMatrikkel ? effectiveNum(nv, 'nyBruksnummer', r.bruksnummer) : undefined,
    adressekode: isVeg ? effectiveNum(nv, 'nyAdressekode', r.adressekode) : undefined,
    adressenummer:
      r.type === 'vegadresse' ? effectiveNum(nv, 'nyAdressenummer', r.adressenummer) : undefined,
  }
}
