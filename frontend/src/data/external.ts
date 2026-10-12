// External Norwegian geodata services (Kartverket + Geonorge). These return
// plain data / config; the map (OpenLayers) and the backend client live
// elsewhere. All endpoints are public — no API keys.
import type { Geometry as GeoJSONGeometry, Position } from 'geojson'
import { z } from 'zod'
import { toTeigProps, type TeigProps, type SelectedTeig, type AddressInfo } from '@/domain/domain'

// The address/teig lookups below go through our backend, which proxies the upstream
// (Geonorge/Kartverket) and returns the payload unchanged — nothing is stored, so every
// call is fresh. Map tiles/WMS (TOPO/ADM/KRETS) and the point lookup hit the services
// directly.
import { API_BASE as BASE } from './http'
import { extentOf } from '@/lib/utils'

// --- Response validation ------------------------------------------------------------
//
// Everything below that comes back as JSON is checked against a schema before it is used.
// It used to be `as`-cast: an upstream that dropped a field or changed its type surfaced as
// a crash three layers down, or worse, as a row with `undefined` in a parameterfil that runs
// against Matrikkelen. Validating here is the same call as deleting the geo cache — this
// app's output is a real matrikkel regulering, so a wrong answer is worse than no answer.
//
// One helper so the failure reads the same everywhere, the way upstream() in the backend's
// GeoRoutes.kt collapses every upstream fault in one place. Every fetch below already
// throws on !res.ok and every consumer already handles a thrown error, so this needs no
// new error path — but the *message* says "wrong shape", not "unreachable", because the
// two are debugged completely differently.
function parsed<S extends z.ZodTypeAny>(schema: S, data: unknown, what: string): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    console.error(`${what}: uventet svarformat`, result.error)
    throw new Error(`Uventet svarformat fra ${what} — tjenesten kan ha endret seg`)
  }
  return result.data
}

// None of the schemas below are .strict(). Unknown keys are stripped, so Geonorge adding a
// field is a non-event — the same posture as the backend's ignoreUnknownKeys. What they
// catch is a field that vanished or changed type.

// Geonorge's address search, shared by every /geo route that returns adresser: the teig
// lookup and the two searches. `adressekode` and `nummer` are
// optional because a matrikkeladresse (an address with no street) genuinely has neither.
const adresseSchema = z.object({
  adressetekst: z.string().nullish(),
  adressenavn: z.string().nullish(),
  nummer: z.number().nullish(),
  bokstav: z.string().nullish(),
  adressekode: z.number().nullish(),
  representasjonspunkt: z.object({ lat: z.number(), lon: z.number() }).nullish(),
})
const adresseSokSchema = z.object({
  adresser: z.array(adresseSchema).nullish(),
  // fetchAllAdresser pages until it holds this many; a missing one stops after one page.
  metadata: z.object({ totaltAntallTreff: z.number().nullish() }).nullish(),
})

// Kartverket topo cache (color topographic basemap), Web Mercator tiles.
// Swap `topo` for topograatone | toporaster | sjokartraster to change basemap.
export const TOPO_URL =
  'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png'

// Geonorge administrative units WMS. Layers: fylker_gjel (counties),
// kommuner_gjel (municipalities). Supports EPSG:3857, so it overlays directly.
const ADM_WMS_URL = 'https://wms.geonorge.no/skwms1/wms.adm_enheter2'

