import { type ReactNode, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type Column,
  type ColumnDef,
  type SortingState,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { erKode } from '@/data/http'
import { deleteList, type ListSummary } from '@/data/lists'
import { listDeleted, listQuery, listsQuery } from '@/data/listQueries'
import { type WorkingState, kommuneScope, workingStateSchema } from '@/domain/domain'
import { useWorkingList } from './useWorkingList'
import { useStore } from './store'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// Postgres timestamptz text ("2026-07-04 10:30:00.123+00") → local wall time.
// Shown raw it would silently display server (UTC) time; fall back to the raw
// prefix if Date can't parse the format.
function formatUpdated(s: string): string {
  const d = new Date(s.replace(' ', 'T'))
  return Number.isNaN(d.getTime())
    ? s.slice(0, 16)
    : d.toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })
}

// TanStack Table 9 bundles nothing by default: sorting is opted into here. The two sort
// functions are the ones its auto-detection picks for string columns (a name, a timestamp) —
// unregistered, it would fall back to a plain comparison and order names differently.
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
})

// Clickable column header that toggles this column's sort and shows the direction.
// The fallback while the lists load. At module scope so it is the same array on every
// render: the table recomputes its row models whenever `data` is a new array.
const INGEN_LISTER: ListSummary[] = []

function SortHeader({
  column,
  children,
}: {
  column: Column<typeof features, ListSummary>
  children: ReactNode
}) {
  const sorted = column.getIsSorted()
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className="flex items-center gap-1 hover:text-foreground"
    >
      {children}
      {sorted === 'asc' ? (
        <ArrowUp className="size-3.5" />
      ) : sorted === 'desc' ? (
        <ArrowDown className="size-3.5" />
      ) : (
        <ChevronsUpDown className="size-3.5 opacity-50" />
      )}
    </button>
  )
}

// Which kommuner a list touches. Its own component because each row needs its own query:
// the list index carries only id/name/timestamps (the backend keeps the working-state blob
// opaque on purpose), so the scope has to come from fetching each list.
function KommuneScopeCell({ id }: { id: number }) {
  const { data, isError } = useQuery(listQuery(id))
  if (isError) return <span className="text-muted-foreground">–</span>
  if (!data) return <span className="text-muted-foreground">…</span>
  // A blob that no longer parses is worth saying out loud here rather than rendering as
  // "empty" — it's the same failure loadList reports, just seen earlier.
  const parsed = workingStateSchema.safeParse(data.data)
  if (!parsed.success) return <span className="text-warning">ukjent format</span>
  const ws = parsed.data as WorkingState
  const { fra, til } = kommuneScope(ws)
  if (!fra.length) return <span className="text-muted-foreground">tom</span>
  return (
    <span>
      {fra.join(', ')} <span className="text-muted-foreground">→</span>{' '}
      {til.length ? til.join(', ') : <span className="text-muted-foreground">ikke satt</span>}
    </span>
  )
}

// The landing screen: what you're greeted with, and the only place a work session starts.
// Open a saved list (loads its working state and enters the map) or start a new one.
// Columns are sortable (TanStack Table) — defaults to most-recently-updated first.
export function LandingScreen() {
  const navigate = useNavigate()
  const startNewList = useStore((s) => s.startNewList)
  const { loadList } = useWorkingList()
  const queryClient = useQueryClient()
  const { data: items = INGEN_LISTER, isError } = useQuery(listsQuery)
  // Delete, then refetch the list index by invalidating its query.
  const deleteMutation = useMutation({
    mutationFn: deleteList,
    onSuccess: (_, { id }) => {
      // Deleting the list being edited: drop the store's reference so the next
      // save creates a new list instead of PUT-ing the deleted id (404).
      const s = useStore.getState()
      if (s.currentListId === id) s.setCurrentList(null, null, null)
      void listDeleted(queryClient, id)
    },
    onError: (e, { id }) => {
      // Used by a saved regulering: the refusal names them, so ask once more and force it.
      if (erKode(e, 'i-bruk')) {
        if (window.confirm(`${e.message}\n\nFjerne den derfra og slette likevel?`)) {
          deleteMutation.mutate({ id, force: true })
        }
        return
      }
      console.error('delete list failed', e)
      window.alert(e instanceof Error ? e.message : 'Kunne ikke slette grensejusteringen')
    },
  })
  const error = isError ? 'Kunne ikke hente grensejusteringer (kjører backend + database?)' : ''

  // Starting fresh throws the working state away, so it asks first — same contract as
  // loadList, which replaces it with a saved one.
  function newList() {
    if (
      useStore.getState().isDirty() &&
      !window.confirm('Du har ulagrede endringer. Starte en ny grensejustering?')
    ) {
      return
    }
    startNewList()
    void navigate({ to: '/kart' })
  }

  const [sorting, setSorting] = useState<SortingState>([{ id: 'updatedAt', desc: true }])
  const columns: ColumnDef<typeof features, ListSummary>[] = [
    { accessorKey: 'name', header: ({ column }) => <SortHeader column={column}>Navn</SortHeader> },
    {
      id: 'kommuner',
      header: 'Kommuner',
      enableSorting: false,
      cell: ({ row }) => <KommuneScopeCell id={row.original.id} />,
    },
    {
      accessorKey: 'updatedAt',
      header: ({ column }) => <SortHeader column={column}>Oppdatert</SortHeader>,
      cell: (info) => formatUpdated(info.getValue<string>()),
    },
    {
      id: 'actions',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex gap-1.5">
          <Button type="button" size="sm" onClick={() => void loadList(row.original.id)}>
            Åpne
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              // Deleting a saved list is permanent — never on a single misclick.
              if (window.confirm(`Slette grensejusteringen «${row.original.name}»?`)) {
                deleteMutation.mutate({ id: row.original.id })
              }
            }}
          >
            Slett
          </Button>
        </div>
      ),
    },
  ]

  const table = useTable({
    features,
    data: items,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
  })

  return (
    <div className="overlay-page">
      <div className="overlay-header">
        <div className="font-semibold">Grensejusteringer ({items.length})</div>
        <div className="flex-1" />
        {/* Reguleringer group saved lists into deliveries, outside a map session. */}
        <Link
          to="/reguleringer"
          className={cn(buttonVariants({ variant: 'secondary' }), 'no-underline')}
        >
          Regulering →
        </Link>
        {/* What komreg-backend already holds, and starting a run. Reads none of this
            page's state — it just belongs beside the regulering in the flow. */}
        <Link
          to="/kjoring"
          className={cn(buttonVariants({ variant: 'secondary' }), 'no-underline')}
        >
          Kjøring →
        </Link>
        <Button type="button" onClick={newList}>
          Ny grensejustering
        </Button>
      </div>
      {error && <div className="p-3 text-warning">{error}</div>}
      <div className="flex-1 overflow-auto">
        <Table>
          <TableHeader className="sticky top-0 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
