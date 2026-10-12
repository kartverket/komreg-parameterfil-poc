import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, TriangleAlert, X } from 'lucide-react'
import {
  type SelectedTeig,
  gnrKey,
  matrikkelKey,
  adressekodeKey,
  matrikkelLabel,
  statusText,
} from '@/domain/domain'
import { useStore } from './store'
import { useCoverageActions } from './useCoverageActions'
import { toggled } from '@/lib/utils'
import { useExports } from './useExports'
import { MatrikkelsjekkPanel } from './components/MatrikkelsjekkPanel'
import { ListNav } from './components/ListNav'
import { SessionBar } from './components/SessionPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type ArbeidslisteTab = 'matrikkelenhet' | 'vegadresse' | 'teig'

// The working area, split into three decision tabs over the same selection:
// matrikkelenhet (whole gnr vs single bnr), vegadresse (whole street vs single
// numbers, gated by a coverage check), and the leftover "mnr mangler" teiger.
// The Komreg-liste view derives its rows from the decisions made here.
export function ArbeidslisteView() {
  // Self-sufficient route: pulls the working session from the store and the
  // derived views / exports from useExports (no props — the router renders it).
  const { sortedSelected: selected, addresses, addressesLoading, addressesFailed } = useExports()
  const comments = useStore((s) => s.comments)
  const onComment = useStore((s) => s.setComment)
  const onRemove = useStore((s) => s.removeTeig)
  const onClearAll = useStore((s) => s.clearAll)
  const wholeGnr = useStore((s) => s.wholeGnr)
  const onToggleWholeGnr = useStore((s) => s.toggleWholeGnr)
  const wholeAdressekode = useStore((s) => s.wholeAdressekode)
  const onToggleWholeAdressekode = useStore((s) => s.toggleWholeAdressekode)
  const coverage = useStore((s) => s.coverage)
  const gnrCoverage = useStore((s) => s.gnrCoverage)
  const { onCheckCoverage, onCheckGnrCoverage, onAddAllBnr } = useCoverageActions()

  const [tab, setTab] = useState<ArbeidslisteTab>('matrikkelenhet')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (mk: string) => setExpanded((prev) => toggled(prev, mk))
  // Collapsed gnr groups (click the group header to fold its bnr list away).
  const [foldedGnr, setFoldedGnr] = useState<Set<string>>(new Set())
  const toggleFold = (gk: string) => setFoldedGnr((prev) => toggled(prev, gk))

  // Matrikkelenheter grouped by gnr → its distinct bnr (matrikkelKey) → teiger.
  const mnGroups = (() => {
    const groups = new Map<
      string,
      {
        kommunenummer: string | null
        gardsnummer: number
        units: Map<string, { label: string; teiger: SelectedTeig[] }>
      }
    >()
    for (const s of selected) {
      const gk = gnrKey(s.props)
      const mk = matrikkelKey(s.props)
      if (!gk || !mk || s.props.gardsnummer == null) continue
      let g = groups.get(gk)
      if (!g) {
        g = {
          kommunenummer: s.props.kommunenummer,
          gardsnummer: s.props.gardsnummer,
          units: new Map(),
        }
        groups.set(gk, g)
      }
      let u = g.units.get(mk)
      if (!u) {
        u = { label: matrikkelLabel(s.props), teiger: [] }
        g.units.set(mk, u)
      }
      u.teiger.push(s)
    }
    return [...groups.entries()].map(([gk, g]) => ({
      gnrKey: gk,
      kommunenummer: g.kommunenummer,
      gardsnummer: g.gardsnummer,
      units: [...g.units.entries()].map(([mk, u]) => ({ mKey: mk, ...u })),
    }))
  })()

  // Streets (adressekode) present in the selection, with the house numbers held.
  const vegGroups = (() => {
    const m = new Map<
      string,
      {
        kommunenummer: string | null
        adressekode: number
        adressenavn: string
        numbers: Set<number>
      }
    >()
    for (const s of selected) {
      const mk = matrikkelKey(s.props)
      const addr = mk ? addresses[mk] : undefined
      if (!Array.isArray(addr)) continue
      for (const a of addr) {
        if (a.nummer == null) continue
        // No adressekode = a matrikkeladresse = no street to show a "flytt hele" row for.
        if (a.adressekode == null) continue
        const key = adressekodeKey(s.props.kommunenummer, a.adressekode)
        let g = m.get(key)
        if (!g) {
          g = {
            kommunenummer: s.props.kommunenummer,
            adressekode: a.adressekode,
            adressenavn: a.adressenavn,
            numbers: new Set(),
          }
          m.set(key, g)
        }
        g.numbers.add(a.nummer)
      }
    }
    return [...m.entries()].map(([key, g]) => ({ key, ...g }))
  })()

  // The unregistered teiger (no gnr) — komreg moves these by teig-id alone.
  const teigOnly = selected.filter((s) => s.props.gardsnummer == null)

  const tabs: { id: ArbeidslisteTab; label: string; count: number }[] = [
    {
      id: 'matrikkelenhet',
      label: 'Matrikkelenhet',
      count: mnGroups.reduce((n, g) => n + g.units.length, 0),
    },
    { id: 'vegadresse', label: 'Veg', count: vegGroups.length },
    { id: 'teig', label: 'Mnr mangler teig', count: teigOnly.length },
  ]

  return (
    <div className="overlay-page">
      <div className="overlay-header">
        <ListNav />
        <div className="font-semibold">Arbeidsliste ({selected.length})</div>
        {/* Every decision on this page edits the working state, so it needs to be
            saveable here — the same bar the map floats, not a second save button. */}
        <SessionBar />
        <div className="flex-1" />
        {addressesLoading && (
          <span className="text-xs text-muted-foreground">henter adresser…</span>
        )}
        {addressesFailed && (
          <span className="text-xs text-destructive">
            adressesøk feilet — last inn siden på nytt
          </span>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (window.confirm('Fjerne alle valgte teiger?')) onClearAll()
          }}
        >
          Fjern alle
        </Button>
      </div>

      <MatrikkelsjekkPanel />

      {/* Sub-tabs. The last three are a decision surface per komreg row type over the
          selection; the first is the other row source — whole kommuner, which carry no
          teiger and so leave those three empty. */}
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as ArbeidslisteTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-3.5 mt-2 w-fit">
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label} ({t.count})
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex-1 overflow-auto px-3.5 pb-3.5">
          <TabsContent value="matrikkelenhet">
            {mnGroups.length === 0 ? (
              <div className="p-4 text-muted-foreground">Ingen matrikkelenheter valgt.</div>
            ) : (
              mnGroups.map((g) => {
                const isWhole = wholeGnr.includes(g.gnrKey)
                const folded = foldedGnr.has(g.gnrKey)
                // Coverage: distinct bnr selected vs the total in the gnr-serie, filled
                // by either "Sjekk dekning" or "Legg til alle bnr". Mirrors the
                // vegadresse tab — this is the evidence for the "Hele gnr" flag.
                const cov = gnrCoverage[g.gnrKey]
                const selBnr = new Set(
                  g.units.flatMap((u) => u.teiger.map((t) => t.props.bruksnummer ?? 0)),
                ).size
                const totalBnr = typeof cov === 'number' ? cov : undefined
                const covComplete = totalBnr != null && selBnr >= totalBnr
                return (
                  <div key={g.gnrKey} className="mb-5">
                    <div className="flex items-center gap-3.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggleFold(g.gnrKey)}
                        title={folded ? 'Vis bruksnummer' : 'Skjul bruksnummer'}
                        aria-expanded={!folded}
                        className="flex items-center gap-1.5 font-semibold"
                      >
                        {folded ? (
                          <ChevronRight className="size-4 shrink-0" />
                        ) : (
                          <ChevronDown className="size-4 shrink-0" />
                        )}
                        {g.kommunenummer} · gnr {g.gardsnummer}
                      </button>
                      <label
                        className="flex items-center gap-1.5"
                        title="Flytt alle bruksnummer i dette gårdsnummeret som én rad"
                      >
                        <Checkbox
                          checked={isWhole}
                          onCheckedChange={() => onToggleWholeGnr(g.gnrKey)}
                        />
                        Hele gnr (alle bnr)
                      </label>
                      {isWhole && <span className="text-xs text-success">flyttes samlet</span>}
                      {/* Coverage is guidance, not a lock: warn if flagged whole but the
                          selection is missing bruksnummer from the serie. Same contract as
                          the vegadresse tab. */}
                      {isWhole && totalBnr != null && !covComplete && (
                        <span className="flex items-center gap-1 text-xs text-warning">
                          <TriangleAlert className="size-3.5" />
                          mangler bnr ({selBnr}/{totalBnr})
                        </span>
                      )}
                      <div className="flex-1" />
                      {cov === 'loading' ? (
                        <span className="text-xs text-muted-foreground">sjekker…</span>
                      ) : totalBnr != null ? (
                        <span
                          className={covComplete ? 'text-xs text-success' : 'text-xs text-warning'}
                        >
                          {selBnr} / {totalBnr} bnr{covComplete ? ' ✓' : ''}
                        </span>
                      ) : (
                        // Answers "do I already have the whole serie?" without touching the
                        // selection — the decision the Hele gnr checkbox needs, which
                        // "Legg til alle bnr" would pre-empt by just adding them.
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => onCheckGnrCoverage(g.kommunenummer, g.gardsnummer)}
                          title="Tell bruksnummer i gårdsnummeret uten å endre utvalget (Kartverket)"
                        >
                          Sjekk dekning
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={cov === 'loading'}
                        onClick={() => onAddAllBnr(g.kommunenummer, g.gardsnummer)}
                        title="Hent og legg til alle bruksnummer som finnes i dette gårdsnummeret (Kartverket)"
                      >
                        {cov === 'loading' ? 'henter…' : 'Legg til alle bnr'}
                      </Button>
                    </div>
                    {!folded && (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Matrikkelnummer</TableHead>
                            <TableHead>Antall teiger</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {g.units.map((u) => (
                            <Fragment key={u.mKey}>
                              <TableRow>
                                <TableCell>{u.label}</TableCell>
                                <TableCell>{u.teiger.length}</TableCell>
                                <TableCell>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => toggleExpand(u.mKey)}
                                  >
                                    {expanded.has(u.mKey) ? 'Skjul' : 'Vis'} teiger
                                  </Button>
                                </TableCell>
                              </TableRow>
                              {expanded.has(u.mKey) && (
                                <TableRow>
                                  <TableCell colSpan={3}>
                                    <div className="flex flex-col gap-1">
                                      {u.teiger.map((t) => (
                                        <div key={t.id} className="flex items-center gap-2">
                                          <span className="min-w-[90px]">Teig {t.id}</span>
                                          <Input
                                            type="text"
                                            value={comments[t.id] ?? ''}
                                            onChange={(e) => onComment(t.id, e.target.value)}
                                            placeholder="kommentar…"
                                            className="max-w-md flex-1"
                                          />
                                          <Button
                                            type="button"
                                            size="icon"
                                            variant="ghost"
                                            className="size-7 shrink-0 text-destructive hover:text-destructive"
                                            onClick={() => onRemove(t.id)}
                                            title="Fjern"
                                            aria-label="Fjern"
                                          >
                                            <X className="size-3.5" />
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </Fragment>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )
              })
            )}
          </TabsContent>

          <TabsContent value="vegadresse">
            {vegGroups.length === 0 ? (
              <div className="p-4 text-muted-foreground">Ingen veger i utvalget ennå.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Vegnavn', 'Adressekode', 'Husnummer (valgt)', 'Dekning', 'Flytt hele'].map(
                      (h) => (
                        <TableHead key={h}>{h}</TableHead>
                      ),
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vegGroups.map((g) => {
                    const have = g.numbers.size
                    const cov = coverage[g.key]
                    const total = typeof cov === 'number' ? cov : undefined
                    const complete = total != null && have >= total
                    const isWhole = wholeAdressekode.includes(g.key)
                    return (
                      <TableRow key={g.key}>
                        <TableCell>{g.adressenavn}</TableCell>
                        <TableCell>{g.adressekode}</TableCell>
                        <TableCell>
                          {have} stk · {[...g.numbers].sort((a, b) => a - b).join(', ')}
                        </TableCell>
                        <TableCell>
                          {cov === 'loading' ? (
                            'sjekker…'
                          ) : total != null ? (
                            <span className={complete ? 'text-success' : 'text-warning'}>
                              {have} / {total}
                              {complete ? ' ✓' : ''}
                            </span>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => onCheckCoverage(g.kommunenummer, g.adressekode)}
                            >
                              Sjekk dekning
                            </Button>
                          )}
                        </TableCell>
                        <TableCell>
                          <label
                            className="flex items-center gap-1.5"
                            title="Flytt hele vegen som én rad (blank husnummer) — en veg-transformasjon, ikke vegadresse"
                          >
                            <Checkbox
                              checked={isWhole}
                              onCheckedChange={() => onToggleWholeAdressekode(g.key)}
                            />
                            Flytt hele vegen
                          </label>
                          {/* Coverage is guidance, not a lock: warn if flagged but
                              we don't hold every house number on the street. */}
                          {isWhole && total != null && !complete && (
                            <div className="flex items-center gap-1 text-xs text-warning">
                              <TriangleAlert className="size-3.5" />
                              mangler husnummer ({have}/{total})
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </TabsContent>

          <TabsContent value="teig">
            {teigOnly.length === 0 ? (
              <div className="p-4 text-muted-foreground">Ingen teiger uten matrikkelnummer.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Teig-ID', 'Kommune', 'Status', 'Kommentar', ''].map((h) => (
                      <TableHead key={h}>{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teigOnly.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.id}</TableCell>
                      <TableCell>{t.props.kommunenummer ?? '–'}</TableCell>
                      <TableCell>{statusText(t.props)}</TableCell>
                      <TableCell>
                        <Input
                          type="text"
                          value={comments[t.id] ?? ''}
                          onChange={(e) => onComment(t.id, e.target.value)}
                          placeholder="…"
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 text-destructive hover:text-destructive"
                          onClick={() => onRemove(t.id)}
                          title="Fjern"
                          aria-label="Fjern"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