// Toggleable statistical "krets" WMS overlays. Each is zoom-gated (minZoom) so
// fine-grained layers only appear when zoomed in. Add more entries to grow this.
interface KretsLayer {
  id: string
  label: string
  url: string
  layers: string
  minZoom: number
  /**
   * Optional CSS class on the OL tile layer. Setting one gives the layer its own canvas
   * element, so index.css can filter *that layer alone* — the only way to restyle a WMS
   * raster, since the server offers no alternative STYLES.
   */
  className?: string
  /**
   * Extra WMS layers drawn only from `labelMinZoom` up, under the same checkbox. For
   * label layers whose server-side scale limit is looser than what is actually readable:
   * showing them as early as the server allows turns the map into a wall of text.
   */
  labelLayers?: string
  labelMinZoom?: number
}
export const KRETS_LAYERS: KretsLayer[] = [
  {
    id: 'fylke',
    label: 'Fylkesgrenser',
    url: ADM_WMS_URL,
    layers: 'fylker_gjel',
    // Fylke borders are coarse — fine to show at any zoom.
    minZoom: 0,
  },
  {
    id: 'kommune',
    label: 'Kommunegrenser',
    url: ADM_WMS_URL,
    layers: 'kommuner_gjel',
    // Kommune borders clutter the national view; only reveal past ~7.
    minZoom: 7,
  },
  {
    id: 'grunnkrets',
    label: 'Grunnkrets',
    url: 'https://wms.geonorge.no/skwms1/wms.grunnkretser',
    layers: 'Grunnkretser,Grunnkretsnummer',
    // The grunnkrets layer also draws kommune/fylke reference borders, so at low
    // zoom it just looks like kommune lines — gate it to where the small
    // grunnkrets polygons are actually distinguishable.
    minZoom: 11,
  },
  {
    id: 'eiendom',
    label: 'Eiendomsgrenser',
    // "Matrikkelen Enkel WMS" (MapServer, open, no key) — teig boundaries plus the
    // Gnr/Bnr/Fnr label per parcel. This is how you *see* the matrikkelenheter; the app
    // owns no geometry from it, which is the whole reason it costs nothing.
    //
    // wms.matrikkel and not wms.matrikkelkart: both serve the same boundary lines to
    // 1:40 000, but matrikkelkart holds its matrikkelnummer labels back to 1:5 000, where
    // this service's eiendoms_id is available from 1:40 000 — so we get to choose the zoom
    // they appear at (see labelMinZoom) instead of being given one.
    url: 'https://wms.geonorge.no/skwms1/wms.matrikkel',
    layers: 'eiendomsgrense',
    // The Gnr/Bnr labels are served from 1:40 000 like the lines, but at that scale every
    // parcel in view gets one and the map is unreadable text. Held back to zoom 15, where
    // there are few enough to read — so zooming out leaves the boundaries, not the noise.
    labelLayers: 'eiendoms_id',
    labelMinZoom: 15,
    // The server's own limit, not a taste call: both layers carry MaxScaleDenominator
    // 40000 (≈ zoom 13 at Norwegian latitudes) and past it the WMS answers a *blank tile
    // with a 200*, so without this gate the checkbox just looks broken when zoomed out.
    minZoom: 13,
    // Kartverket's own colours are thin, and over sea a very pale dotted pink that all but
    // vanishes against the topo basemap. The service publishes only a 'default' style, so
    // there is nothing to ask for server-side. This class is what lets index.css darken
    // and saturate the tiles client-side instead.
    className: 'ol-layer-eiendom',
  },
  {
    id: 'postnummer',
    label: 'Postnummerområder',
    url: 'https://wms.geonorge.no/skwms1/wms.postnummeromrader',
    layers: 'postnummer',
    // Postnummerområder are larger than grunnkrets but still clutter the national
    // view; reveal past ~9 where the polygons and numbers become legible.
    minZoom: 9,
  },
]

// Kartverket eiendom API — returns teig (cadastral parcel) polygons near a point.
// Used by the map click handler (useOlMap); one of the two calls that skips our proxy.
export const EIENDOM_PUNKT_URL = 'https://api.kartverket.no/eiendom/v1/punkt/omrader'

// Matrikkelen "Eiendomskart Teig" WFS (Kartverket, via Geonorge) — used to enumerate
// every matrikkelenhet in a gårdsnummer-serie (the eiendom API can't list a whole gnr).
// The request + FES filter are built by the backend (/geo/gnr-teiger); it returns the
// upstream GML 3.2, which we parse below. These namespaces are for that parse.
const TEIG_NS =
  'http://skjema.geonorge.no/SOSI/produktspesifikasjon/Matrikkelen-Eiendomskart-Teig/20211101'
