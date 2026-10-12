import { useEffect, useRef, useState } from 'react'
import { Outlet } from '@tanstack/react-router'
import type { Coordinate } from 'ol/coordinate'
import { fetchGrunnkretsAt, fetchGrunnkretsTeiger, fetchMatrikkelTeiger } from '@/data/external'
import type { GrunnkretsHit } from '@/data/external'
import type { AddressInfo } from '@/domain/domain'
import { MatrikkelInfoPanel } from './components/MatrikkelInfoPanel'
import { SelectionPanel } from './components/SelectionPanel'
import { MapNavbar } from './components/MapNavbar'
import { MatrikkelSearch } from './components/MatrikkelSearch'
import { SessionPanel } from './components/SessionPanel'
import { PlaceSearch } from './components/PlaceSearch'
import { AddressSearch } from './components/AddressSearch'
import { DrawPanel } from './components/DrawPanel'
import { LayerPanel } from './components/LayerPanel'
import { useOlMap } from './map/useOlMap'
import { useExports } from './useExports'
import { useConfirm } from '@/hooks/useConfirm'
import { useStore } from './store'
import { useCoverageActions } from './useCoverageActions'

// The persistent shell: the OpenLayers map + the always-on panels/navbar, with an
// <Outlet/> for the full-screen overlay routes (arbeidsliste / komreg / regulering).
// It is a pathless layout route, so it stays mounted across those — see router.tsx.
// Working-session state lives in the store; only ephemeral shell UI (panels, draw,
// search) is local here.
export default function MapView() {
  const [showLayers, setShowLayers] = useState(false)
  const [showSelected, setShowSelected] = useState(false)
  const [showDraw, setShowDraw] = useState(false)
  const [showAddress, setShowAddress] = useState(false)
  const [searchAddresses, setSearchAddresses] = useState<AddressInfo[]>([])
  const [drawingLine, setDrawingLine] = useState(false)
  // "Add teig" mode: only then does the search box take matrikkel codes and do map
  // clicks grab parcels. Default (off) is plain navigation.
  const [addMode, setAddMode] = useState(false)
  // Grunnkrets mode: a click picks the krets under the cursor and offers every teig in it.
  // Mutually exclusive with addMode — both want the same click.
  const [grunnkretsMode, setGrunnkretsMode] = useState(false)
  const [grunnkrets, setGrunnkrets] = useState<GrunnkretsHit | null>(null)
  const [grunnkretsMsg, setGrunnkretsMsg] = useState('')
  // Same supersede guard the map's click handlers use: a slow krets lookup must not
  // overwrite a faster, more recent one.
  const grunnkretsToken = useRef(0)
  const [visibleKrets, setVisibleKrets] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [searchMsg, setSearchMsg] = useState('')
  // The teig last clicked in the selection list — highlighted on the map + in the list.
  const [focusedId, setFocusedId] = useState<number | null>(null)

  const selected = useStore((s) => s.selected)
  const wholeGnr = useStore((s) => s.wholeGnr)
  const gnrCoverage = useStore((s) => s.gnrCoverage)
  const toggle = useStore((s) => s.toggle)
  const toggleGroup = useStore((s) => s.toggleGroup)
  const addTeiger = useStore((s) => s.addTeiger)
  const removeTeig = useStore((s) => s.removeTeig)
  const toggleWholeGnr = useStore((s) => s.toggleWholeGnr)
  const addAllBnr = useStore((s) => s.addAllBnr)
  const { onAddAllBnr } = useCoverageActions()

  const { addresses, sortedSelected, teigAddresses } = useExports()
  // Replaces window.confirm for the "this is a big add" question — see useConfirm.
  const { confirm, dialog: confirmDialog } = useConfirm()
  const { ref, info, setInfo, clearLines, focusTeig, flyToBbox, flyToPoint } = useOlMap({
    selected,
    addresses,
    searchAddresses,
    drawingLine,
    addMode,
    grunnkretsMode,
    grunnkretsOutline: grunnkrets?.geometry ?? null,
    visibleKrets,
    focusedId,
    onToggle: toggle,
    onToggleGroup: toggleGroup,
    onGrunnkretsClick: (c) => void pickGrunnkrets(c),
  })

  // Closing/reloading the tab throws the working session away — warn while there
  // are changes that aren't in a saved list.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().isDirty()) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Pick the grunnkrets under a map click and offer its teiger. Two calls: the krets
  // itself (for the name and the outline we draw), then every teig touching it.
  //
  // Confirmed rather than added outright, unlike the gnr-serie: a krets runs to several
  // hundred teiger, so a misclick would otherwise be a very large undo.
  async function pickGrunnkrets(coordinate: Coordinate) {
    const token = ++grunnkretsToken.current
    setGrunnkretsMsg('finner grunnkrets…')
    try {
      const hit = await fetchGrunnkretsAt([coordinate[0], coordinate[1]])
      if (token !== grunnkretsToken.current) return
      if (!hit) {
        setGrunnkretsMsg('Ingen grunnkrets her')
        return
      }
      // Draw the outline before the teiger land — it's the answer to "which one did I
      // just hit", and it stays up while the (slow) teig query runs.
      setGrunnkrets(hit)
      const label = `${hit.navn} (${hit.nummer})`
      setGrunnkretsMsg(`${label} — henter teiger…`)

      const teiger = await fetchGrunnkretsTeiger(hit.nummer)
      if (token !== grunnkretsToken.current) return
      if (!teiger.length) {
        setGrunnkretsMsg(`${label}: ingen teiger`)
        return
      }
      if (
        !(await confirm({
          title: `${teiger.length} teiger i ${label}`,
          body: 'Legg dem til i arbeidslisten? Adresseoppslagene tar litt tid.',
        }))
      ) {
        setGrunnkretsMsg(`${label} — ikke lagt til`)
        return
      }
      addTeiger(teiger)
      setGrunnkretsMsg(`La til ${teiger.length} teiger fra ${label}`)
    } catch (e) {
      console.error('grunnkrets lookup failed', e)
      if (token === grunnkretsToken.current) setGrunnkretsMsg('Oppslag feilet')
    }
  }

  // Look up a matrikkelnummer and add its teiger: "3322-123/1" adds one
  // matrikkelenhet; "3322-123" (no bnr) adds every bnr in the gnr-serie.
  async function runSearch() {
    const q = search.trim()
    const mBnr = q.match(/^(\d+)-(\d+)\/(\d+)$/)
    const mGnr = q.match(/^(\d+)-(\d+)$/)
    if (mBnr) {
      const [, kommune, gnr, bnr] = mBnr
      setSearchMsg('søker…')
      try {
        const group = await fetchMatrikkelTeiger({
          lokalid: 0,
          kommunenummer: kommune,
          gardsnummer: Number(gnr),
          bruksnummer: Number(bnr),
          festenummer: null,
          seksjonsnummer: null,
          matrikkelnummertekst: null,
          meterFraPunkt: 0,
        })
        if (!group.length) {
          setSearchMsg('Ingen treff')
          return
        }
        addTeiger(group)
        setSearch('')
        setSearchMsg(`La til ${group.length} teig${group.length > 1 ? 'er' : ''}`)
      } catch (e) {
        console.error('matrikkel search failed', e)
        setSearchMsg('Søk feilet')
      }
    } else if (mGnr) {
      const [, kommune, gnr] = mGnr
      setSearchMsg('henter alle bnr…')
      try {
        const group = await addAllBnr(kommune, Number(gnr))
        if (!group.length) {
          setSearchMsg('Ingen treff')
          return
        }
        setSearch('')
        const bnr = new Set(group.map((s) => s.props.bruksnummer ?? 0)).size
        setSearchMsg(`La til ${group.length} teiger · ${bnr} bnr`)
      } catch (e) {
        console.error('matrikkel search failed', e)
        setSearchMsg('Søk feilet')
      }
    } else {
      setSearchMsg('Skriv inn 3322-123/1 eller 3322-123 (hele gnr)')
    }
  }

  return (
    <>
      <div ref={ref} className="h-screen w-screen bg-card" />

      {/* Always on: which list this is, saving, and the way back to the landing screen. */}
      <SessionPanel />

      {/* Top-center slot: grunnkrets status, then matrikkel search, then place navigation */}
      {grunnkretsMode ? (
        <div className="panel left-1/2 top-3 -translate-x-1/2 text-xs">
          {grunnkretsMsg || 'Klikk i kartet for å velge grunnkrets'}
        </div>
      ) : addMode ? (
        <MatrikkelSearch
          value={search}
          message={searchMsg}
          onChange={setSearch}
          onSubmit={() => void runSearch()}
        />
      ) : (
        <PlaceSearch onSelect={(hit) => flyToBbox(hit.bbox)} />
      )}

      {/* The four panels below are toggled from MapNavbar (the show* flags). */}
      {/* Address search (top-left) */}
      {showAddress && (
        <AddressSearch
          onResults={setSearchAddresses}
          onPick={(a) => a.point && flyToPoint(a.point)}
        />
      )}

      {/* Freehand line drawing (visual only) */}
      {showDraw && (
        <DrawPanel
          drawing={drawingLine}
          onToggleDraw={() => setDrawingLine((v) => !v)}
          onClear={clearLines}
        />
      )}

      {/* Kartlag (toggleable overlays) */}
      {showLayers && (
        <LayerPanel
          visible={visibleKrets}
          onToggle={(id, checked) => setVisibleKrets((p) => ({ ...p, [id]: checked }))}
        />
      )}

      {/* Selection list + export */}
      {showSelected && (
        <SelectionPanel
          selected={selected}
          sortedSelected={sortedSelected}
          teigAddresses={teigAddresses}
          wholeGnr={wholeGnr}
          gnrCoverage={gnrCoverage}
          onToggleWholeGnr={toggleWholeGnr}
          onAddAllBnr={onAddAllBnr}
          focusedId={focusedId}
          onFocusTeig={(teig) => {
            setFocusedId(teig.id)
            focusTeig(teig)
          }}
          onRemove={removeTeig}
        />
      )}

      {/* Right-click inspect panel for one matrikkelenhet */}
      {info && <MatrikkelInfoPanel info={info} onClose={() => setInfo(null)} />}

      {/* Modal confirm (grunnkrets add). Rendered last so it sits above
          every panel; it portals to <body> anyway. */}
      {confirmDialog}

      {/* Bottom navbar — toggles each panel on/off */}
      <MapNavbar
        selectedCount={selected.length}
        addMode={addMode}
        grunnkretsMode={grunnkretsMode}
        showSelected={showSelected}
        showLayers={showLayers}
        showDraw={showDraw}
        showAddress={showAddress}
        onToggleAddMode={() => {
          // The click modes all compete for the same click, so entering one leaves the rest.
          if (!addMode) setGrunnkretsMode(false)
          setAddMode((v) => !v)
        }}
        onToggleGrunnkretsMode={() => {
          if (grunnkretsMode) {
            // Leaving the mode drops the outline and its status line; the teiger that were
            // added stay in the selection like any other add.
            setGrunnkrets(null)
            setGrunnkretsMsg('')
          } else {
            setAddMode(false)
          }
          setGrunnkretsMode((v) => !v)
        }}
        onToggleSelected={() => {
          // Shares the top-left slot with the address search — opening one
          // closes the other so the panels never stack on top of each other.
          if (!showSelected && showAddress) {
            setSearchAddresses([])
            setShowAddress(false)
          }
          setShowSelected((v) => !v)
        }}
        onToggleLayers={() => setShowLayers((v) => !v)}
        onToggleDraw={() => {
          // Leaving the drawing panel also exits draw mode.
          if (showDraw) setDrawingLine(false)
          setShowDraw((v) => !v)
        }}
        onToggleAddress={() => {
          // Closing the panel clears its markers (leaves the selection dots
          // alone); opening it takes the top-left slot from the selection panel.
          if (showAddress) setSearchAddresses([])
          else setShowSelected(false)
          setShowAddress((v) => !v)
        }}
      />

      {/* Full-screen overlay routes render here, on top of the persistent map. */}
      <Outlet />
    </>
  )
}
