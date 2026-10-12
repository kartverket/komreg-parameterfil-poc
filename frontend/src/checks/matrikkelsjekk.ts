// "Sjekk mot matrikkelen": hold a saved selection up against what the open Teig WFS says
// *now*, and report what has gone or changed — never fix it silently.
//
// Why this exists: a saved list is a snapshot (lokalid + matrikkelnummer + geometry).
// Re-fetching only ever finds what exists today, so a teig that was deleted, merged or
// moved to another matrikkelenhet just stops being there, and nothing says so. The
// parameterfil would still name it.
//
// Split in two like validate.ts: `sammenlign` is the pure rule set over a snapshot of
// "now"; `sjekkMotMatrikkelen` only fetches that snapshot. Fetchers are injected so the
// orchestration is testable without a network.
//
// What it cannot tell (data gap — open data has no history): *why* a teig is gone. Merged,
// split, renumbered and deleted all look the same. The nearest we get is "what lies at its
// point now", which is what `kandidater` is.
import GeoJSON from 'ol/format/GeoJSON'
import type Geometry from 'ol/geom/Geometry'
import MultiPolygon from 'ol/geom/MultiPolygon'
import Polygon from 'ol/geom/Polygon'
import { gnrKey, matrikkelKey, WEB_MERCATOR, type SelectedTeig } from '@/domain/domain'
import { fetchGnrTeiger, fetchKommuneTeigerUtenMnr, fetchTeigerVedPunkt } from '@/data/external'

export type AvvikType =
  // lokalid not found any more. `enhetBorte` sharpens it: the matrikkelenhet itself has no
  // teig left either, so the parameterfil names a unit the register no longer draws.
  | 'borte'
  // Same lokalid, but it now belongs to another matrikkelenhet. The export keys rows off
  // the matrikkelenhet, so this changes what would move.
  | 'nyEnhet'
  // A teig on a matrikkelenhet the list moves, that the list doesn't hold — typically one
  // split off since. It moves anyway (komreg moves the unit), but the list and the map
  // don't show it. Not reported for a whole-gnr row: there the list never claimed to hold
  // every bnr, so every unpicked teig of the gård would be a finding.
  | 'ny'

export interface Avvik {
  type: AvvikType
  /** The saved teig. Absent for `ny`. */
  lagret?: SelectedTeig
  /** The teig as the WFS has it now. Absent for `borte`. */
  naa?: SelectedTeig
  enhetBorte?: boolean
  /** For `borte`: teiger now at the saved teig's interior point. */
  kandidater?: SelectedTeig[]
}

export interface Naa {
  /** Current teiger per gnrKey ("kommune-gnr"). A missing key = that lookup failed. */
  gnr: Map<string, SelectedTeig[]>
  /** lokalid of every teig without matrikkelnummer, per kommune. Missing = failed. */
  utenMnr: Map<string, Set<number>>
}

export interface Matrikkelsjekk {
  avvik: Avvik[]
  uendret: number
  /** Saved teiger that could not be checked because their lookup failed. */
  ikkeSjekket: number
  feil: string[]
}

// matrikkelKey leaves out seksjonsnummer; a seksjon is its own matrikkelenhet here. Both
// sources are normalised through toTeigProps, so ?? 0 only papers over null vs absent.
const enhet = (t: SelectedTeig) => `${matrikkelKey(t.props)}/${t.props.seksjonsnummer ?? 0}`

export function sammenlign(lagret: SelectedTeig[], naa: Naa): Omit<Matrikkelsjekk, 'feil'> {
  const avvik: Avvik[] = []
  let uendret = 0,
    ikkeSjekket = 0
  const lagredeIder = new Set(lagret.map((t) => t.id))
  const lagredeEnheter = new Set(lagret.filter((t) => t.props.gardsnummer != null).map(enhet))

  for (const s of lagret) {
    const k = s.props.kommunenummer ?? ''
    const g = gnrKey(s.props)
    if (g == null) {
      // No matrikkelnummer: the row is the teig itself, by lokalid. All we can ask is
      // whether that lokalid is still a teig without one.
      const ider = naa.utenMnr.get(k)
      if (!ider) ikkeSjekket++
      else if (ider.has(s.id)) uendret++
      else avvik.push({ type: 'borte', lagret: s })
      continue
    }
    const teiger = naa.gnr.get(g)
    if (!teiger) {
      ikkeSjekket++
      continue
    }
    const naaTeig = teiger.find((t) => t.id === s.id)
    if (!naaTeig) {
      const e = enhet(s)
      avvik.push({ type: 'borte', lagret: s, enhetBorte: !teiger.some((t) => enhet(t) === e) })
    } else if (enhet(naaTeig) !== enhet(s)) {
      avvik.push({ type: 'nyEnhet', lagret: s, naa: naaTeig })
    } else {
      uendret++
    }
  }

  for (const teiger of naa.gnr.values()) {
    for (const t of teiger) {
      if (!lagredeIder.has(t.id) && lagredeEnheter.has(enhet(t))) avvik.push({ type: 'ny', naa: t })
    }
  }
  return { avvik, uendret, ikkeSjekket }
}

