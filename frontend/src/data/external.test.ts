import { describe, it, expect, afterEach } from 'vite-plus/test'
import { fetchMatrikkelTeiger, fetchAdressekodeNumbers, searchAdresser } from './external'
import { teigProps } from '@/testing/fixtures'

// Stub global fetch with one JSON payload per call, in order (the last repeats).
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})
function mockJson(...payloads: unknown[]) {
  let i = 0
  globalThis.fetch = (async () => {
    const body = payloads[Math.min(i++, payloads.length - 1)]
    return { ok: true, json: async () => body }
  }) as unknown as typeof fetch
}

describe('fetchMatrikkelTeiger', () => {
  const feature = (lokalid: number, festenummer: number) => ({
    geometry: { type: 'Polygon', coordinates: [] },
    properties: {
      lokalid,
      kommunenummer: '1580',
      gardsnummer: 398,
      bruksnummer: 7,
      festenummer,
      seksjonsnummer: 0,
    },
  })
  const family = () => ({ features: [feature(1, 0), feature(2, 2), feature(3, 0)] })

  // Regression: the upstream geokoding response covers the whole gnr/bnr family
  // (it treats festenummer=0 as "no filter"), so the fnr cut must happen here —
  // otherwise clicking a festetomt also selected the base parcel.
  it('keeps only the teiger of the requested festenummer', async () => {
    mockJson(family())
    const base = await fetchMatrikkelTeiger(teigProps('1580', 398, 7))
    expect(base.map((t) => t.id)).toEqual([1, 3])

    mockJson(family())
    const feste = await fetchMatrikkelTeiger(teigProps('1580', 398, 7, { festenummer: 2 }))
    expect(feste.map((t) => t.id)).toEqual([2])
  })
})

describe('fetchAdressekodeNumbers', () => {
  const page = (adresser: unknown[], total: number) => ({
    adresser,
    metadata: { totaltAntallTreff: total },
  })
  const a = (nummer: number | null) => ({
    adressetekst: `Gate ${nummer}`,
    adressenavn: 'Gate',
    nummer,
    bokstav: '',
    adressekode: 100,
    representasjonspunkt: { lon: 1, lat: 2 },
  })

  it('collects distinct house numbers across pages, ignoring blank nummer', async () => {
    mockJson(page([a(1), a(2), a(null)], 4), page([a(2)], 4))
    const nums = await fetchAdressekodeNumbers('0301', 100)
    expect([...nums].sort((x, y) => x - y)).toEqual([1, 2])
  })

  // A failed page must throw — a partial result would falsify the coverage check.
  it('throws instead of returning a truncated result when a page fails', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch
    await expect(fetchAdressekodeNumbers('0301', 100)).rejects.toThrow()
  })
})

describe('response validation', () => {
  const page = (adresser: unknown[]) => ({
    adresser,
    metadata: { totaltAntallTreff: adresser.length },
  })

  // A matrikkeladresse is an address with no street, so the register sends no adressekode
  // at all. It used to be cast to `number`, which made the type claim otherwise and left
  // every caller to remember on its own.
  it('reports an address with no street as a null adressekode', async () => {
    mockJson(
      page([
        {
          adressetekst: 'Gnr 1 bnr 2',
          nummer: null,
          bokstav: '',
          representasjonspunkt: { lon: 1, lat: 2 },
        },
      ]),
    )
    const [addr] = await searchAdresser('0301', { sok: 'Gnr 1' })
    expect(addr.adressekode).toBeNull()
    expect(addr.adressenavn).toBe('')
  })

  // The point of validating at the boundary: a changed upstream shape must read as a
  // changed upstream shape, not as an outage and not as an undefined three layers down.
  it('rejects a payload whose shape changed, rather than reading undefined off it', async () => {
    mockJson(page([{ adressetekst: 'Gate 1', nummer: 'tolv', adressekode: 100 }]))
    await expect(searchAdresser('0301', { sok: 'Gate' })).rejects.toThrow(/uventet svarformat/i)
  })

  it('rejects a geokoding response that is not a feature collection', async () => {
    mockJson({ features: 'nope' })
    await expect(fetchMatrikkelTeiger(teigProps('1580', 398, 7))).rejects.toThrow(
      /uventet svarformat/i,
    )
  })
})
