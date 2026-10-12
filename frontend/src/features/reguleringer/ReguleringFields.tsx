import { Input } from '@/components/ui/input'
import { DatoInfo } from './DatoInfo'

// The header of a regulering: what it is called and when it takes effect. The base-id is
// shown, not edited: komreg-backend knows the regulering by it.
export function ReguleringFields({
  navn,
  baseId,
  dato,
  disabled,
  onNavn,
  onDato,
}: {
  navn: string
  baseId: string
  dato: string
  disabled: boolean
  onNavn: (navn: string) => void
  onDato: (dato: string) => void
}) {
  return (
    <section className="grid grid-cols-[1fr_1fr_12rem] gap-3">
      <label className="text-sm">
        Navn
        <Input value={navn} onChange={(e) => onNavn(e.target.value)} disabled={disabled} />
      </label>
      <div className="text-sm">
        Komreg base-id
        <div className="mt-1 flex h-9 items-center font-mono text-xs text-muted-foreground">
          {baseId}
        </div>
      </div>
      <div className="text-sm">
        <span className="flex items-center gap-1">
          Ikrafttredelsesdato
          <DatoInfo />
        </span>
        <Input
          type="date"
          value={dato}
          onChange={(e) => onDato(e.target.value)}
          disabled={disabled}
        />
      </div>
    </section>
  )
}
