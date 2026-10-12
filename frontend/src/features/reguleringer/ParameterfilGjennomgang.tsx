import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { searchAdresser } from '@/data/external'
import { kommunerQuery } from '@/data/kommunerQuery'
import { adressekoder, lesParameterfil, type Flytting, type ParGjennomgang } from './gjennomgang'
import { Button } from '@/components/ui/button'

/**
 * The parameterfil as a fagperson reads it: per kommunepar, what moves and to which number.
 * Built from the payload string itself (see gjennomgang.ts for why not from the rows), so
 * what is checked here is what is sent or was sent.
 *
 * Kommune names come from the shared ['kommuner'] query — the same cache KomregTable uses —
 * and are a convenience only: a number without a name still renders.
 */
export function ParameterfilGjennomgang({ json }: { json: string }) {
  const gjennomgang = useMemo(() => {
    try {
      return { ok: true as const, g: lesParameterfil(json) }
    } catch (e) {
      console.error(e)
      return { ok: false as const, melding: (e as Error).message }
    }
  }, [json])
  const { data: kommuner } = useQuery(kommunerQuery)
  const navn = (k: string) => {
    const n = kommuner?.get(k)
    return n ? `${n} (${k})` : k
  }

  // Street names, one address search per distinct street. Fetched by themselves only up to
  // VEGNAVN_AUTO streets: a 2028-sized file names hundreds, and firing that many requests
  // on opening a review is the useAddresses lesson again. Past it, a button asks first.
  const koder = gjennomgang.ok ? adressekoder(gjennomgang.g) : []
  const [hentVegnavn, setHentVegnavn] = useState(false)
  const vegnavnPa = koder.length <= VEGNAVN_AUTO || hentVegnavn
  const vegnavnSvar = useQueries({
    queries: koder.map(({ kommune, adressekode }) => ({
      queryKey: ['vegnavn', kommune, adressekode],
      queryFn: async () =>
        (await searchAdresser(kommune, { adressekode: Number(adressekode) })).find(
          (a) => a.adressenavn,
        )?.adressenavn ?? null,
      enabled: vegnavnPa,
      staleTime: Infinity,
    })),
  })
  const vegnavnMap = new Map(
    koder.map((k, i) => [`${k.kommune}-${k.adressekode}`, vegnavnSvar[i]?.data ?? null]),
  )

  // Printing renders a second copy straight under <body> and hides #root, rather than
  // trying to print the overlay page: that is a fixed, scrolling container, and print
  // would clip it to one screen. The copy exists only while the print dialog is up.
  const [skriver, setSkriver] = useState(false)
  useEffect(() => {
    if (!skriver) return
    const ferdig = () => setSkriver(false)
    window.addEventListener('afterprint', ferdig)
    window.print()
    return () => window.removeEventListener('afterprint', ferdig)
  }, [skriver])

  if (!gjennomgang.ok) return <p className="text-sm text-destructive">{gjennomgang.melding}</p>
  const g = gjennomgang.g
  const innhold = (
    <div className="flex flex-col gap-4">
      <div className="text-sm">
        <div className="font-semibold">{g.navn}</div>
        <div className="text-muted-foreground">
          Ikrafttredelse {g.dato} · {g.par.length} kommunepar · {g.antall} transformasjoner ·{' '}
          <span className="font-mono">{g.id}</span>
        </div>
      </div>
      {g.par.map((p) => (
        <Par
          key={p.id}
          p={p}
          navn={navn}
          vegnavn={(ak) => vegnavnMap.get(`${p.fraKommune}-${ak}`) ?? undefined}
        />
      ))}
    </div>
  )
  return (
    <div className="flex flex-col gap-3 rounded border border-input p-3">
      <div className="flex items-center gap-2">
        <div className="text-sm font-medium">Gjennomgang av parameterfila</div>
        <div className="flex-1" />
        {!vegnavnPa && (
          <Button size="sm" variant="secondary" onClick={() => setHentVegnavn(true)}>
            Hent vegnavn ({koder.length})
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setSkriver(true)}>
          Skriv ut
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Lest ut av fila som sendes, ikke av komreg-lista. <Merke>nytt nummer</Merke> betyr at
        nummeret endres, ikke bare kommunen — det er de radene som må holdes opp mot vedtaket.
      </p>
      {innhold}
      {skriver && createPortal(<div className="utskrift">{innhold}</div>, document.body)}
    </div>
  )
}

const VEGNAVN_AUTO = 40

function Par({
  p,
  navn,
  vegnavn,
}: {
  p: ParGjennomgang
  navn: (k: string) => string
  vegnavn: (adressekode: string) => string | undefined
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="text-sm font-semibold">
        {navn(p.fraKommune)} → {navn(p.tilKommune)}
        {p.fylkesbytte && <span className="ml-2 font-normal text-warning">bytter fylke</span>}
        <span className="ml-2 font-normal text-muted-foreground">{p.antall} transformasjoner</span>
      </h3>
      <Liste tittel="Hele gårder (gnr)" rader={p.heleGarder} navn={navn} />
      <Liste tittel="Matrikkelenheter (gnr/bnr)" rader={p.bruksnumre} navn={navn} />
      <Liste tittel="Veger (adressekode)" rader={p.veger} navn={navn} vegnavn={vegnavn} />
      <Liste tittel="Vegadresser" rader={p.vegadresser} navn={navn} vegnavn={vegnavn} />
      {p.teiger.length > 0 && (
        <Del tittel="Teiger uten matrikkelnummer (teig-id, beholdes)" antall={p.teiger.length}>
          <div className="font-mono text-xs break-words">{p.teiger.join(', ')}</div>
        </Del>
      )}
      {p.andre.length > 0 && (
        <p className="text-xs text-warning">
          Andre transformasjoner som ikke vises her: {p.andre.join(', ')}
        </p>
      )}
    </section>
  )
}

function Liste({
  tittel,
  rader,
  navn,
  vegnavn,
}: {
  tittel: string
  rader: Flytting[]
  navn: (k: string) => string
  vegnavn?: (adressekode: string) => string | undefined
}) {
  if (!rader.length) return null
  const nye = rader.filter((r) => r.nyttNummer).length
  return (
    <Del tittel={tittel} antall={rader.length} nye={nye}>
      <table className="w-full text-xs">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="w-1/3 font-normal">Fra</th>
            <th className="font-normal">Til</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rader.map((r) => (
            <tr key={r.fra}>
              <td>
                {r.fra}
                {r.adressekode && vegnavn?.(r.adressekode) && (
                  <span className="ml-2 font-sans text-muted-foreground">
                    {vegnavn(r.adressekode)}
                  </span>
                )}
              </td>
              <td>
                {r.til}
                {r.nyttNummer && <Merke>nytt nummer</Merke>}
                {r.tilKommune && <Merke>til {navn(r.tilKommune)}</Merke>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Del>
  )
}

// A <details> per kind, open by default: long lists fold away without a state of their own.
// The print copy is a fresh tree, so it starts open whatever was folded on screen.
function Del({
  tittel,
  antall,
  nye,
  children,
}: {
  tittel: string
  antall: number
  nye?: number
  children: React.ReactNode
}) {
  return (
    <details open className="text-sm">
      <summary className="cursor-pointer">
        {tittel}: {antall}
        {!!nye && <span className="text-muted-foreground"> ({nye} med nytt nummer)</span>}
      </summary>
      <div className="mt-1 pl-4">{children}</div>
    </details>
  )
}

function Merke({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-2 rounded bg-warning/15 px-1 font-sans text-[11px] text-warning">
      {children}
    </span>
  )
}
