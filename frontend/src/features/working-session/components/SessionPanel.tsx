import { Link } from '@tanstack/react-router'
import { useStore } from '../store'
import { useWorkingList } from '../useWorkingList'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Which list you are working on, and the one control that saves it.
//
// Self-sufficient: it reads the store and owns the save mutation, so every screen renders
// the same `<SessionBar />` with no props to keep in sync. Saving used to be implemented
// twice — here and in the arbeidsliste header — which is exactly the duplication this
// removes. There is no save-as-copy: you change which list you are on at the top level.
export function SessionBar() {
  const selectedCount = useStore((s) => s.selected.length)
  const currentListId = useStore((s) => s.currentListId)
  const currentListName = useStore((s) => s.currentListName)
  const { saveStatus, saveCurrent } = useWorkingList()
  return (
    <>
      {currentListName ? (
        <span className="max-w-[220px] truncate font-semibold" title={currentListName}>
          {currentListName}
        </span>
      ) : (
        // Not "uten navn": it has no name because it isn't in the lists yet. Utkast is
        // the state, and it's what shows until the first save.
        <span className="text-muted-foreground">Utkast</span>
      )}
      <Button type="button" size="sm" disabled={!selectedCount} onClick={saveCurrent}>
        {currentListId != null ? 'Oppdater' : 'Lagre'}
      </Button>
      {/* Feedback, not a control: flashStatus clears it after a moment. Without it,
          Lagre gives no sign it worked. */}
      {saveStatus && <span className="text-xs text-success">{saveStatus}</span>}
    </>
  )
}

// The map's copy, floating top-right. It carries the navigation too, because the map is
// the one screen with no ListNav. "Arbeidsliste" and "Grensejusteringer" are ListNav's
// words for the same destinations on purpose — the same place gets the same label
// everywhere.
export function SessionPanel() {
  const linkClass = cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')
  return (
    <div className="panel right-3 top-3 max-w-[70vw] flex-row items-center gap-2">
      <SessionBar />
      <div className="flex-1" />
      <Link to="/arbeidsliste" className={linkClass}>
        Arbeidsliste
      </Link>
      {/* Leaving unmounts the map (see router.tsx) but keeps the working state — the
          landing screen offers "Fortsett" to come straight back. */}
      <Link to="/" className={linkClass}>
        Grensejusteringer
      </Link>
    </div>
  )
}
