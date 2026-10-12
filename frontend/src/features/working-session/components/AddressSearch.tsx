import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { searchAdresser, type AddressQuery } from '@/data/external'
import { addressKey, type AddressInfo } from '@/domain/domain'

// "<knr> <street>" → kommunenummer + the address query. A purely numeric rest is an exact
// adressekode (street code); anything else is a free-text street name (sok). null = the box
// isn't a valid "3322 …" yet, so we don't search.
function parse(value: string): { knr: string; query: AddressQuery } | null {
  const m = value.trim().match(/^(\d{4})\s+(.+)$/)
  if (!m) return null
  const [, knr, rest] = m
  const query = /^\d+$/.test(rest) ? { adressekode: Number(rest) } : { sok: rest }
  return { knr, query }
}

// Address search (navbar → Adressesøk): type a kommunenummer + street, submit, and every
// matching house number is shown on the map. Submit-driven (the map flies on submit, not per
// keystroke). Results are lifted to MapView, which draws the markers and pans.
export function AddressSearch({
  onResults,
  onPick,
}: {
  onResults: (addrs: AddressInfo[]) => void
  onPick: (addr: AddressInfo) => void
}) {
  const [value, setValue] = useState('')
  // The submitted box text — only this drives the query (Enter / the search button).
  const [submitted, setSubmitted] = useState('')
  const parsed = parse(submitted)

  const { data, isFetching, isError } = useQuery({
    queryKey: ['adresse-sok', submitted],
    queryFn: () => searchAdresser(parsed!.knr, parsed!.query),
    enabled: parsed != null,
    staleTime: Infinity,
  })

  // Lift results up so MapView can draw markers + fit the map.
  useEffect(() => {
    if (data) onResults(data)
  }, [data, onResults])

  const hits = data ?? []
  // Status line: progress/result count for the submitted search, else a format hint
  // once the box has (unparseable) text. isError has to come before the count — without
  // it a failed search falls through to hits.length === 0 and reports "Ingen treff",
  // i.e. "the kommune has no such street" when the truth is "the lookup broke".
  let status = ''
  if (parsed) {
    if (isFetching) status = 'søker…'
    else if (isError) status = 'Søk feilet — prøv igjen'
    else status = hits.length ? `${hits.length} treff` : 'Ingen treff'
  } else if (value.trim() && !parse(value)) status = 'Skriv f.eks. 3322 Storgata'

  return (
    <div className="panel left-3 top-3 max-h-[80vh] overflow-y-auto">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSubmitted(value)
        }}
      >
        <div className="flex gap-1.5">
          <Input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Søk 3322 Storgata"
            className="w-[220px]"
          />
          <Button type="submit" variant="secondary" size="icon" title="Søk" aria-label="Søk">
            <Search />
          </Button>
        </div>
      </form>
      {status && <div className="text-xs text-muted-foreground">{status}</div>}
      {hits.length > 0 && (
        <ul className="flex flex-col">
          {hits.map((hit) => (
            <li key={addressKey(hit)}>
              <button
                type="button"
                onClick={() => onPick(hit)}
                className="w-full rounded px-2 py-1 text-left hover:bg-accent"
              >
                {hit.adressetekst}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
