import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { matrikkelLabel, type SelectedTeig } from '@/domain/domain'
import {
  LIVE_HENTERE,
  sjekkMotMatrikkelen,
  type Avvik,
  type Matrikkelsjekk,
} from '@/checks/matrikkelsjekk'
import { useStore } from '../store'
import { Button } from '@/components/ui/button'

/**
 * "Sjekk mot matrikkelen" for the loaded list: what in the saved selection is gone or has
 * changed in the Teig WFS since it was picked. See matrikkelsjekk.ts.
 *
 * Flag, don't fix: every finding is a row with its own action, and an action only edits the
 * working state — nothing is saved until SessionBar's Oppdater, same as any other edit here.
 * A handled row drops off the list; the rest stay until the next check.
 */
export function MatrikkelsjekkPanel() {
  const currentListId = useStore((s) => s.currentListId)
  // A result belongs to the list it was run on. Switching list must not leave another
  // list's "borte" rows offering to remove teiger from this one, so the key starts the
  // panel over: its result, and a check still in flight for the list just left.
  return <Sjekk key={currentListId ?? 'utkast'} />
}

function Sjekk() {
  const selected = useStore((s) => s.selected)
  const addTeiger = useStore((s) => s.addTeiger)
  const removeTeig = useStore((s) => s.removeTeig)
  const [resultat, setResultat] = useState<Matrikkelsjekk | null>(null)

  const sjekk = useMutation({
    mutationFn: () => sjekkMotMatrikkelen(selected, LIVE_HENTERE),
    onSuccess: setResultat,
  })

  const ferdig = (a: Avvik) =>
    setResultat((r) => r && { ...r, avvik: r.avvik.filter((x) => x !== a) })

  return (
    <div className="mx-3.5 mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm">
        <Button
          size="sm"
          variant="secondary"
          disabled={!selected.length || sjekk.isPending}
          onClick={() => sjekk.mutate()}
        >
          {sjekk.isPending ? 'Sjekker…' : 'Sjekk mot matrikkelen'}
        </Button>
        {sjekk.isError && <span className="text-destructive">{sjekk.error.message}</span>}
        {resultat && (
          <span className="text-muted-foreground">
            {resultat.uendret} uendret · {resultat.avvik.length} avvik
            {resultat.ikkeSjekket > 0 && ` · ${resultat.ikkeSjekket} ikke sjekket`}
          </span>
        )}
        {resultat && (
          <Button size="sm" variant="ghost" onClick={() => setResultat(null)}>
            Lukk
          </Button>
        )}
      </div>
      {resultat && resultat.feil.length > 0 && (
        <div className="text-xs text-destructive">
          Noen oppslag feilet, og teigene deres er ikke sjekket (ikke regnet som borte):{' '}
          {resultat.feil.join('; ')}
        </div>
      )}
      {resultat && resultat.avvik.length > 0 && (
        <div className="flex max-h-72 flex-col gap-1 overflow-auto rounded border border-input p-2 text-sm">
          {resultat.avvik.map((a, i) => (
            <AvvikRad
              key={`${a.type}-${a.lagret?.id ?? a.naa?.id}-${i}`}
              a={a}
              onFjern={(t) => {
                removeTeig(t.id)
                ferdig(a)
              }}
              onLeggTil={(t) => {
                // addTeiger replaces by lokalid, so this is also "update to the current
                // version" for a teig that has moved to another matrikkelenhet.
                addTeiger([t])
                ferdig(a)
              }}
              onIgnorer={() => ferdig(a)}
              // A candidate is a hint, not a resolution: the vanished teig is still in the
              // list until someone removes it, so its row stays.
              onLeggTilKandidat={(t) => addTeiger([t])}
            />
          ))}
        </div>
      )}
      {resultat && !resultat.avvik.length && !resultat.feil.length && (
        <div className="text-xs text-muted-foreground">
          Alt i lista finnes fortsatt slik det ble valgt.
        </div>
      )}
    </div>
  )
}

function AvvikRad({
  a,
  onFjern,
  onLeggTil,
  onIgnorer,
  onLeggTilKandidat,
}: {
  a: Avvik
  onFjern: (t: SelectedTeig) => void
  onLeggTil: (t: SelectedTeig) => void
  onIgnorer: () => void
  onLeggTilKandidat: (t: SelectedTeig) => void
}) {
  const navn = (t: SelectedTeig) => `${matrikkelLabel(t.props)} (teig ${t.id})`
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-1 last:border-0">
      {a.type === 'borte' && (
        <>
          <span className="text-destructive">Borte:</span>
          <span>{navn(a.lagret!)}</span>
          <span className="text-xs text-muted-foreground">
            {a.enhetBorte
              ? 'matrikkelenheten har ingen teig lenger'
              : 'teigen er borte, matrikkelenheten finnes'}
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={() => onFjern(a.lagret!)}>
            Fjern
          </Button>
        </>
      )}
      {a.type === 'nyEnhet' && (
        <>
          <span className="text-warning">Endret:</span>
          <span>
            {navn(a.lagret!)} hører nå til {matrikkelLabel(a.naa!.props)}
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={() => onLeggTil(a.naa!)}>
            Oppdater
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onFjern(a.lagret!)}>
            Fjern
          </Button>
        </>
      )}
      {a.type === 'ny' && (
        <>
          <span className="text-warning">Ny:</span>
          <span>{navn(a.naa!)}</span>
          <span className="text-xs text-muted-foreground">
            flytter med enheten/gården, men er ikke i lista
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="secondary" onClick={() => onLeggTil(a.naa!)}>
            Legg til
          </Button>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={onIgnorer}>
        Ignorer
      </Button>
      {a.kandidater && a.kandidater.length > 0 && (
        <div className="basis-full pl-4 text-xs text-muted-foreground">
          Ligger der nå:{' '}
          {a.kandidater.map((k) => (
            <button
              key={k.id}
              type="button"
              className="mr-2 underline"
              title="Legg til i lista"
              onClick={() => onLeggTilKandidat(k)}
            >
              {navn(k)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
