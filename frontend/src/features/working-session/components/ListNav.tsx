import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

// Shared nav for the in-session pages: back to the map, switch between the work views,
// or out to the landing screen. "Grensejusteringer" leaves the session and unmounts the
// map (see router.tsx) — hence the separator before it.
// TanStack Router marks the active link with data-status="active".
const linkBase = 'rounded-md border px-2.5 py-1.5 text-sm no-underline transition-colors'
const inactive = 'border-input bg-secondary text-secondary-foreground hover:bg-accent'
const activeOn =
  'data-[status=active]:border-primary data-[status=active]:bg-primary data-[status=active]:text-primary-foreground'

export function ListNav() {
  return (
    <nav className="flex gap-1.5">
      <Link to="/kart" className={cn(linkBase, inactive)}>
        ← Kart
      </Link>
      <Link to="/arbeidsliste" className={cn(linkBase, inactive, activeOn)}>
        Arbeidsliste
      </Link>
      <Link to="/komreg" className={cn(linkBase, inactive, activeOn)}>
        Komreg-liste
      </Link>
      <div className="w-2" />
      <Link to="/" className={cn(linkBase, inactive)}>
        Grensejusteringer
      </Link>
    </nav>
  )
}
