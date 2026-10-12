import { Link } from '@tanstack/react-router'
import { useKomregState } from '@/data/useKjoring'
import { MiljoBadge } from '@/components/MiljoBadge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Thousands separator: the counts that matter here run to five digits, and 12034 vs 1203
// is not a difference to leave to the reader.
const tall = new Intl.NumberFormat('nb-NO')

/**
 * The operations view: what komreg-backend holds, and starting a kjøring.
 *
 * Execution is deliberately absent here. A test starts from its saved regulering so
 * membership, source versions and the exact payload are recorded together.
 *
 * Top-level like /reguleringer, outside the pathless map layout — it reads komreg-backend
 * and no working session, and putting it under the layout would remount OpenLayers.
 */
export function KjoringView() {
  const { reguleringer, reguleringerLoading, reguleringerError, kjorer } = useKomregState()
  return (
    <div className="overlay-page">
      <div className="overlay-header">
        <Link
          to="/"
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')}
        >
          ← Grensejusteringer
        </Link>
        <div className="font-semibold">Kjøring</div>
        <MiljoBadge />
        <div className="flex-1" />
        {/*
          Ikke «kjører nå», selv om ruten heter /is-running: flagget er også true for
          IKKE_TILBAKEFØRT, altså en kjøring som er ferdig men ikke tilbakeført. Se
          useKjorerNa.
        */}
        <div
          className="text-sm text-muted-foreground"
          title="komreg-backend har en kjøring som er i gang, tilbakeføres, eller er kjørt uten å være tilbakeført"
        >
          Aktiv eller ikke tilbakeført kjøring:{' '}
          <span className="font-medium">{kjorer ? 'ja' : 'nei'}</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">
              Reguleringer i komreg-backend ({reguleringer.length})
            </h2>
            {reguleringerLoading && (
              <p className="text-sm text-muted-foreground">henter reguleringer…</p>
            )}
            {reguleringerError && (
              <p className="text-sm text-destructive">
                Fikk ikke kontakt med komreg-backend. På <code>local</code>: kjører den, og på
                riktig port? Den bruker 8080 som standard, samme som vår egen backend — start den
                med <code>PORT=8081</code>. På <code>dev</code>: er du på Kartverket-nettet
                (VPN/Tailscale), og innlogget med <code>az login</code>?
              </p>
            )}
            {!reguleringerLoading && !reguleringerError && reguleringer.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Ingen reguleringer der ennå. Opprett en regulering under{' '}
                <Link to="/reguleringer">Reguleringer</Link>, legg til grensejusteringene, lagre, og
                kjør en test derfra.
              </p>
            )}

            {reguleringer.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Id</TableHead>
                    <TableHead>Navn</TableHead>
                    <TableHead>Ikrafttredelse</TableHead>
                    <TableHead className="text-right" title="Én endring per kommunepar">
                      Endringer
                    </TableHead>
                    <TableHead className="text-right">Transformasjoner</TableHead>
                    <TableHead>Sammensetning</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reguleringer.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id}</TableCell>
                      <TableCell className="font-medium">{r.navn}</TableCell>
                      <TableCell className="text-muted-foreground">{r.dato}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.antallEndringer}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {tall.format(r.antallTransformasjoner)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {Object.entries(r.transformasjonerPerType)
                          .map(([type, antall]) => `${tall.format(antall)} ${type}`)
                          .join(' · ') || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
