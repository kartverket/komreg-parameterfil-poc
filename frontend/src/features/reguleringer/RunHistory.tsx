import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ListSummary } from '@/data/lists'
import { RUN_STATUS_TEXT, testRunPayloadUrl, type TestRun } from './reguleringer'
import { testRunPayloadQuery } from './queries'
import { ParameterfilGjennomgang } from './ParameterfilGjennomgang'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// The test runs of one saved regulering, newest first. Display plus one action: starting a
// run that was sent but not started goes back to the page through `onStart`, because the
// confirm that names the target lives there and there is to be one of it.
export function RunHistory({
  id,
  runs,
  lists,
  onStart,
  starting,
}: {
  id: number
  runs: TestRun[]
  lists: ListSummary[]
  onStart: (run: TestRun) => void
  starting: boolean
}) {
  const currentVersions = new Map(lists.map((list) => [list.id, list.updatedAt]))
  // One run reviewed at a time. A sent-not-started run is exactly the one someone opens
  // this for, before pressing Start, so the review sits right under the table.
  const [vist, setVist] = useState<number | null>(null)
  const payload = useQuery(testRunPayloadQuery(id, vist))
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Testhistorikk ({runs.length})</h2>
      {!runs.length ? (
        <p className="text-sm text-muted-foreground">Ingen testkjøringer ennå.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Opprettet</TableHead>
              <TableHead>Utvalg</TableHead>
              <TableHead>Komreg-id</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.createdAt.slice(0, 16)}</TableCell>
                <TableCell>
                  {r.sources.map((s) => s.name).join(', ')}
                  {r.sources.some((s) => currentVersions.get(s.listId) !== s.updatedAt) && (
                    <span className="ml-2 text-xs text-warning">endret siden testen</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.externalId}</TableCell>
                <TableCell title={r.startMessage ?? r.sendMessage ?? ''}>
                  {RUN_STATUS_TEXT[r.status] ?? r.status}
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setVist(vist === r.id ? null : r.id)}
                  >
                    {vist === r.id ? 'Skjul' : 'Vis'}
                  </Button>
                  {r.status === 'sent' && (
                    <Button size="sm" onClick={() => onStart(r)} disabled={starting}>
                      Start
                    </Button>
                  )}
                  <a
                    className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                    href={testRunPayloadUrl(id, r.id)}
                  >
                    Last ned
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {vist != null &&
        (payload.isPending ? (
          <p className="text-sm text-muted-foreground">Henter parameterfila…</p>
        ) : payload.isError ? (
          <p className="text-sm text-destructive">{payload.error.message}</p>
        ) : (
          <ParameterfilGjennomgang json={payload.data} />
        ))}
    </section>
  )
}
