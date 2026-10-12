import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type KomregRow, type NewValues } from '@/domain/domain'
import { useStore } from './store'
import { useExports } from './useExports'
import { kommunerQuery } from '@/data/kommunerQuery'
import { type KomregIssue, checkSnapshot, issuesByRow, countIssues } from '@/checks/validate'
import { ListNav } from './components/ListNav'
import { SessionBar } from './components/SessionPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Readable "from" label for a komreg row.
function komregFra(r: KomregRow): string {
  if (r.type === 'teig') return `teig ${r.teigid}`
  const veg = r.adressenavn ? `veg ${r.adressekode} ${r.adressenavn}` : `veg ${r.adressekode}`
  if (r.type === 'veg') return `${r.kommunenummer} · ${veg} (hele)`
  if (r.type === 'vegadresse') return `${r.kommunenummer} · ${veg} nr ${r.adressenummer}`
  return `${r.kommunenummer} · ${r.gardsnummer}/${r.bruksnummer ?? 'alle'}`
}

const ISSUE_CLASS: Record<KomregIssue['level'], string> = {
  error: 'text-destructive',
  warning: 'text-warning',
  info: 'text-muted-foreground',
}

// Full-screen editable komreg list: batch target kommune + per-row new values.
export function KomregTable() {
  const { komregRows, addressesLoading, addressesFailed } = useExports()
  const batchKommune = useStore((s) => s.batchKommune)
  const setBatchKommune = useStore((s) => s.setBatchKommune)
  const newValues = useStore((s) => s.newValues)
  const setNewValue = useStore((s) => s.setNewValue)
  const komregCheck = useStore((s) => s.komregCheck)
  const runKomregCheck = useStore((s) => s.runKomregCheck)
  const applyRowGnrOffset = useStore((s) => s.applyRowGnrOffset)
  const clearRowGnrValues = useStore((s) => s.clearRowGnrValues)

  // The amount to shift by. Ephemeral: pressing the button writes the result into
  // newValues, so the box itself is an input, not state worth persisting. 200 because
  // that (or 100) is what a real renumbering uses — a round number keeps the old gnr
  // readable in the new one.
  const [gnrOffset, setGnrOffset] = useState('200')

  // Kommune names for the "4601 Bergen" hint next to each target box, so a mistyped number
  // is visible before anyone presses anything.
  const { data: kommuner } = useQuery(kommunerQuery)
  const kommuneNavn = (v: string) => kommuner?.get(v.trim()) ?? ''

  const byRow = issuesByRow(komregCheck.issues)
  const { errors, warnings } = countIssues(komregCheck.issues)
  // A result computed before the last edit no longer describes what would be exported, so
  // say so instead of leaving a stale all-clear on screen.
  const stale =
    komregCheck.status === 'done' &&
    komregCheck.snapshot !== checkSnapshot(komregRows, batchKommune, newValues)
  const running = komregCheck.status === 'running'

  function onCheck() {
    void runKomregCheck(komregRows).catch((e: unknown) => {
      console.error('komreg check failed', e)
      window.alert('Kunne ikke sjekke verdiene mot registrene')
    })
  }

  // Blank → undefined, so the row falls back to its default rather than NaN.
  const num = (v: string) => (v === '' ? undefined : Number(v))
  return (
    <div className="overlay-page">
      <div className="overlay-header">
        <ListNav />
        <div className="font-semibold">Komreg-liste ({komregRows.length})</div>
        <SessionBar />
        <label className="flex items-center gap-1.5 text-sm">
          Flytt til kommune
          <Input
            type="text"
            inputMode="numeric"
            value={batchKommune}
            onChange={(e) => setBatchKommune(e.target.value)}
            placeholder="f.eks. 4601"
            className="w-24"
          />
          {kommuneNavn(batchKommune) && (
            <span className="text-xs text-muted-foreground">{kommuneNavn(batchKommune)}</span>
          )}
        </label>
        <GnrOffsetControl
          rows={komregRows}
          value={gnrOffset}
          onValueChange={setGnrOffset}
          onApply={applyRowGnrOffset}
          onClear={clearRowGnrValues}
          newValues={newValues}
        />
        <div className="flex-1" />
        {addressesLoading && (
          <span className="text-xs text-muted-foreground">henter adresser…</span>
        )}
        {addressesFailed && (
          <span className="text-xs text-destructive">
            adressesøk feilet — last inn siden på nytt
          </span>
        )}
        <CheckSummary
          status={komregCheck.status}
          stale={stale}
          errors={errors}
          warnings={warnings}
        />
        <Button
          type="button"
          variant="outline"
          onClick={onCheck}
          disabled={running || !komregRows.length}
        >
          {running ? 'Sjekker…' : 'Sjekk verdier'}
        </Button>
        {/* Export lives on the regulering page: this table is where the values are
            decided, that is where they are named and turned into a payload. */}
        <Button asChild>
          <Link to="/reguleringer">Til reguleringer →</Link>
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              {['Type', 'Fra', 'Ny kommune', 'Nye verdier', 'Sjekk'].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {komregRows.map((r) => {
              const nv = newValues[r.id]
              const nyKommune = nv?.nyKommunenummer ?? ''
              return (
                <TableRow key={r.id}>
                  <TableCell>{r.type}</TableCell>
                  <TableCell>{komregFra(r)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={nyKommune}
                        onChange={(e) => setNewValue(r.id, { nyKommunenummer: e.target.value })}
                        placeholder={batchKommune || '—'}
                        className="w-24"
                      />
                      <span className="text-xs text-muted-foreground">
                        {kommuneNavn(nyKommune || batchKommune)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.type === 'matrikkelenhet' && (
                      <div className="flex gap-1.5">
                        <Input
                          type="number"
                          value={nv?.nyGardsnummer ?? ''}
                          onChange={(e) =>
                            setNewValue(r.id, { nyGardsnummer: num(e.target.value) })
                          }
                          placeholder={`gnr ${r.gardsnummer}`}
                          className="w-20"
                        />
                        <Input
                          type="number"
                          value={nv?.nyBruksnummer ?? ''}
                          onChange={(e) =>
                            setNewValue(r.id, { nyBruksnummer: num(e.target.value) })
                          }
                          placeholder={`bnr ${r.bruksnummer ?? 'alle'}`}
                          className="w-20"
                        />
                      </div>
                    )}
                    {r.type === 'vegadresse' && (
                      <div className="flex gap-1.5">
                        <Input
                          type="number"
                          value={nv?.nyAdressekode ?? ''}
                          onChange={(e) =>
                            setNewValue(r.id, { nyAdressekode: num(e.target.value) })
                          }
                          placeholder={`kode ${r.adressekode}`}
                          className="w-24"
                        />
                        <Input
                          type="number"
                          value={nv?.nyAdressenummer ?? ''}
                          onChange={(e) =>
                            setNewValue(r.id, { nyAdressenummer: num(e.target.value) })
                          }
                          placeholder={`nr ${r.adressenummer}`}
                          className="w-20"
                        />
                      </div>
                    )}
                    {r.type === 'veg' && (
                      <Input
                        type="number"
                        value={nv?.nyAdressekode ?? ''}
                        onChange={(e) => setNewValue(r.id, { nyAdressekode: num(e.target.value) })}
                        placeholder={`kode ${r.adressekode}`}
                        className="w-24"
                      />
                    )}
                    {r.type === 'teig' && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    {/* Dimmed rather than hidden while stale: the findings are still the
                        last thing we actually know, and hiding them mid-edit reads as
                        "resolved". */}
                    <div className={`flex flex-col gap-0.5 text-xs ${stale ? 'opacity-50' : ''}`}>
                      {(byRow.get(r.id) ?? []).map((i) => (
                        <span key={i.text} className={ISSUE_CLASS[i.level]}>
                          {i.text}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// Shift every matrikkelenhet row's gårdsnummer at once.
//
// The target kommune's low gårdsnummer are nearly always occupied, so a move lands the whole
// series on numbers the check flags one by one ("Gnr 1 i 1578 Fjord har allerede 41
// bruksnummer"). Renumbering them by hand is one edit per row; this is the same edit made
// once. The rows stay hand-editable afterwards — it writes the same per-row nyGardsnummer
// the inputs below do.
//
// There is nothing to compute the amount against: which numbers are free in the target
// kommune is Kartverket's call, and 100 or 200 is what that call looks like in practice. So
// the amount is typed, and "Sjekk verdier" is what says whether it landed clear.
function GnrOffsetControl({
  rows,
  value,
  onValueChange,
  onApply,
  onClear,
  newValues,
}: {
  rows: KomregRow[]
  value: string
  onValueChange: (v: string) => void
  onApply: (rows: KomregRow[], offset: number) => void
  onClear: (rows: KomregRow[]) => void
  newValues: Record<string, NewValues>
}) {
  // Exactly the rows rowGnrOffsetValues will touch, so the count on the button and the
  // "er brukt" read-back can't disagree with what pressing it does.
  const mrows = rows.filter((r) => r.type === 'matrikkelenhet' && r.gardsnummer != null)
  // 0 is not a shift, and a blank or half-typed "-" is not a number yet.
  const offset = Number(value)
  const gyldig = value.trim() !== '' && Number.isInteger(offset) && offset !== 0

  // Whether this exact offset is already in place, read back out of newValues — so a second
  // press doesn't read as a button that did nothing.
  const brukt =
    gyldig &&
    mrows.length > 0 &&
    mrows.every((r) => newValues[r.id]?.nyGardsnummer === r.gardsnummer! + offset)
  // Any new gnr at all, including one left over from a different offset or typed by hand:
  // that is what "Nullstill" has to take back.
  const harNyeGnr = mrows.some((r) => newValues[r.id]?.nyGardsnummer != null)

  if (!mrows.length) return null
  return (
    <label className="flex items-center gap-1.5 text-sm">
      Forskyv gnr
      <Input
        type="number"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="200"
        className="w-20"
      />
      <Button
        type="button"
        size="sm"
        variant={brukt ? 'secondary' : 'default'}
        disabled={!gyldig || brukt}
        onClick={() => onApply(mrows, offset)}
      >
        {brukt
          ? `+${offset} er brukt`
          : `Forskyv ${mrows.length} gnr${gyldig ? ` +${offset}` : ''}`}
      </Button>
      {harNyeGnr && (
        <Button type="button" size="sm" variant="ghost" onClick={() => onClear(mrows)}>
          Nullstill
        </Button>
      )}
    </label>
  )
}

// Header status for the check: what it found, or why what it found no longer applies.
function CheckSummary({
  status,
  stale,
  errors,
  warnings,
}: {
  status: 'idle' | 'running' | 'done'
  stale: boolean
  errors: number
  warnings: number
}) {
  if (status === 'running') {
    return <span className="text-xs text-muted-foreground">sjekker mot registrene…</span>
  }
  if (status === 'idle') return null
  if (stale) {
    return <span className="text-xs text-warning">verdiene er endret — run sjekken på nytt</span>
  }
  if (!errors && !warnings) {
    return <span className="text-xs text-success">ingen problemer funnet</span>
  }
  const parts = []
  if (errors) parts.push(`${errors} feil`)
  if (warnings) parts.push(`${warnings} advarsler`)
  return (
    <span className={`text-xs ${errors ? 'text-destructive' : 'text-warning'}`}>
      {parts.join(', ')}
    </span>
  )
}
