import { Button } from '@/components/ui/button'
import { ParameterfilGjennomgang } from './ParameterfilGjennomgang'
import type { GenererResponse } from './regulering'
import { downloadFile } from './useRegulering'

// A generated parameterfil before anything is sent: the files to download, the pooled one
// first, and the review of what the pooled one says.
export function PreviewFiles({ preview }: { preview: GenererResponse }) {
  return (
    <>
      <div className="flex flex-col gap-1 rounded border border-input p-3">
        <div className="text-sm font-medium">Filer</div>
        {[preview.samlet, ...preview.perPar].map((f) => (
          <div key={f.key} className="flex items-center gap-3 text-sm">
            <span className="flex-1">{f.filnavn}</span>
            <span className="text-muted-foreground">
              {Object.entries(f.antall)
                .map(([k, v]) => `${v} ${k}`)
                .join(', ')}
            </span>
            <Button size="sm" variant="secondary" onClick={() => downloadFile(f)}>
              Last ned
            </Button>
          </div>
        ))}
      </div>
      <ParameterfilGjennomgang json={preview.samlet.json} />
    </>
  )
}
