import { useQueries, type QueryClient } from '@tanstack/react-query'
import { type SelectedTeig, type TeigProps, type AddressInfo, matrikkelKey } from '@/domain/domain'
import { fetchAddresses } from './external'

// One representative props bag per matrikkelKey — dedupes siblings sharing a
// matrikkelenhet, so a gnr with twelve teiger is one lookup, not twelve.
function distinctMatrikkelProps(selected: SelectedTeig[]): [string, TeigProps][] {
  const propsByKey = new globalThis.Map<string, TeigProps>()
  for (const s of selected) {
    const k = matrikkelKey(s.props)
    if (k && !propsByKey.has(k)) propsByKey.set(k, s.props)
  }
  return [...propsByKey]
}

// At most this many address lookups exist at once, across every caller.
//
// This is NOT the browser's ~6-per-host cap, which was the previous reasoning for having
// no limit here. That cap governs how many requests are *in flight*; it does nothing about
// how many you may *create*. Selecting a whole kommune hands useQueries ~7 400 keys in one
// tick, every queryFn runs immediately, and Chrome fails the lot with
// ERR_INSUFFICIENT_RESOURCES before the first one returns. The gate is what stops the
// queue from being built, so it has to wrap the fetch — not the query.
//
// Same value and same reason as CHECK_CONCURRENCY in store.ts: a few at a time, so a cold
// cache doesn't open the whole batch against the backend and its Geonorge upstream at once.
const MAX_IN_FLIGHT = 6
let inFlight = 0
const waiting: (() => void)[] = []

async function gated<T>(fn: () => Promise<T>): Promise<T> {
  // `while`, not `if`: a release wakes one waiter, but a waiter that loses the race to a
  // fresh caller has to queue again rather than proceed over the limit.
  while (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  inFlight++
  try {
    return await fn()
  } finally {
    inFlight--
    waiting.shift()?.()
  }
}

// The query for one matrikkelenhet's addresses. Defined once so the hook below and
// fetchAddressesFor share a cache key — two spellings of it would mean the Regulering
// page re-fetched everything the map had already loaded. Both therefore share the gate.
function addressQuery(key: string, props: TeigProps) {
  return {
    queryKey: ['addresses', key],
    queryFn: () => gated(() => fetchAddresses(props)),
    staleTime: Infinity,
  }
}

/**
 * Addresses for an arbitrary selection, fetched imperatively — for generating a saved
 * list's payload without loading it into the session. Shares the cache with the hook.
 *
 * Rejects if any lookup fails, on purpose: an empty array is indistinguishable from
 * "this matrikkelenhet genuinely has no addresses", so swallowing the error would drop
 * its vegadresse rows from the parameterfil while everything still looked fine.
 */
export async function fetchAddressesFor(
  selected: SelectedTeig[],
  queryClient: QueryClient,
): Promise<Record<string, AddressInfo[]>> {
  const out: Record<string, AddressInfo[]> = {}
  await Promise.all(
    distinctMatrikkelProps(selected).map(async ([key, props]) => {
      out[key] = await queryClient.fetchQuery(addressQuery(key, props))
    }),
  )
  return out
}

// Addresses for the current selection, keyed by matrikkelKey ('loading' while in
// flight, absent on error). Each matrikkelenhet is one cached query: React Query
// dedupes repeated keys and caches results, so growing the selection only fetches new
// keys. staleTime: Infinity — cadastral addresses don't change within a session.
//
// Every lookup goes through the `gated` semaphore above — see why the browser's own
// per-host cap is not enough.
//
// `failed` is why a failed lookup must NOT collapse to []: [] is indistinguishable
// from "this matrikkelenhet genuinely has no addresses", so the komreg export would
// silently drop its vegadresse rows (buildKomregRows skips non-arrays) while the
// buttons re-enabled. fetchAllAdresser already refuses to return a partial page for
// the same reason — this keeps that guarantee intact one layer up.
export function useAddresses(selected: SelectedTeig[]): {
  addresses: Record<string, AddressInfo[] | 'loading'>
  failed: boolean
} {
  const entries = distinctMatrikkelProps(selected)

  return useQueries({
    queries: entries.map(([k, props]) => addressQuery(k, props)),
    // Rebuild the keyed record consumers expect. React Query structural-shares this
    // return value, so its identity stays stable while data is unchanged.
    combine: (results) => {
      const addresses: Record<string, AddressInfo[] | 'loading'> = {}
      let failed = false
      results.forEach((r, i) => {
        if (r.isError) failed = true
        else addresses[entries[i][0]] = r.data ?? 'loading'
      })
      return { addresses, failed }
    },
  })
}
