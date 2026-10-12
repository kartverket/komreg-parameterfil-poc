import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Freehand line-drawing tools (navbar → draw): toggle draw mode + clear lines.
// Visual annotation only; the OpenLayers Draw interaction lives in useOlMap.
export function DrawPanel({
  drawing,
  onToggleDraw,
  onClear,
}: {
  drawing: boolean
  onToggleDraw: () => void
  onClear: () => void
}) {
  return (
    <div className="panel right-3 top-16">
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="icon"
          variant={drawing ? 'default' : 'secondary'}
          aria-pressed={drawing}
          onClick={onToggleDraw}
          title="Tegn linje"
          aria-label="Tegn linje"
        >
          <Pencil />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          onClick={onClear}
          title="Fjern linjer"
          aria-label="Fjern linjer"
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  )
}