const GML_NS = 'http://www.opengis.net/gml/3.2'

// Statistiske enheter — grunnkretser (SSB via Geonorge). Note https and a dated edition,
// unlike TEIG_NS above; both are versioned in the URI, so a new product spec makes the
// parses below return nothing rather than throw. The backend holds its own copy of this
// string for the WFS filter it builds.
const GRUNNKRETS_NS =
  'https://skjema.geonorge.no/SOSI/produktspesifikasjon/StatEnheterGrunnkretser/20240101'

// A kommune match for the place-navigation search: name + number + the bounding box
// to fly the map to. bbox is [minLon, minLat, maxLon, maxLat] in EPSG:4258 (≈WGS84).
export interface KommuneHit {
  nummer: string
  navn: string
  fylke: string
  bbox: [number, number, number, number]
}

// Search kommuner by (prefix) name via the backend → kommuneinfo /sok. Each hit
// already carries avgrensningsboks, so the result is enough to fly the map there.
// avgrensningsboks is what lets a hit fly the map without a second call. Optional because a
// kommune without one is still a valid hit — it just can't be flown to (bbox falls back to
// zeroes, as before).
const kommuneSokSchema = z.object({
  kommuner: z
    .array(
      z.object({
        kommunenummer: z.string(),
        kommunenavn: z.string(),
        fylkesnavn: z.string().nullish(),
        avgrensningsboks: z
          .object({ coordinates: z.array(z.array(z.array(z.number()))) })
          .nullish(),
      }),
    )
    .nullish(),
})

export async function searchKommuner(navn: string): Promise<KommuneHit[]> {
  const res = await fetch(`${BASE}/geo/kommune-sok?navn=${encodeURIComponent(navn)}`)
  // Throw rather than return [] — an empty array is indistinguishable from "no kommune
  // matches that name", so a backend outage would render as a normal empty dropdown.
  if (!res.ok) throw new Error(`kommune-sok failed: ${res.status}`)
  const data = parsed(kommuneSokSchema, await res.json(), 'kommunesøket')
  return (data.kommuner ?? []).map((k): KommuneHit => ({
    nummer: k.kommunenummer,
    navn: k.kommunenavn,
    fylke: k.fylkesnavn ?? '',
    bbox: k.avgrensningsboks ? extentOf(k.avgrensningsboks.coordinates[0]) : [0, 0, 0, 0],
  }))
}

// Every kommune as nummer → navn, via the backend → kommuneinfo /kommuner. Used by the
// komreg move check to tell a real target kommune from a typo, and to show the name next
// to the number the user typed. The whole list in one call: a per-number lookup would
// report a network blip as "kommunen finnes ikke" (see the /geo/kommuner route comment). Throws rather than returning an empty map, for the same reason
// searchKommuner does — an empty map reads as "no kommune exists anywhere".
const kommuneListeSchema = z.array(z.object({ kommunenummer: z.string(), kommunenavn: z.string() }))

export async function fetchKommuner(): Promise<Map<string, string>> {
  const res = await fetch(`${BASE}/geo/kommuner`)
  if (!res.ok) throw new Error(`kommuner failed: ${res.status}`)
  const data = parsed(kommuneListeSchema, await res.json(), 'kommunelista')
  return new Map(data.map((k) => [k.kommunenummer, k.kommunenavn]))
}

// lokalid of every teig in a kommune with no matrikkelnummer.
export async function fetchKommuneTeigerUtenMnr(kommunenummer: string): Promise<number[]> {
  const res = await fetch(`${BASE}/geo/kommune-teiger-uten-mnr?kommunenummer=${kommunenummer}`)
  if (!res.ok) {
    throw new Error(
      `Kunne ikke hente teiger uten matrikkelnummer i ${kommunenummer} (${res.status})`,
    )
  }
  return parsed(
    z.array(z.number()),
    await res.json(),
    `teiger uten matrikkelnummer i ${kommunenummer}`,
  )
}

