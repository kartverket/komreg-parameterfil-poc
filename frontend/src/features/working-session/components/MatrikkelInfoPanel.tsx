import { X } from 'lucide-react'
import { type MatrikkelInfo, addressKey, matrikkelLabel, statusText } from '@/domain/domain'
import { Button } from '@/components/ui/button'

// Right-click "inspect" panel: everything we know about one matrikkelenhet.
// Presentational only — the map (MapView) does the lookups and area calc.
export function MatrikkelInfoPanel({
  info,
  onClose,
}: {
  info: MatrikkelInfo
  onClose: () => void
}) {
  const { props, rawProps, teiger, addresses, areaM2, loading } = info
  const fields: [string, string | number][] = [
    ['Kommune', props.kommunenummer ?? '–'],
    ['Gnr', props.gardsnummer ?? '–'],
    ['Bnr', props.bruksnummer ?? '–'],
    ['Fnr', props.festenummer ?? '–'],
    ['Snr', props.seksjonsnummer ?? '–'],
    ['Areal', areaM2 != null ? `${Math.round(areaM2).toLocaleString('nb-NO')} m²` : '–'],
    ['Antall teiger', teiger.length],
  ]

  return (
    <div className="panel right-3 top-16 z-20 max-h-[calc(100vh-76px)] w-80 overflow-y-auto">
      <div className="flex items-center gap-2">
        <div className="flex-1 font-semibold">{matrikkelLabel(props)}</div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-7 text-destructive hover:text-destructive"
          onClick={onClose}
          title="Lukk"
          aria-label="Lukk"
        >
          <X />
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">
        {statusText(props)}
        {loading ? ' · laster…' : ''}
      </div>

      <div className="flex flex-col gap-0.5">
        {fields.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 text-[13px]">
            <span className="text-muted-foreground">{label}</span>
            <span>{value}</span>
          </div>
        ))}
      </div>

      <div className="mt-2.5 font-semibold">Adresser ({addresses.length})</div>
      {loading ? (
        <div className="text-xs text-muted-foreground">laster…</div>
      ) : addresses.length === 0 ? (
        <div className="text-xs text-muted-foreground">Ingen</div>
      ) : (
        addresses.map((a) => (
          <div key={addressKey(a)} className="text-xs text-address">
            {a.adressetekst}
            {a.adressekode != null && ` · Adressekode ${a.adressekode}`}
          </div>
        ))
      )}

      <div className="mt-2.5 font-semibold">Teiger ({teiger.length})</div>
      {teiger.map((t) => (
        <div key={t.id} className="text-xs">
          Teig {t.id}
        </div>
      ))}

      <details className="mt-2.5">
        <summary className="cursor-pointer font-semibold">Rådata fra API</summary>
        <div className="mt-1 font-mono text-[11px]">
          {Object.entries(rawProps).map(([k, v]) => (
            <div key={k} className="break-all">
              {k}:{' '}
              {typeof v === 'object' ? JSON.stringify(v) : String(v as string | number | boolean)}
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
