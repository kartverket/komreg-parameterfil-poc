import { useMiljo } from '@/data/useKjoring'
import { cn } from '@/lib/utils'

/**
 * Which komreg-backend this session talks to.
 *
 * Propless and self-fetching, like `SessionBar`: it is rendered on every page that can
 * trigger something over there, and one component with several mount points is the rule
 * here — a second copy would be the one that forgets to turn red.
 *
 * It earns its place because the target is a single env var away from being DEV, and
 * `TOGGLE_SINK_OFF` is set on the deployed pod rather than by us — so a DEV test run can
 * write to Matrikkelen. Knowing which one you are on should not require reading a
 * terminal.
 */
export function MiljoBadge() {
  const { data: miljo, isPending, error } = useMiljo()

  if (isPending || error || !miljo) return null

  const lokal = miljo.navn === 'local'
  const tokenMangler = miljo.kreverToken && !miljo.tokenOk

  return (
    <span
      // The host, not just the name — "dev" is a word, the hostname is the fact.
      title={tokenMangler ? miljo.tokenFeil : miljo.url}
      className={cn(
        'rounded px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide',
        lokal
          ? 'bg-muted text-muted-foreground'
          : 'bg-destructive/15 text-destructive ring-1 ring-destructive/40',
      )}
    >
      {miljo.navn}
      {tokenMangler && ' — ikke innlogget'}
    </span>
  )
}