// Distinct bruksnummer that exist in a gnr-serie — the occupancy side of "is this
// gnr/bnr free in the target kommune". Mirrors fetchAdressekodeNumbers above; one WFS
// call answers for every bnr in the gnr, so rows sharing a target gnr share a lookup.
//
// Caveat the caller must carry: the Teig WFS only knows matrikkelenheter that *have* a
// teig. A missing bnr here is not proof the number is free — no open API can prove that.
export async function fetchGnrBnr(
  kommunenummer: string,
  gardsnummer: number,
): Promise<Set<number>> {
  const teiger = await fetchGnrTeiger(kommunenummer, gardsnummer)
  return new Set(teiger.map((t) => t.props.bruksnummer ?? 0))
}

// One Geonorge address (utkoordsys=3857) → our AddressInfo. Shared by the teig address
// lookup and the address search, which both return the same upstream `adresser` shape.
function toAddressInfo(a: z.infer<typeof adresseSchema>): AddressInfo {
  const rp = a.representasjonspunkt
  return {
    adressetekst: a.adressetekst ?? '',
    adressenavn: a.adressenavn ?? '',
    nummer: a.nummer ?? null,
    bokstav: a.bokstav ?? '',
    // null, not 0: a matrikkeladresse has no street code at all, and 0 is a real-looking
    // value that would key a komreg row. See AddressInfo in domain.ts.
    adressekode: a.adressekode ?? null,
    // utkoordsys=3857 → lon is easting (x), lat is northing (y).
    point: rp ? [rp.lon, rp.lat] : null,
  }
}

// Fetch every page of a Geonorge address endpoint (both take `side=`). The upstream
// caps a page at 1000 addresses and silently truncates past it — and a truncated
// result would falsify the street-coverage check — so follow
// metadata.totaltAntallTreff until we hold everything. Throws on any failed page:
// a partial result is worse than an error here.
async function fetchAllAdresser(makeUrl: (side: number) => string): Promise<AddressInfo[]> {
  const out: AddressInfo[] = []
  // Page cap so bogus metadata can't loop us forever (20 000 addresses is plenty).
  for (let side = 0; side < 20; side++) {
    const res = await fetch(makeUrl(side))
    if (!res.ok) throw new Error(`Adresser ${res.status}`)
    const data = parsed(adresseSokSchema, await res.json(), 'adressesøket')
    const page = data.adresser ?? []
    out.push(...page.map(toAddressInfo))
    const total = data.metadata?.totaltAntallTreff
    if (page.length === 0 || typeof total !== 'number' || out.length >= total) break
  }
  return out
}

// Look up all addresses for a teig's matrikkelenhet (EPSG:3857 points). Goes through the
// backend (/geo/addresses → Geonorge), which returns the upstream JSON unchanged.
export async function fetchAddresses(p: TeigProps): Promise<AddressInfo[]> {
  return fetchAllAdresser(
    (side) =>
      `${BASE}/geo/addresses?kommunenummer=${p.kommunenummer}` +
      `&gardsnummer=${p.gardsnummer}&bruksnummer=${p.bruksnummer ?? 0}` +
      `&festenummer=${p.festenummer ?? 0}&side=${side}`,
  )
}

// An address search within one kommune: either a free-text street name (sok=) or an exact
// numeric adressekode (the street code).
export type AddressQuery = { sok?: string; adressekode?: number }

// Address search within one kommune (EPSG:3857 points), via the backend.
// Throws on failure (callers: useQuery surfaces it; the coverage check must not
// mistake an error for "0 addresses on this street").
export async function searchAdresser(
  kommunenummer: string,
  query: AddressQuery,
): Promise<AddressInfo[]> {
  const param =
    query.adressekode != null
      ? `adressekode=${query.adressekode}`
      : `sok=${encodeURIComponent(query.sok ?? '')}`
  return fetchAllAdresser(
    (side) => `${BASE}/geo/adresse-sok?kommunenummer=${kommunenummer}&${param}&side=${side}`,
  )
}

