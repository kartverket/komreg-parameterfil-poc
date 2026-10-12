import { describe, it, expect } from 'vite-plus/test'
import {
  formatMatrikkel,
  matrikkelKey,
  gnrKey,
  compareMatrikkel,
  toTeigProps,
  kommuneScope,
  workingStateSchema,
} from './domain'
import type { WorkingState } from './domain'
import { teig, teigProps as props } from '@/testing/fixtures'

describe('formatMatrikkel', () => {
  it('formats gnr/bnr', () => {
    expect(formatMatrikkel(props('0301', 208, 1))).toBe('208/1')
  })
  it('appends festenummer when present', () => {
    expect(formatMatrikkel(props('0301', 208, 1, { festenummer: 2 }))).toBe('208/1/2')
  })
  it('falls back to matrikkelnummertekst when there is no gnr', () => {
    expect(formatMatrikkel(props(null, null, null))).toBe('Mnr mangler')
  })
})

describe('matrikkelKey / gnrKey', () => {
  it('builds the keys from the parcel numbers', () => {
    expect(matrikkelKey(props('0301', 208, 1))).toBe('0301-208/1/0')
    expect(gnrKey(props('0301', 208, 1))).toBe('0301-208')
  })
  it('returns null for a teig without a gnr', () => {
    expect(matrikkelKey(props(null, null, null))).toBeNull()
    expect(gnrKey(props(null, null, null))).toBeNull()
  })
})

describe('compareMatrikkel', () => {
  it('orders by kommune, then gnr, then bnr', () => {
    const t = (gnr: number, bnr: number) => teig(gnr * 1000 + bnr, '0301', gnr, bnr)
    const sorted = [t(208, 2), t(12, 5), t(208, 1)].sort(compareMatrikkel)
    expect(sorted.map((s) => `${s.props.gardsnummer}/${s.props.bruksnummer}`)).toEqual([
      '12/5',
      '208/1',
      '208/2',
    ])
  })
})

describe('toTeigProps', () => {
  it('reads the parcel numbers off a raw properties bag', () => {
    const p = toTeigProps({ lokalid: 1, kommunenummer: '0301', gardsnummer: 208, bruksnummer: 1 })
    expect(p.gardsnummer).toBe(208)
    expect(p.bruksnummer).toBe(1)
  })

  it('throws when lokalid is missing', () => {
    expect(() => toTeigProps({ kommunenummer: '0301' })).toThrow()
  })

  // This is the choke point all three teig sources pass through, so a field that changed
  // type upstream has to stop here — not surface later as a matrikkelnummer that renders
  // as "[object Object]" or a lookup keyed on undefined. The message names the field so
  // the next person doesn't have to diff two API responses to find it.
  it('rejects a properties bag whose shape changed, naming the field', () => {
    expect(() => toTeigProps({ lokalid: 1, kommunenummer: 301 })).toThrow(/kommunenummer/)
  })

  // OL hands getProperties() a `geometry` key holding an OL Geometry, and upstream is free
  // to add fields. Neither may fail a lookup — the schema is not strict for this reason.
  it('ignores keys it does not know', () => {
    const p = toTeigProps({ lokalid: 1, kommunenummer: '0301', geometry: {}, nyttFelt: 42 })
    expect(p.lokalid).toBe(1)
    expect(p.kommunenummer).toBe('0301')
  })

  // Regression: the Teig WFS writes gardsnummer 0 for a teig with no matrikkelnummer
  // ("Mnr mangler" / "Mnr vann mangler"), where the eiendom API leaves it null. Left as 0
  // it is truthy-shaped enough to reach buildKomregRows as a matrikkelenhet row for gnr
  // 0/0 and to key a junk address lookup, instead of the teig row komreg needs. A whole
  // grunnkrets over water is 45 of these.
  it('normalises the WFS gardsnummer 0 to null', () => {
    const water = toTeigProps({
      lokalid: 85428143,
      kommunenummer: '1578',
      gardsnummer: 0,
      bruksnummer: 1,
      matrikkelnummertekst: 'Mnr vann mangler',
    })
    expect(water.gardsnummer).toBeNull()
    expect(matrikkelKey(water)).toBeNull()
    expect(formatMatrikkel(water)).toBe('Mnr vann mangler')
  })
})

describe('kommuneScope', () => {
  const ws = (over: Partial<WorkingState> = {}): WorkingState => ({
    selected: [],
    comments: {},
    batchKommune: '',
    newValues: {},
    wholeGnr: [],
    wholeAdressekode: [],
    ...over,
  })

  it("pairs the selection's kommuner with the batch target", () => {
    const s = kommuneScope(
      ws({ selected: [teig(1, '1525', 9, 2), teig(2, '1525', 9, 3)], batchKommune: '1578' }),
    )
    expect(s).toEqual({ fra: ['1525'], til: ['1578'] })
  })

  // A grunnkrets selection spans two kommuner routinely — a krets boundary doesn't stop
  // at a kommune boundary — so this must not collapse to a single pair.
  it('reports every kommune the selection sits in', () => {
    const s = kommuneScope(
      ws({ selected: [teig(1, '1525', 9, 2), teig(2, '1578', 4, 1)], batchKommune: '1578' }),
    )
    expect(s.fra).toEqual(['1525', '1578'])
  })

  it('includes per-row target overrides alongside the batch kommune', () => {
    const s = kommuneScope(
      ws({
        selected: [teig(1, '1525', 9, 2)],
        batchKommune: '1578',
        newValues: { r1: { nyKommunenummer: '3301' } },
      }),
    )
    expect(s.til).toEqual(['1578', '3301'])
  })

  // An empty list has nothing to move, so the batch kommune isn't a destination yet.
  it('reports no destination for an empty selection', () => {
    expect(kommuneScope(ws({ batchKommune: '1578' }))).toEqual({ fra: [], til: [] })
  })
})

describe('workingStateSchema', () => {
  // Every field is defaulted so a list saved before a field existed still loads.
  it('loads a blob saved before a field existed', () => {
    const ws = workingStateSchema.parse({
      selected: [],
      comments: {},
      batchKommune: '1811',
      newValues: {},
      wholeGnr: [],
    })
    expect(ws.wholeAdressekode).toEqual([])
    expect(ws.batchKommune).toBe('1811')
  })
})
