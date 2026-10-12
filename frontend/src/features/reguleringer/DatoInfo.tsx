import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Hover hint next to the date field on the regulering. The date means the same in both
// places (the create form and the detail page), so the explanation lives in one place.
export function DatoInfo() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Hva datoen betyr"
          className="text-muted-foreground hover:text-foreground"
        >
          <Info className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        Ikrafttredelsesdato — når grensejusteringen trer i kraft, og datoen komreg fører endringene
        på. I praksis alltid 1. januar i leveringsåret. Feltet er forhåndsutfylt med dagens dato;
        sett den til den faktiske datoen.
      </TooltipContent>
    </Tooltip>
  )
}