// Distinct house numbers that exist for a street code — used to test whether the
// selection covers the whole street (so it can be moved as one row). Bokstav is
// ignored: komreg moves by adressenummer, so 37 and 37B count as one number.
export async function fetchAdressekodeNumbers(
  kommunenummer: string | null,
  adressekode: number,
): Promise<Set<number>> {
  const addrs = await searchAdresser(kommunenummer ?? '', { adressekode })
  const nums = new Set<number>()
  for (const a of addrs) {
    if (a.nummer != null) nums.add(a.nummer)
  }
  return nums
}

// The geokoding response. `properties` stays a loose bag on purpose: toTeigProps owns what
// a teig's fields must look like, and it validates them for all three sources at once —
// duplicating that here would be the second place to keep in step.
const geokodingSchema = z.object({
  features: z
    .array(
      z.object({
        geometry: z.custom<GeoJSONGeometry>((v) => typeof v === 'object' && v !== null),
        properties: z.record(z.string(), z.unknown()),
      }),
    )
    .nullish(),
})

// All teiger of a matrikkelenhet (by gnr/bnr/fnr), as polygons in EPSG:3857.
export async function fetchMatrikkelTeiger(p: TeigProps): Promise<SelectedTeig[]> {
  const url =
    `${BASE}/geo/matrikkel-teiger?kommunenummer=${p.kommunenummer}` +
    `&gardsnummer=${p.gardsnummer}&bruksnummer=${p.bruksnummer ?? 0}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Matrikkel-teiger ${res.status}`)
  const data = parsed(geokodingSchema, await res.json(), 'matrikkeloppslaget')
  // Parse before filtering, so the festenummer compared below is the normalised one and the
  // id comes from the validated props rather than a second cast of the same field.
  return (
    (data.features ?? [])
      .map((f) => ({ props: toTeigProps(f.properties), geometry: f.geometry }))
      // The geokoding response covers the whole gnr/bnr family — base parcel plus
      // every festetomt (upstream treats festenummer=0 as "no filter", so there is
      // no server-side way to ask for just one). A matrikkelenhet is gnr/bnr/fnr,
      // so filter here — otherwise clicking a festetomt also selects the base parcel.
      .filter(({ props }) => (props.festenummer ?? 0) === (p.festenummer ?? 0))
      .map(({ props, geometry }) => ({ id: props.lokalid, props, geometry }))
  )
}

