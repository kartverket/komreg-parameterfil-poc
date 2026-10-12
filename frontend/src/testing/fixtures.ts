// Shared test fixtures — every test file wants the same teig shape.
import type { TeigProps, SelectedTeig } from '@/domain/domain'

// A TeigProps with sensible defaults; pass `extra` to override any field. A null
// gnr stands in for an unregistered teig (water / "Mnr mangler").
export const teigProps = (
  kommune: string | null,
  gnr: number | null,
  bnr: number | null,
  extra: Partial<TeigProps> = {},
): TeigProps => ({
  lokalid: 0,
  kommunenummer: kommune,
  gardsnummer: gnr,
  bruksnummer: bnr,
  festenummer: null,
  seksjonsnummer: null,
  matrikkelnummertekst: gnr == null ? 'Mnr mangler' : null,
  meterFraPunkt: 0,
  ...extra,
})

// A SelectedTeig. Geometry is an empty polygon — the pure logic under test never
// reads it. `lokalid` mirrors `id` so the two stay consistent.
export const teig = (
  id: number,
  kommune: string | null,
  gnr: number | null,
  bnr: number | null,
  extra: Partial<TeigProps> = {},
): SelectedTeig => ({
  id,
  props: { ...teigProps(kommune, gnr, bnr, extra), lokalid: id },
  geometry: { type: 'Polygon', coordinates: [] },
})
