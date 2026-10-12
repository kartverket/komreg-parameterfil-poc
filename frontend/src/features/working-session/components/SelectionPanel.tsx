import { useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import {
  type SelectedTeig,
  type AddrState,
  addressKey,
  gnrKey,
  formatMatrikkel,
  statusText,
} from '@/domain/domain'
import { cn, toggled } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'

// A contiguous run of selected teiger sharing a gnr (sortedSelected is already
// matrikkel-sorted, so same-gnr teiger sit next to each other).
type GnrGroup = {
  gKey: string | null
  kommunenummer: string | null
  gardsnummer: number | null
  items: SelectedTeig[]
}

function groupByGnr(sorted: SelectedTeig[]): GnrGroup[] {
  const groups: GnrGroup[] = []
  for (const s of sorted) {
    const gKey = gnrKey(s.props)
    const last = groups[groups.length - 1]
    if (last && last.gKey === gKey) last.items.push(s)
    else
      groups.push({
        gKey,
        kommunenummer: s.props.kommunenummer,
        gardsnummer: s.props.gardsnummer,
        items: [s],
      })
  }
  return groups
}

// The "Valgte teiger" overlay (navbar → Teiger): the selection grouped into foldable
// gnr-series. Each gnr header carries the "move all bnr" flag and a "fetch every
// bnr in the gnr" action; the bnr rows below show addresses. Presentational — the
// map, fetching and persistence live in MapView and its hooks.
export function SelectionPanel({
  selected,
  sortedSelected,
  teigAddresses,
  wholeGnr,
  gnrCoverage,
  onToggleWholeGnr,
  onAddAllBnr,
  focusedId,
  onFocusTeig,
  onRemove,
}: {
  selected: SelectedTeig[]
  sortedSelected: SelectedTeig[]
  teigAddresses: Record<number, AddrState>
  wholeGnr: string[]
  gnrCoverage: Record<string, number | 'loading'>
  onToggleWholeGnr: (key: string) => void
  onAddAllBnr: (kommunenummer: string | null, gardsnummer: number) => void
  focusedId: number | null
  onFocusTeig: (teig: SelectedTeig) => void
  onRemove: (id: number) => void
}) {
  // gnr-series that are folded shut. Default: all expanded (empty set).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleFold = (gKey: string) => setCollapsed((prev) => toggled(prev, gKey))

  const groups = groupByGnr(sortedSelected)

  return (
    <div className="panel left-3 top-3 w-[280px]">
      <div className="font-semibold">Valgte teiger ({selected.length})</div>
      <div className="text-xs text-muted-foreground">
        Klikk en teig for å velge hele matrikkelenheten.
      </div>

      <div className="max-h-[50vh] overflow-y-auto">
        {groups.map((g) => {
          const isOpen = !g.gKey || !collapsed.has(g.gKey)
          const cov = g.gKey ? gnrCoverage[g.gKey] : undefined
          const count = `${g.items.length} teig${g.items.length > 1 ? 'er' : ''}`
          return (
            <div key={g.gKey ?? `nognr-${g.items[0].id}`} className="mb-1">
              {/* gnr header: fold toggle + label + count */}
              {g.gKey ? (
                <button
                  type="button"
                  onClick={() => toggleFold(g.gKey!)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm font-semibold hover:bg-accent"
                >
                  {isOpen ? (
                    <ChevronDown className="size-4 shrink-0" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0" />
                  )}
                  <span>
                    {g.kommunenummer}-{g.gardsnummer} · {count}
                  </span>
                </button>
              ) : (
                <div className="px-1.5 py-1 text-sm font-semibold text-muted-foreground">
                  Uten gnr · {count}
                </div>
              )}

              {/* per-gnr controls: "move all bnr" flag + fetch every bnr */}
              {g.gKey && (
                <div className="ml-1.5 flex flex-wrap items-center gap-2 py-1">
                  <label
                    className="flex items-center gap-1.5 text-xs"
                    title="Flytt alle bruksnummer i dette gårdsnummeret som én rad"
                  >
                    <Checkbox
                      checked={wholeGnr.includes(g.gKey)}
                      onCheckedChange={() => onToggleWholeGnr(g.gKey!)}
                    />
                    Hele gnr (alle bnr)
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    disabled={cov === 'loading'}
                    onClick={() =>
                      g.gardsnummer != null && onAddAllBnr(g.kommunenummer, g.gardsnummer)
                    }
                    title="Hent og legg til alle bruksnummer som finnes i dette gårdsnummeret (Kartverket)"
                  >
                    {cov === 'loading' ? 'henter…' : 'Legg til alle bnr'}
                    {typeof cov === 'number' ? ` · ${cov} bnr` : ''}
                  </Button>
                </div>
              )}

              {isOpen &&
                g.items.map((s) => {
                  const addr = teigAddresses[s.id]
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-1.5 border-t border-border py-1"
                    >
                      <button
                        type="button"
                        onClick={() => onFocusTeig(s)}
                        title="Zoom til teig på kartet"
                        className={cn(
                          'min-w-0 flex-1 rounded px-1 py-0.5 text-left hover:bg-accent',
                          focusedId === s.id && 'bg-accent ring-1 ring-primary',
                        )}
                      >
                        <div className="font-semibold">
                          {s.props.kommunenummer}-{formatMatrikkel(s.props)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Teig {s.id} · {statusText(s.props)}
                        </div>
                        {addr === 'loading' && (
                          <div className="text-xs text-muted-foreground">laster adresse…</div>
                        )}
                        {Array.isArray(addr) &&
                          addr.map((a) => (
                            <div key={addressKey(a)} className="text-xs text-address">
                              {a.adressenavn} {a.nummer}
                              {a.bokstav}
                              {a.adressekode != null && ` · Adressekode ${a.adressekode}`}
                            </div>
                          ))}
                      </button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => onRemove(s.id)}
                        title="Fjern"
                        aria-label="Fjern"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
