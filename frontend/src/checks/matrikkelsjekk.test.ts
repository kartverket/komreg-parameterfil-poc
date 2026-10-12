import { describe, it, expect, vi } from 'vite-plus/test'
import {
  innerpunkt,
  oppsummer,
  sammenlign,
  sjekkMotMatrikkelen,
  type Hentere,
} from './matrikkelsjekk'
import { teig } from '@/testing/fixtures'

describe('sammenlign', () => {
  it('reports each of the four outcomes', () => {
    const lagret = [
      teig(1, '5060', 90, 4), // unchanged
      teig(2, '5060', 90, 5), // gone, and 90/5 with it
      teig(3, '5060', 90, 6), // now belongs to 90/7
      teig(4, '5060', 90, 8), // gone, but 90/8 still has another teig
    ]
    const naa = {
      gnr: new Map([
        [
          '5060-90',
          [
            teig(1, '5060', 90, 4),
            teig(3, '5060', 90, 7),
            teig(5, '5060', 90, 8), // the remaining teig on 90/8 → also reported as new
            teig(6, '5060', 90, 4), // new on a unit the list moves
            teig(7, '5060', 90, 99), // on a unit the list does not move → ignored
          ],
        ],
      ]),
      utenMnr: new Map(),
    }
    const r = sammenlign(lagret, naa)
    expect(r.uendret).toBe(1)
    expect(r.ikkeSjekket).toBe(0)
    const kort = r.avvik.map((a) => [a.type, a.lagret?.id ?? a.naa?.id, a.enhetBorte])
    expect(kort).toEqual([
      ['borte', 2, true],
      ['nyEnhet', 3, undefined],
      ['borte', 4, false],
      ['ny', 5, undefined],
      ['ny', 6, undefined],
    ])
  })

  it('checks teiger without matrikkelnummer by lokalid', () => {
    const r = sammenlign([teig(1, '5060', null, null), teig(2, '5060', null, null)], {
      gnr: new Map(),
      utenMnr: new Map([['5060', new Set([1])]]),
    })
    expect(r.uendret).toBe(1)
    expect(r.avvik).toMatchObject([{ type: 'borte', lagret: { id: 2 } }])
  })

  // A failed lookup must never read as "gone".
  it('counts teiger whose lookup is missing as unchecked, not gone', () => {
    const r = sammenlign([teig(1, '5060', 90, 4), teig(2, '5060', null, null)], {
      gnr: new Map(),
      utenMnr: new Map(),
    })
    expect(r).toEqual({ avvik: [], uendret: 0, ikkeSjekket: 2 })
  })
})

describe('sjekkMotMatrikkelen', () => {
  const square = (x: number, y: number) => ({
    type: 'Polygon' as const,
    coordinates: [
      [
        [x, y],
        [x + 10, y],
        [x + 10, y + 10],
        [x, y + 10],
        [x, y],
      ],
    ],
  })

  it('fetches once per gnr, records failures, and looks up candidates for what is gone', async () => {
    const borte = { ...teig(2, '5060', 90, 5), geometry: square(100, 200) }
    const hent: Hentere = {
      gnrTeiger: vi.fn(async (k: string, g: number) => {
        if (g === 91) throw new Error('502')
        return [teig(1, k, g, 4)]
      }),
      teigerUtenMnr: vi.fn(async () => []),
      teigerVedPunkt: vi.fn(async () => [teig(8, '5060', 90, 9)]),
    }
    const r = await sjekkMotMatrikkelen(
      [teig(1, '5060', 90, 4), borte, teig(3, '5060', 91, 1)],
      hent,
    )
    expect(hent.gnrTeiger).toHaveBeenCalledTimes(2)
    expect(r.feil).toEqual(['Gnr 91 i 5060: 502'])
    expect(r.ikkeSjekket).toBe(1)
    expect(r.avvik).toMatchObject([{ type: 'borte', lagret: { id: 2 }, kandidater: [{ id: 8 }] }])
    const [x, y] = (hent.teigerVedPunkt as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(x).toBeGreaterThan(100)
    expect(x).toBeLessThan(110)
    expect(y).toBeGreaterThan(200)
    expect(y).toBeLessThan(210)
  })
})

describe('innerpunkt', () => {
  it('returns null for a geometry it cannot place', () => {
    expect(innerpunkt(teig(1, '5060', 90, 4))).toBeNull()
  })
})

describe('oppsummer', () => {
  const r = (avvik: { type: 'borte' | 'nyEnhet' | 'ny' }[], ikkeSjekket = 0) => ({
    avvik,
    uendret: 0,
    ikkeSjekket,
    feil: [],
  })

  it('names what changes what moves, and leaves new teiger out', () => {
    expect(
      oppsummer(
        'Bindaln',
        r([{ type: 'borte' }, { type: 'borte' }, { type: 'nyEnhet' }, { type: 'ny' }], 1),
      ),
    ).toBe('«Bindaln»: 2 borte, 1 på en annen matrikkelenhet, 1 kunne ikke sjekkes.')
  })

  it('says nothing when only new teiger were found', () => {
    expect(oppsummer('A', r([{ type: 'ny' }]))).toBeNull()
  })
})
