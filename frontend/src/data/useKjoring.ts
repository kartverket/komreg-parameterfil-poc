import { queryOptions, useQuery } from '@tanstack/react-query'
import { fetchKjorerNa, fetchKomregReguleringer, fetchMiljo } from './kjoring'

// Server state, so TanStack Query rather than the store — and nothing here belongs in
// WorkingState: it is komreg-backend's state, not the session's.
const REGULERINGER = ['komreg', 'reguleringer']
const STATUS = ['komreg', 'status']
const MILJO = ['komreg', 'miljo']

/**
 * Which komreg-backend we are talking to.
 *
 * Not cached for good, though the target only changes when the backend restarts: a tab left
 * open across such a restart would keep naming the old target. The token check behind it is
 * cached server-side, so a refetch is not an `az` invocation.
 *
 * Exported for the run confirm, which fetches it fresh rather than trusting what is shown.
 */
export const miljoQuery = queryOptions({ queryKey: MILJO, queryFn: fetchMiljo })

export function useMiljo() {
  return useQuery(miljoQuery)
}

/**
 * komreg-backend's /is-running. Displayed only — it gates NOTHING, and must not.
 *
 * It is true when any kjøring is KJØRER, STARTET_TILBAKEFØRING or IKKE_TILBAKEFØRT. That
 * last one is a resting state — ran, not rolled back — so the flag stays true forever
 * after a single test run nobody tilbakeførte. It is written to gate a DEPLOY of the dev
 * environment, not a kjøring, and komreg-backend's own conflict check is per regulering
 * (and can never hit us: fresh externalId per run). Gating the Kjør-button on it left the
 * button permanently grey. See docs/adr/0004.
 *
 * Naked boolean besides: no id, no start time, no duration, so it cannot say WHICH.
 */
export function useKjorerNa() {
  return useQuery({ queryKey: STATUS, queryFn: fetchKjorerNa, refetchInterval: 5000 })
}

/**
 * What komreg-backend holds right now, plus whether a kjøring is active.
 *
 * No staleTime: unlike the geo lookups this changes underneath us — a kjøring someone
 * else started, a regulering added from Bruno — so a revisit should refetch.
 */
export function useKomregState() {
  const reguleringer = useQuery({ queryKey: REGULERINGER, queryFn: fetchKomregReguleringer })
  const status = useKjorerNa()
  return {
    reguleringer: reguleringer.data ?? [],
    reguleringerLoading: reguleringer.isPending,
    reguleringerError: reguleringer.error,
    // Unknown counts as "no": it is only ever displayed, and an unreachable
    // /is-running already shows as the error above the table.
    kjorer: status.data ?? false,
  }
}
