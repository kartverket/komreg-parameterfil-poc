import type { ComponentType } from 'react'
import { ClipboardList, Grid2x2Plus, Layers, MapPin, MapPinPlus, PencilRuler } from 'lucide-react'
import { cn } from '@/lib/utils'

// Bottom-center navbar: toggles the map overlays (selection / layers / draw / address)
// plus the two click modes ("add teig" and grunnkrets). The selection item carries a
// count badge. Pure presentational — the panels' open state and the mode flags live in
// MapView.
export function MapNavbar({
  selectedCount,
  addMode,
  grunnkretsMode,
  showSelected,
  showLayers,
  showDraw,
  showAddress,
  onToggleAddMode,
  onToggleGrunnkretsMode,
  onToggleSelected,
  onToggleLayers,
  onToggleDraw,
  onToggleAddress,
}: {
  selectedCount: number
  addMode: boolean
  grunnkretsMode: boolean
  showSelected: boolean
  showLayers: boolean
  showDraw: boolean
  showAddress: boolean
  onToggleAddMode: () => void
  onToggleGrunnkretsMode: () => void
  onToggleSelected: () => void
  onToggleLayers: () => void
  onToggleDraw: () => void
  onToggleAddress: () => void
}) {
  return (
    <div className="fixed bottom-3 left-1/2 flex -translate-x-1/2 gap-1 rounded-xl bg-card/90 p-1.5 text-card-foreground shadow-panel">
      <NavItem
        icon={ClipboardList}
        label="Teiger"
        active={showSelected}
        onClick={onToggleSelected}
        badge={selectedCount}
      />
      <NavItem icon={MapPinPlus} label="Legg til teig" active={addMode} onClick={onToggleAddMode} />
      <NavItem
        icon={Grid2x2Plus}
        label="Grunnkrets"
        active={grunnkretsMode}
        onClick={onToggleGrunnkretsMode}
      />
      <NavItem icon={MapPin} label="Adressesøk" active={showAddress} onClick={onToggleAddress} />
      <NavItem icon={Layers} label="Kartlag" active={showLayers} onClick={onToggleLayers} />
      <NavItem icon={PencilRuler} label="Tegne og måle" active={showDraw} onClick={onToggleDraw} />
    </div>
  )
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  active: boolean
  onClick: () => void
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative flex min-w-16 flex-col items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
      )}
    >
      <Icon className="size-[18px]" />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-highlight px-1 text-[11px] font-bold text-background">
          {badge}
        </span>
      )}
    </button>
  )
}