// Every teig within a few metres of a point (EPSG:3857), from the eiendom API — the same
// call the map click makes (useOlMap's lookupTeigAt), and like it straight to Kartverket,
// not through our proxy. Used by "Sjekk mot matrikkelen" to show what lies where a vanished
// teig used to be.
export async function fetchTeigerVedPunkt(ost: number, nord: number): Promise<SelectedTeig[]> {
  const url =
    `${EIENDOM_PUNKT_URL}?ost=${Math.round(ost)}&nord=${Math.round(nord)}` +
    `&koordsys=3857&utkoordsys=3857&radius=5&maksTreff=20`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Eiendom punkt ${res.status}`)
  const data = parsed(geokodingSchema, await res.json(), 'punktoppslaget')
  return (data.features ?? []).map((f) => {
    const props = toTeigProps(f.properties)
    return { id: props.lokalid, props, geometry: f.geometry }
  })
}

// First child text (trimmed) of an app:-namespaced element, or null.
function appText(el: Element, tag: string): string | null {
  return el.getElementsByTagNameNS(TEIG_NS, tag)[0]?.textContent?.trim() ?? null
}
function numOrNull(s: string | null): number | null {
  if (s == null || s === '') return null
  const v = Number(s)
  return Number.isNaN(v) ? null : v
}
// A flat "e n e n …" gml:posList (EPSG:3857, easting-northing) → GeoJSON ring.
function ringFromPosList(posList: string): number[][] {
  const n = posList.trim().split(/\s+/).map(Number)
  const ring: number[][] = []
  for (let i = 0; i + 1 < n.length; i += 2) ring.push([n[i], n[i + 1]])
  return ring
}

// All teiger of a gårdsnummer-serie: every matrikkelenhet (bnr, incl. feste /
// seksjon) under kommune+gnr, as SelectedTeig in EPSG:3857 — the same shape the
// click/search flows produce, so they merge straight into the selection.
export async function fetchGnrTeiger(
  kommunenummer: string,
  gardsnummer: number,
): Promise<SelectedTeig[]> {
  // The WFS request (incl. the FES filter) is built by the backend; here we just parse
  // the GML it returns.
  const res = await fetch(
    `${BASE}/geo/gnr-teiger?kommunenummer=${kommunenummer}&gardsnummer=${gardsnummer}`,
  )
  if (!res.ok) throw new Error(`Teig WFS ${res.status}`)
  // A teig shared by several matrikkelenheter: keep the one in the gnr we asked for.
  return parseTeigGml(await res.text(), (units) =>
    units.find((u) => appText(u, 'gardsnummer') === String(gardsnummer)),
  )
}

// Every teig touching one grunnkrets. The backend resolves the number to its polygon and
// runs the spatial query (that filter is far too big for a URL); the GML that comes back
// is the same shape as the gnr-serie's, so it merges straight into the selection.
export async function fetchGrunnkretsTeiger(grunnkretsnummer: string): Promise<SelectedTeig[]> {
  const res = await fetch(`${BASE}/geo/grunnkrets-teiger?grunnkretsnummer=${grunnkretsnummer}`)
  // 404 is the backend saying the lookup succeeded and the krets does not exist — worth
  // distinguishing from an outage, since the user typed or clicked something.
  if (res.status === 404) throw new Error(`Fant ingen grunnkrets ${grunnkretsnummer}`)
  if (!res.ok) throw new Error(`Grunnkrets-teiger ${res.status}`)
  // No gnr to disambiguate by here, so a shared teig falls back to its first
  // matrikkelenhet (~3% of a krets in testing).
  return parseTeigGml(await res.text(), () => undefined)
}

// GML <app:Teig> features → SelectedTeig, in EPSG:3857.
//
// We parse by hand (DOMParser) rather than via ol/format/WFS on purpose: each Teig carries
// both a representasjonspunkt (gml:Point) and its område polygon, and OL's generic reader
// can latch onto the wrong one.
//
// `pickUnit` chooses among the matrikkelenheter a shared teig lists; returning undefined
// falls back to the first.
function parseTeigGml(
  gml: string,
  pickUnit: (units: Element[]) => Element | undefined,
): SelectedTeig[] {
  const xml = new DOMParser().parseFromString(gml, 'application/xml')

  const out: SelectedTeig[] = []
  for (const teig of Array.from(xml.getElementsByTagNameNS(TEIG_NS, 'Teig'))) {
    // The WFS teigId equals the eiendom API's lokalid (gml:id "teig.<lokalid>"),
    // so adds dedupe against map-clicked teiger by the same SelectedTeig.id.
    const id = numOrNull(
      (teig.getAttributeNS(GML_NS, 'id') ?? teig.getAttribute('gml:id') ?? '').replace(
        /^teig\./,
        '',
      ),
    )
    if (id == null) continue

    const units = Array.from(teig.getElementsByTagNameNS(TEIG_NS, 'Matrikkelenhet'))
    const me = pickUnit(units) ?? units[0]
    if (!me) continue

    // The parcel numbers come off the matrikkelenhet, but matrikkelnummerTekst hangs on the
    // *teig* — a sibling of app:matrikkelenhet, not a child of it. Reading it off `me`
    // silently yields null, which turns every "Mnr (vann) mangler" teig into a bare
    // "Registrert" with no matrikkelnummer to show instead. Latent until the grunnkrets
    // fetch: a gnr-serie only returns registered parcels, where nothing reads this field.
    // matrikkelnummertekst (lowercase) matches the key toTeigProps reads.
    const props = toTeigProps({
      lokalid: id,
      kommunenummer: appText(me, 'kommunenummer'),
      gardsnummer: numOrNull(appText(me, 'gardsnummer')),
      bruksnummer: numOrNull(appText(me, 'bruksnummer')),
      festenummer: numOrNull(appText(me, 'festenummer')),
      seksjonsnummer: numOrNull(appText(me, 'seksjonsnummer')),
      matrikkelnummertekst: appText(teig, 'matrikkelnummerTekst'),
      meterFraPunkt: 0,
    })

    // Geometry: the single område polygon — exterior ring + any holes — in 3857.
    const poly = teig
      .getElementsByTagNameNS(TEIG_NS, 'område')[0]
      ?.getElementsByTagNameNS(GML_NS, 'Polygon')[0]
    const exterior = poly
      ?.getElementsByTagNameNS(GML_NS, 'exterior')[0]
      ?.getElementsByTagNameNS(GML_NS, 'posList')[0]?.textContent
    if (!poly || !exterior) continue
    const holes = Array.from(poly.getElementsByTagNameNS(GML_NS, 'interior')).map(
      (i) => i.getElementsByTagNameNS(GML_NS, 'posList')[0]?.textContent ?? '',
    )
    const geometry: GeoJSONGeometry = {
      type: 'Polygon',
      coordinates: [ringFromPosList(exterior), ...holes.map(ringFromPosList)],
    }

    out.push({ id, props, geometry })
  }
  return out
}

// A grunnkrets picked off the map: its identity plus the polygon, so the caller can both
// name what was picked and draw its outline.
export interface GrunnkretsHit {
  nummer: string
  navn: string
  geometry: GeoJSONGeometry
}

// Nested one level deeper than the rest (grunnkretsId → GrunnkretsId → grunnkretsnummer),
// so a plain first-child read of the Grunnkrets element would miss it.
function grunnkretsText(el: Element, tag: string): string | null {
  return el.getElementsByTagNameNS(GRUNNKRETS_NS, tag)[0]?.textContent?.trim() ?? null
}

// The grunnkrets containing a map coordinate (EPSG:3857), or null if the click landed
// outside every krets. Coordinates go out as whole metres — the backend's digit guard
// takes no decimals, and a metre is far below the resolution this needs.
export async function fetchGrunnkretsAt(
  coordinate: [number, number],
): Promise<GrunnkretsHit | null> {
  const ost = Math.round(coordinate[0])
  const nord = Math.round(coordinate[1])
  const res = await fetch(`${BASE}/geo/grunnkrets-punkt?ost=${ost}&nord=${nord}`)
  if (!res.ok) throw new Error(`Grunnkrets-punkt ${res.status}`)
  const xml = new DOMParser().parseFromString(await res.text(), 'application/xml')
  const el = xml.getElementsByTagNameNS(GRUNNKRETS_NS, 'Grunnkrets')[0]
  if (!el) return null
  const nummer = grunnkretsText(el, 'grunnkretsnummer')
  const geometry = multiSurfaceGeometry(el)
  if (!nummer || !geometry) return null
  return { nummer, navn: grunnkretsText(el, 'grunnkretsnavn') ?? nummer, geometry }
}

// A gml:MultiSurface (exterior ring + any holes per surface) → GeoJSON MultiPolygon in
// EPSG:3857. A grunnkrets is usually one surface, but islands and exclaves exist, so read
// every surfaceMember rather than the first.
function multiSurfaceGeometry(el: Element): GeoJSONGeometry | null {
  const polygons: Position[][][] = []
  for (const poly of Array.from(el.getElementsByTagNameNS(GML_NS, 'Polygon'))) {
    const exterior = poly
      .getElementsByTagNameNS(GML_NS, 'exterior')[0]
      ?.getElementsByTagNameNS(GML_NS, 'posList')[0]?.textContent
    if (!exterior) continue
    const holes = Array.from(poly.getElementsByTagNameNS(GML_NS, 'interior')).map(
      (i) => i.getElementsByTagNameNS(GML_NS, 'posList')[0]?.textContent ?? '',
    )
    polygons.push([ringFromPosList(exterior), ...holes.map(ringFromPosList)])
  }
  if (!polygons.length) return null
  return { type: 'MultiPolygon', coordinates: polygons }
}