export interface Hentere {
  gnrTeiger: (kommunenummer: string, gardsnummer: number) => Promise<SelectedTeig[]>
  teigerUtenMnr: (kommunenummer: string) => Promise<number[]>
  teigerVedPunkt: (ost: number, nord: number) => Promise<SelectedTeig[]>
}

/** The real lookups. Shared by the arbeidsliste panel and the send confirm. */
export const LIVE_HENTERE: Hentere = {
  gnrTeiger: fetchGnrTeiger,
  teigerUtenMnr: fetchKommuneTeigerUtenMnr,
  teigerVedPunkt: fetchTeigerVedPunkt,
}

// A few lookups at a time: a grunnkrets selection spans dozens of gnr, and the WFS is a
// shared public service. Same reasoning as useAddresses' semaphore.
const SAMTIDIGE = 4

async function iPuljer<T>(oppgaver: (() => Promise<T>)[]): Promise<T[]> {
  const ut: T[] = new Array(oppgaver.length)
  let neste = 0
  async function arbeider() {
    while (neste < oppgaver.length) {
      const i = neste++
      ut[i] = await oppgaver[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(SAMTIDIGE, oppgaver.length) }, arbeider))
  return ut
}

const geoJson = new GeoJSON()

// A point inside the teig, for the "what is here now" lookup. Interior, not centroid: a
// centroid of a concave or multi-part teig can fall outside it, onto a neighbour.
export function innerpunkt(t: SelectedTeig): [number, number] | null {
  let geom: Geometry | null
  try {
    geom = geoJson.readGeometry(t.geometry, WEB_MERCATOR)
  } catch {
    return null
  }
  const [x, y] =
    geom instanceof Polygon
      ? geom.getInteriorPoint().getCoordinates()
      : geom instanceof MultiPolygon
        ? (geom.getInteriorPoints().getCoordinates()[0] ?? [])
        : []
  // An empty ring gives NaN rather than throwing; a lookup at NaN would be a 400 upstream.
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

export async function sjekkMotMatrikkelen(
  lagret: SelectedTeig[],
  hent: Hentere,
): Promise<Matrikkelsjekk> {
  const feil: string[] = []
  const naa: Naa = { gnr: new Map(), utenMnr: new Map() }

  const gnrer = new Map<string, { k: string; g: number }>()
  const utenMnrKommuner = new Set<string>()
  for (const t of lagret) {
    const k = t.props.kommunenummer
    if (!k) continue
    const g = gnrKey(t.props)
    if (g == null) utenMnrKommuner.add(k)
    else gnrer.set(g, { k, g: t.props.gardsnummer! })
  }

  // A failed lookup is recorded and its teiger counted as unchecked — never as gone. "Borte"
  // on a network blip is the one wrong answer this check must not give.
  await iPuljer([
    ...[...gnrer].map(([key, { k, g }]) => async () => {
      try {
        naa.gnr.set(key, await hent.gnrTeiger(k, g))
      } catch (e) {
        console.error(e)
        feil.push(`Gnr ${g} i ${k}: ${(e as Error).message}`)
      }
    }),
    ...[...utenMnrKommuner].map((k) => async () => {
      try {
        naa.utenMnr.set(k, new Set(await hent.teigerUtenMnr(k)))
      } catch (e) {
        console.error(e)
        feil.push(`Teiger uten matrikkelnummer i ${k}: ${(e as Error).message}`)
      }
    }),
  ])

  const resultat = sammenlign(lagret, naa)
  await iPuljer(
    resultat.avvik
      .filter((a) => a.type === 'borte')
      .map((a) => async () => {
        const p = innerpunkt(a.lagret!)
        if (!p) return
        try {
          a.kandidater = await hent.teigerVedPunkt(p[0], p[1])
        } catch (e) {
          // Candidates are a hint; the finding stands without them.
          console.error(e)
        }
      }),
  )
  return { ...resultat, feil }
}

/**
 * One line for the send confirm, or null when there is nothing to say. Only the findings
 * that change what moves count: `ny` teiger move with their unit anyway, so they are the
 * arbeidsliste's business, not a reason to hesitate before sending.
 */
export function oppsummer(liste: string, r: Matrikkelsjekk): string | null {
  const borte = r.avvik.filter((a) => a.type === 'borte').length
  const endret = r.avvik.filter((a) => a.type === 'nyEnhet').length
  const deler = [
    borte && `${borte} borte`,
    endret && `${endret} på en annen matrikkelenhet`,
    r.ikkeSjekket && `${r.ikkeSjekket} kunne ikke sjekkes`,
  ].filter(Boolean)
  return deler.length ? `«${liste}»: ${deler.join(', ')}.` : null
}
