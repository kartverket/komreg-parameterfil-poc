import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// Always-visible top-center matrikkelnummer search: "3322-123/1" adds one
// matrikkelenhet, "3322-123" adds a whole gnr-serie. The lookup itself lives in
// MapView; this just owns the input + status line.
export function MatrikkelSearch({
  value,
  message,
  onChange,
  onSubmit,
}: {
  value: string
  message: string
  onChange: (v: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
      className="panel left-1/2 top-3 -translate-x-1/2"
    >
      <div className="flex gap-1.5">
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Søk 3322-123/1 eller 3322-123 (hele gnr)"
          className="w-[220px]"
        />
        <Button type="submit" variant="secondary" size="icon" title="Søk" aria-label="Søk">
          <Search />
        </Button>
      </div>
      {message && <div className="text-xs text-muted-foreground">{message}</div>}
    </form>
  )
}
