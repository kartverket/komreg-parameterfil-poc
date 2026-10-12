import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Geometry as GeoJSONGeometry } from 'geojson'
import Map from 'ol/Map'
import View from 'ol/View'
import Feature from 'ol/Feature'
import TileLayer from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import XYZ from 'ol/source/XYZ'
import TileWMS from 'ol/source/TileWMS'
import VectorSource from 'ol/source/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import Draw from 'ol/interaction/Draw'
import Point from 'ol/geom/Point'
import { getArea } from 'ol/sphere'
import { Style, Stroke, Fill, Circle as CircleStyle, Text } from 'ol/style'
import type { FeatureLike } from 'ol/Feature'
import type { Coordinate } from 'ol/coordinate'
import { fromLonLat } from 'ol/proj'
import { defaults as defaultInteractions, MouseWheelZoom } from 'ol/interaction'
import { defaults as defaultControls } from 'ol/control'
import 'ol/ol.css'
import {
  type SelectedTeig,
  type AddressInfo,
  type MatrikkelInfo,
  toTeigProps,
  matrikkelKey,
  WEB_MERCATOR,
} from '@/domain/domain'
import {
  TOPO_URL,
  KRETS_LAYERS,
  EIENDOM_PUNKT_URL,
  fetchAddresses,
  fetchMatrikkelTeiger,
} from '@/data/external'
import { extentOf } from '@/lib/utils'

// One formatter for the whole module — GeoJSON holds no per-call state, and every
// read/write here passes its projection explicitly.
const geoJson = new GeoJSON()

const highlightStyle = new Style({
  stroke: new Stroke({ color: '#ff7a00', width: 2 }),
  fill: new Fill({ color: 'rgba(255, 122, 0, 0.25)' }),
})

// Hide address labels when zoomed out past this resolution (m/px) — keeps the
// text from overwhelming the map; the dot itself always shows.
const ADDRESS_LABEL_MAX_RES = 10

// Freehand annotation lines.
const lineStyle = new Style({
  stroke: new Stroke({ color: '#ffd400', width: 3 }),
})

// Dot + the address text (e.g. "Skinnstudumpa 23") read off the feature.
const addressStyle = (feature: FeatureLike, resolution: number) =>
  new Style({
    image: new CircleStyle({
      radius: 4,
      fill: new Fill({ color: '#fff' }),
      stroke: new Stroke({ color: '#ff7a00', width: 2 }),
    }),
    text:
      resolution <= ADDRESS_LABEL_MAX_RES
        ? new Text({
            text: feature.get('label') as string,
            font: '12px system-ui, sans-serif',
            offsetY: -12,
            fill: new Fill({ color: '#fff' }),
            stroke: new Stroke({ color: '#2b2e33', width: 3 }),
          })
        : undefined,
  })

// The picked grunnkrets boundary. Blue to match how the WMS krets overlay draws its lines,
// and unfilled on purpose: this is the strip the user scans for parcels that only clip the
// krets, so the teiger underneath have to stay readable.
const grunnkretsStyle = new Style({
  stroke: new Stroke({ color: '#4c8dff', width: 3, lineDash: [8, 5] }),
})

// Distinct colour for the right-click "inspect" highlight (vs orange selection).
const infoHighlightStyle = new Style({
  stroke: new Stroke({ color: '#00d0ff', width: 3 }),
  fill: new Fill({ color: 'rgba(0, 208, 255, 0.18)' }),
})

// Bright highlight for a teig the user clicked in the selection list ("zoom to").
const focusStyle = new Style({
  stroke: new Stroke({ color: '#ffd400', width: 4 }),
  fill: new Fill({ color: 'rgba(255, 212, 0, 0.15)' }),
})

// Total geodesic area (m²) of some teiger, from their EPSG:3857 polygons.
function areaOf(teiger: SelectedTeig[]): number {
  let sum = 0
  for (const t of teiger) {
    const geometry = geoJson.readGeometry(t.geometry, WEB_MERCATOR)
    if (geometry) sum += getArea(geometry)
  }
  return sum
}

