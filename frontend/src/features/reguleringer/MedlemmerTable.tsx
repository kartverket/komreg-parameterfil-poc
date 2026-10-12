import type { ListSummary } from '@/data/lists'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Every saved grensejustering, ticked if it is part of this regulering.
export function MedlemmerTable({
  lists,
  members,
  disabled,
  onToggle,
}: {
  lists: ListSummary[]
  members: Set<number>
  disabled: boolean
  onToggle: (listId: number) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Grensejusteringer i reguleringen ({members.size})</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Navn</TableHead>
            <TableHead>Oppdatert</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lists.map((l) => (
            <TableRow key={l.id}>
              <TableCell>
                <Checkbox
                  checked={members.has(l.id)}
                  disabled={disabled}
                  onCheckedChange={() => onToggle(l.id)}
                />
              </TableCell>
              <TableCell>{l.name}</TableCell>
              <TableCell className="text-muted-foreground">{l.updatedAt.slice(0, 16)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  )
}
