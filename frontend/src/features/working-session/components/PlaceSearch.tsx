import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { searchKommuner, type KommuneHit } from '@/data/external'

// The "normal" navigation search (top-center): type a kommune name, pick a match,
// and the map flies there. The fly-to itself lives in MapView (onSelect → flyToBbox).
export function PlaceSearch({ onSelect }: { onSelect: (hit: KommuneHit) => void }) {
  const [value, setValue] = useState('')
  // Debounced query term — avoids a request per keystroke.
  const [term, setTerm] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setTerm(value.trim()), 250)
    return () => clearTimeout(id)
  }, [value])

  const { data: hits = [], isError } = useQuery({
    queryKey: ['kommune-sok', term],
    queryFn: () => searchKommuner(term),
    enabled: term.length >= 2,
    staleTime: Infinity,
  })

  // Dropdown shows once there's a real term with matches.
  const showResults = value.trim().length >= 2 && hits.length > 0

  function pick(hit: KommuneHit) {
    onSelect(hit)
    setValue('')
    setTerm('')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (hits[0]) pick(hits[0]) // Enter → first match
      }}
      className="panel left-1/2 top-3 -translate-x-1/2"
    >
      <div className="flex gap-1.5">
        <Input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setValue('')
          }}
          placeholder="Søk kommune…"
          className="w-[220px]"
        />
        <Button type="submit" variant="secondary" size="icon" title="Søk" aria-label="Søk">
          <Search />
        </Button>
      </div>
      {isError && <div className="text-xs text-destructive">Søk feilet — prøv igjen</div>}
      {showResults && (
        <ul className="flex flex-col">
          {hits.map((hit) => (
            <li key={hit.nummer}>
              <button
                type="button"
                onClick={() => pick(hit)}
                className="flex w-full items-baseline justify-between gap-2 rounded px-2 py-1 text-left hover:bg-accent"
              >
                <span>{hit.navn}</span>
                <span className="text-xs text-muted-foreground">{hit.fylke}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  )
}