// Find the teig at a map coordinate: the one whose polygon contains the point,
// else the nearest by meterFraPunkt. Shared by left-click (select) and
// right-click (inspect).
async function lookupTeigAt(coordinate: Coordinate): Promise<Feature | null> {
  const [ost, nord] = coordinate
  const url =
    `${EIENDOM_PUNKT_URL}?ost=${ost}&nord=${nord}` +
    `&koordsys=3857&utkoordsys=3857&radius=5&maksTreff=100`
  const res = await fetch(url)
  // Without this the 5xx body (an HTML error page) reaches res.json(), which throws a
  // parse error that reads identically to a malformed payload. Clicking open water is
  // *not* this path — that returns 200 with no features and falls out as null below.
  if (!res.ok) throw new Error(`Eiendom punkt ${res.status}`)
  const data = await res.json()
  const feats = geoJson.readFeatures(data, WEB_MERCATOR)
  return (
    feats.find((f) => f.getGeometry()?.intersectsCoordinate(coordinate)) ??
    feats.reduce<(typeof feats)[number] | undefined>(
      (best, f) => (!best || f.get('meterFraPunkt') < best.get('meterFraPunkt') ? f : best),
      undefined,
    ) ??
    null
  )
}

// The OpenLayers map and all its imperative glue: base + overlay layers, the
// click→select and right-click→inspect handlers, and the effects that sync the
// highlight / inspect / address-dot layers to React state. Returns the container
// ref, the inspect-panel state, and a line-clearer for the draw panel.
export function useOlMap({
  selected,
  addresses,
  searchAddresses,
  drawingLine,
  addMode,
  grunnkretsMode,
  grunnkretsOutline,
  visibleKrets,
  focusedId,
  onToggle,
  onToggleGroup,
  onGrunnkretsClick,
}: {
  selected: SelectedTeig[]
  addresses: Record<string, AddressInfo[] | 'loading'>
  searchAddresses: AddressInfo[]
  drawingLine: boolean
  addMode: boolean
  grunnkretsMode: boolean
  grunnkretsOutline: GeoJSONGeometry | null
  visibleKrets: Record<string, boolean>
  focusedId: number | null
  onToggle: (item: SelectedTeig) => void
  onToggleGroup: (items: SelectedTeig[]) => void
  onGrunnkretsClick: (coordinate: Coordinate) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const mapRef = useRef<Map | null>(null)
  const highlightSourceRef = useRef<VectorSource | null>(null)
  const infoSourceRef = useRef<VectorSource | null>(null)
  const focusSourceRef = useRef<VectorSource | null>(null)
  const addressSourceRef = useRef<VectorSource | null>(null)
  const searchAddressSourceRef = useRef<VectorSource | null>(null)
  const lineSourceRef = useRef<VectorSource | null>(null)
  const grunnkretsSourceRef = useRef<VectorSource | null>(null)
  const lineDrawRef = useRef<Draw | null>(null)
  // drawingRef lets the once-registered click handler skip selection while drawing.
  const drawingRef = useRef(false)
  // addModeRef gates left-click selection: only "add teig" mode grabs parcels.
  const addModeRef = useRef(addMode)
  // Grunnkrets mode takes the click instead — the two are mutually exclusive in MapView,
  // and this one is checked first.
  const grunnkretsModeRef = useRef(grunnkretsMode)
  // Per id, because one entry can build two layers (lines + labels at a higher zoom).
  const kretsLayersRef = useRef<Record<string, TileLayer[]>>({})
  // Right-click "inspect" panel: full info for one matrikkelenhet (null = closed).
  const [info, setInfo] = useState<MatrikkelInfo | null>(null)
  // Bumped on each click/right-click; a handler bails after an await if it's no
  // longer the latest, so a slow lookup can't overwrite a faster, more recent one.
  const clickTokenRef = useRef(0)
  const inspectTokenRef = useRef(0)

  // The map's handlers are registered once (the [] effect), so route the
  // selection callbacks through a ref to always reach the current ones.
  const cb = useRef({ onToggle, onToggleGroup, onGrunnkretsClick })
  // Kept current in a layout effect, not during render: a ref written while rendering makes
  // the React Compiler skip this hook. It runs after every commit and before the browser
  // can deliver the next click, which is the only time the handlers read these.
  useLayoutEffect(() => {
    addModeRef.current = addMode
    grunnkretsModeRef.current = grunnkretsMode
    cb.current = { onToggle, onToggleGroup, onGrunnkretsClick }
  })

  useEffect(() => {
    if (!ref.current) return

    const highlightSource = new VectorSource()
    const infoSource = new VectorSource()
    const focusSource = new VectorSource()
    const addressSource = new VectorSource()
    const searchAddressSource = new VectorSource()
    const lineSource = new VectorSource()
    const grunnkretsSource = new VectorSource()
    grunnkretsSourceRef.current = grunnkretsSource
    highlightSourceRef.current = highlightSource
    infoSourceRef.current = infoSource
    focusSourceRef.current = focusSource
    addressSourceRef.current = addressSource
    searchAddressSourceRef.current = searchAddressSource
    lineSourceRef.current = lineSource

    // Toggleable krets overlays — start hidden, zoom-gated via minZoom.
    const kretsTileLayers = KRETS_LAYERS.flatMap((k) => {
      const build = (wmsLayers: string, minZoom: number) =>
        new TileLayer({
          minZoom,
          visible: false,
          // Opt-in per layer. Giving a tile layer its own class makes OpenLayers render it
          // to its own canvas element, which is what lets index.css apply a CSS filter to
          // just that layer — see the `eiendom` entry in KRETS_LAYERS.
          className: k.className,
          source: new TileWMS({
            url: k.url,
            params: { LAYERS: wmsLayers, TRANSPARENT: true },
            attributions: '© Kartverket / SSB',
          }),
        })
      // Two OL layers rather than one with a zoom-dependent LAYERS param: OL already
      // gates on minZoom per layer, where switching params on zoom would mean a listener
      // and a full tile reload each time it crossed the threshold.
      const layers = [build(k.layers, k.minZoom)]
      if (k.labelLayers) layers.push(build(k.labelLayers, k.labelMinZoom ?? k.minZoom))
      kretsLayersRef.current[k.id] = layers
      return layers
    })

    const map = new Map({
      target: ref.current,
      layers: [
        new TileLayer({
          source: new XYZ({ url: TOPO_URL, attributions: '© Kartverket' }),
        }),
        // Fylke/kommune borders included — they're krets overlays like the rest.
        ...kretsTileLayers,
        new VectorLayer({ source: highlightSource, style: highlightStyle }),
        new VectorLayer({ source: infoSource, style: infoHighlightStyle }),
        new VectorLayer({ source: focusSource, style: focusStyle }),
        // Above the teig fills so the boundary stays visible over a selected parcel,
        // below the address dots.
        new VectorLayer({ source: grunnkretsSource, style: grunnkretsStyle }),
        new VectorLayer({ source: addressSource, style: addressStyle }),
        new VectorLayer({ source: searchAddressSource, style: addressStyle }),
        new VectorLayer({ source: lineSource, style: lineStyle }),
      ],
      // Snappier wheel zoom: shorter animation (default 250ms) + bigger step per tick.
      interactions: defaultInteractions({ mouseWheelZoom: false }).extend([
        new MouseWheelZoom({ duration: 100, maxDelta: 1.4 }),
      ]),
      // Attribution shown as always-visible corner text (it's a single static
      // credit, so the default collapsible "ⓘ" toggle is needless friction).
      controls: defaultControls({ attributionOptions: { collapsible: false } }),
      // Default EPSG:3857; centered on Norway.
      view: new View({ center: fromLonLat([10, 65]), zoom: 5 }),
    })
    mapRef.current = map

    // Freehand line tool (visual annotation only). Active only in draw mode.
    const lineDraw = new Draw({ source: lineSource, type: 'LineString' })
    lineDraw.setActive(false)
    map.addInteraction(lineDraw)
    lineDrawRef.current = lineDraw

    // A teig's geometry as EPSG:3857 GeoJSON (for highlight/export/info).
    const teigGeometry = (target: Feature): GeoJSONGeometry =>
      geoJson.writeGeometryObject(target.getGeometry()!, WEB_MERCATOR) as GeoJSONGeometry

    // Click a teig → toggle its whole matrikkelenhet in the selection.
    map.on('singleclick', async (evt) => {
      if (drawingRef.current) return // drawing a line — don't select teiger
      // Grunnkrets mode owns the click: MapView resolves the krets and does the fetching,
      // the same way it owns the matrikkel search.
      if (grunnkretsModeRef.current) return cb.current.onGrunnkretsClick(evt.coordinate)
      if (!addModeRef.current) return // navigate mode — clicks don't grab teiger
      const token = ++clickTokenRef.current
      try {
        const target = await lookupTeigAt(evt.coordinate)
        if (token !== clickTokenRef.current) return // a newer click superseded this one
        if (!target) return
        const props = toTeigProps(target.getProperties())
        const geometry = teigGeometry(target)

        // Unregistered/water teig has no matrikkelenhet — toggle just this one.
        if (props.gardsnummer == null) {
          cb.current.onToggle({ id: props.lokalid, props, geometry })
          return
        }

        // Otherwise toggle the whole matrikkelenhet (all its teiger, scattered
        // or not). Fall back to the single clicked teig if geocoding is empty.
        const group = await fetchMatrikkelTeiger(props)
        if (token !== clickTokenRef.current) return // superseded while fetching the group
        cb.current.onToggleGroup(group.length ? group : [{ id: props.lokalid, props, geometry }])
      } catch (e) {
        console.error('teig lookup failed', e)
        // Only a genuine lookup failure lands here (an empty result returns null
        // above), and selecting is the app's primary action — staying silent made a
        // backend outage look like a dead map. Skip superseded clicks so a stale
        // failure can't warn about a click the user has already replaced.
        if (token === clickTokenRef.current) window.alert('Kunne ikke hente teig — prøv igjen')
      }
    })

    // Right-click a teig → inspect the whole matrikkelenhet in the info panel.
    const viewport = map.getViewport()
    const onContextMenu = async (e: MouseEvent) => {
      e.preventDefault() // suppress the browser context menu
      const token = ++inspectTokenRef.current
      try {
        const target = await lookupTeigAt(map.getEventCoordinate(e))
        if (token !== inspectTokenRef.current) return // a newer right-click superseded this one
        if (!target) return
        const props = toTeigProps(target.getProperties())
        const rawProps = { ...target.getProperties() } as Record<string, unknown>
        delete rawProps.geometry
        const single: SelectedTeig = {
          id: props.lokalid,
          props,
          geometry: teigGeometry(target),
        }
        // Open immediately (loading), then fill in teiger + addresses.
        setInfo({ props, rawProps, teiger: [single], addresses: [], areaM2: null, loading: true })

        if (props.gardsnummer == null) {
          setInfo({
            props,
            rawProps,
            teiger: [single],
            addresses: [],
            areaM2: areaOf([single]),
            loading: false,
          })
          return
        }
        const [teiger, addrs] = await Promise.all([
          fetchMatrikkelTeiger(props),
          fetchAddresses(props),
        ])
        if (token !== inspectTokenRef.current) return // superseded while loading detail
        const t = teiger.length ? teiger : [single]
        setInfo({ props, rawProps, teiger: t, addresses: addrs, areaM2: areaOf(t), loading: false })
      } catch (e) {
        console.error('teig info lookup failed', e)
        // Same as the singleclick handler — but the info panel may already be open in
        // its loading state, so close it rather than leaving a permanent spinner.
        if (token === inspectTokenRef.current) {
          setInfo(null)
          window.alert('Kunne ikke hente teiginfo — prøv igjen')
        }
      }
    }
    viewport?.addEventListener('contextmenu', onContextMenu)

    return () => {
      viewport?.removeEventListener('contextmenu', onContextMenu)
      map.setTarget(undefined)
    }
  }, [])

  // Toggle the line-draw interaction (and the click-handler guard) on/off.
  useEffect(() => {
    drawingRef.current = drawingLine
    lineDrawRef.current?.setActive(drawingLine)
  }, [drawingLine])

  // Show/hide krets overlays per checkbox (zoom-gating still applies on top).
  useEffect(() => {
    for (const k of KRETS_LAYERS) {
      for (const layer of kretsLayersRef.current[k.id] ?? []) {
        layer.setVisible(!!visibleKrets[k.id])
      }
    }
  }, [visibleKrets])

  // Outline the picked grunnkrets (null = nothing picked, or the pick was cleared).
  useEffect(() => {
    const src = grunnkretsSourceRef.current
    if (!src) return
    src.clear()
    if (grunnkretsOutline) {
      const geometry = geoJson.readGeometry(grunnkretsOutline, WEB_MERCATOR)
      if (geometry) src.addFeature(new Feature(geometry))
    }
  }, [grunnkretsOutline])

  // Re-render the highlight layer from the selection (single source of truth).
  useEffect(() => {
    const src = highlightSourceRef.current
    if (!src) return
    src.clear()
    for (const s of selected) {
      const geometry = geoJson.readGeometry(s.geometry, WEB_MERCATOR)
      if (geometry) src.addFeature(new Feature(geometry))
    }
  }, [selected])

  // Highlight the teig focused from the selection list (declarative — stays in sync
  // with the list-row highlight, and clears if that teig leaves the selection).
  useEffect(() => {
    const src = focusSourceRef.current
    if (!src) return
    src.clear()
    const teig = focusedId == null ? undefined : selected.find((s) => s.id === focusedId)
    if (teig) {
      const geometry = geoJson.readGeometry(teig.geometry, WEB_MERCATOR)
      if (geometry) src.addFeature(new Feature(geometry))
    }
  }, [focusedId, selected])

  // Highlight the matrikkelenhet shown in the info panel (cleared on close).
  useEffect(() => {
    const src = infoSourceRef.current
    if (!src) return
    src.clear()
    if (info) {
      for (const t of info.teiger) {
        const geometry = geoJson.readGeometry(t.geometry, WEB_MERCATOR)
        if (geometry) src.addFeature(new Feature(geometry))
      }
    }
  }, [info])

  // Draw a dot at each address point of the selection (unique per matrikkel).
  useEffect(() => {
    const src = addressSourceRef.current
    if (!src) return
    src.clear()
    const seen = new Set<string>()
    for (const s of selected) {
      const k = matrikkelKey(s.props)
      if (!k || seen.has(k)) continue
      seen.add(k)
      const addr = addresses[k]
      if (!Array.isArray(addr)) continue
      for (const a of addr) {
        if (a.point) {
          src.addFeature(new Feature({ geometry: new Point(a.point), label: a.adressetekst }))
        }
      }
    }
  }, [selected, addresses])

  // Draw a dot at each address-search hit (independent of the selection dots above) and
  // frame them. The result set only changes on an explicit search/clear, so fitting here
  // isn't jarring; a single hit just zooms in.
  useEffect(() => {
    const src = searchAddressSourceRef.current
    if (!src) return
    src.clear()
    const pts: Coordinate[] = []
    for (const a of searchAddresses) {
      if (a.point) {
        src.addFeature(new Feature({ geometry: new Point(a.point), label: a.adressetekst }))
        pts.push(a.point)
      }
    }
    if (!pts.length) return
    mapRef.current
      ?.getView()
      .fit(extentOf(pts), { padding: [80, 80, 80, 80], duration: 600, maxZoom: 18 })
  }, [searchAddresses])

  function clearLines() {
    lineSourceRef.current?.clear()
  }

  // Pan/zoom to a single address point (clicked in the search result list); markers stay.
  function flyToPoint(point: Coordinate) {
    mapRef.current?.getView().animate({ center: point, zoom: 18, duration: 500 })
  }

  // Fly the view to a teig (clicked in the selection list). The highlight follows
  // declaratively from focusedId (see the effect above).
  function focusTeig(teig: SelectedTeig) {
    const map = mapRef.current
    if (!map) return
    const geom = geoJson.readGeometry(teig.geometry, WEB_MERCATOR)
    if (!geom) return
    map.getView().fit(geom.getExtent(), { padding: [80, 80, 80, 80], duration: 500, maxZoom: 18 })
  }

  // Fly the view to a lon/lat bounding box ([minLon, minLat, maxLon, maxLat], EPSG:4258)
  // — used by the place search to jump to a kommune.
  function flyToBbox(lonLatExtent: [number, number, number, number]) {
    const map = mapRef.current
    if (!map) return
    const [minLon, minLat, maxLon, maxLat] = lonLatExtent
    const min = fromLonLat([minLon, minLat])
    const max = fromLonLat([maxLon, maxLat])
    map.getView().fit([min[0], min[1], max[0], max[1]], {
      padding: [80, 80, 80, 80],
      duration: 700,
      maxZoom: 13,
    })
  }

  return { ref, info, setInfo, clearLines, focusTeig, flyToBbox, flyToPoint }
}
