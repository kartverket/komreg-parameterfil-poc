import { KRETS_LAYERS } from '@/data/external'
import { Checkbox } from '@/components/ui/checkbox'

// Toggleable krets/overlay checkboxes (navbar → layers). The map applies
// visibility (zoom-gated) in useOlMap; this just drives the on/off state.
//
// **Just the toggles — no explanatory text.** Every layer here is zoom-gated, but spelling
// that out turned a short list into a wall of small print.
export function LayerPanel({
  visible,
  onToggle,
}: {
  visible: Record<string, boolean>
  onToggle: (id: string, checked: boolean) => void
}) {
  return (
    <div className="panel bottom-3 left-3">
      {KRETS_LAYERS.map((k) => (
        <label key={k.id} className="flex items-center gap-2">
          <Checkbox checked={!!visible[k.id]} onCheckedChange={(c) => onToggle(k.id, c === true)} />
          {k.label}
        </label>
      ))}
    </div>
  )
}
