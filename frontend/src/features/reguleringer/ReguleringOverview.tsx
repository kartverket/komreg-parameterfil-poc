import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRegulering, setReguleringArchived } from './reguleringer'
import { REGULERINGER_KEY, reguleringerQuery } from './queries'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { DatoInfo } from './DatoInfo'
import { cn } from '@/lib/utils'

// Local date as YYYY-MM-DD — Date.toISOString() would give UTC and miss the date late in
// the evening. The date field is prefilled with this.
const todayIso = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function ReguleringOverview() {
  const navigate = useNavigate(),
    qc = useQueryClient()
  const [showArchived, setShowArchived] = useState(false),
    [creating, setCreating] = useState(false)
  const [navn, setNavn] = useState(''),
    [dato, setDato] = useState(todayIso)
  const query = useQuery(reguleringerQuery(showArchived))
  const create = useMutation({
    mutationFn: () => createRegulering({ navn, dato, listIds: [] }),
    onSuccess: async (id) => {
      await qc.invalidateQueries({ queryKey: REGULERINGER_KEY })
      void navigate({ to: '/reguleringer/$reguleringId', params: { reguleringId: String(id) } })
    },
    onError: (e) => window.alert(e.message),
  })
  const archive = useMutation({
    mutationFn: ({ id, value }: { id: number; value: boolean }) => setReguleringArchived(id, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: REGULERINGER_KEY }),
  })
  return (
    <div className="overlay-page">
      <div className="overlay-header">
        <Link
          to="/"
          className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')}
        >
          ← Grensejusteringer
        </Link>
        <div className="font-semibold">Reguleringer ({query.data?.length ?? 0})</div>
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} />
          Vis arkiverte
        </label>
        <Button onClick={() => setCreating(!creating)}>Ny regulering</Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {creating && (
          <div className="mb-5 grid max-w-4xl grid-cols-[1fr_12rem_auto] items-end gap-3 rounded border border-input p-3">
            <label className="text-sm">
              Navn
              <Input value={navn} onChange={(e) => setNavn(e.target.value)} />
            </label>
            <div className="text-sm">
              <span className="flex items-center gap-1">
                Dato
                <DatoInfo />
              </span>
              <Input type="date" value={dato} onChange={(e) => setDato(e.target.value)} />
            </div>
            <Button disabled={!navn || !dato || create.isPending} onClick={() => create.mutate()}>
              Opprett
            </Button>
          </div>
        )}
        {query.isError ? (
          <p className="text-destructive">Kunne ikke hente reguleringer.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  'Navn',
                  'Base-id',
                  'Dato',
                  'Grensejusteringer',
                  'Siste test',
                  'Oppdatert',
                  '',
                ].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data ?? []).map((r) => (
                <TableRow key={r.id} className={r.archivedAt ? 'opacity-60' : ''}>
                  <TableCell className="font-medium">{r.navn}</TableCell>
                  <TableCell className="font-mono text-xs">{r.baseId}</TableCell>
                  <TableCell>{r.dato}</TableCell>
                  <TableCell>{r.listCount}</TableCell>
                  <TableCell>{r.latestRunStatus ?? '–'}</TableCell>
                  <TableCell>{r.updatedAt.slice(0, 16)}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Link
                        to="/reguleringer/$reguleringId"
                        params={{ reguleringId: String(r.id) }}
                        className={buttonVariants({ size: 'sm' })}
                      >
                        Åpne
                      </Link>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => archive.mutate({ id: r.id, value: !r.archivedAt })}
                      >
                        {r.archivedAt ? 'Gjenopprett' : 'Arkiver'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
