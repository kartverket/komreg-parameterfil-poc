// Which teig an address belongs to. Kept apart from the row rules in komreg.ts because it
// is the one part of the arbeidsliste that needs OpenLayers geometry: everything importing
// the row rules, the landing screen included, would otherwise load it too.
import GeoJSON from 'ol/format/GeoJSON'
import {
  type SelectedTeig,
  type AddrState,
  type AddressInfo,
  matrikkelKey,
  WEB_MERCATOR,
} from '@/domain/domain'

// Assign each matrikkelenhet address to the teig whose polygon contains its
// point, so an address shows on one row instead of on every sibling teig.
// Addresses that land in none of the enhet's selected teiger (geocoding jitter,
// or the containing teig was removed from the selection) go on the enhet's
// first teig rather than silently vanishing from the arbeidsliste.
export function assignTeigAddresses(
  selected: SelectedTeig[],
  addresses: Record<string, AddrState>,
): Record<number, AddrState> {
  const out: Record<number, AddrState> = {}
  const fmt = new GeoJSON()
  const claimed = new Map<string, Set<AddressInfo>>()
  const firstTeig = new Map<string, number>()
  for (const s of selected) {
    const key = matrikkelKey(s.props)
    const addr = key ? addresses[key] : undefined
    if (!key || !Array.isArray(addr)) {
      out[s.id] = addr // undefined or 'loading'
      continue
    }
    if (!firstTeig.has(key)) firstTeig.set(key, s.id)
    const geom = fmt.readGeometry(s.geometry, WEB_MERCATOR)
    const mine = addr.filter((a) => a.point && geom?.intersectsCoordinate(a.point))
    out[s.id] = mine
    let c = claimed.get(key)
    if (!c) claimed.set(key, (c = new Set()))
    for (const a of mine) c.add(a)
  }
  for (const [key, id] of firstTeig) {
    const addr = addresses[key]
    if (!Array.isArray(addr)) continue
    const rest = addr.filter((a) => !claimed.get(key)?.has(a))
    if (rest.length) out[id] = [...(out[id] as AddressInfo[]), ...rest]
  }
  return out
}
