import { describe, it, expect } from 'vite-plus/test'
import { adressekoder, lesParameterfil, UlesbarParameterfil } from './gjennomgang'

const ft = (fra: string, til: string) => ({ fra, til })

// Shapes copied from what ReguleringBuilder emits (and from the reference payload
// grensejustering-5060-1811.json): one of each kind, plus the bruksnummer asymmetry where the
// outer kommuneløpenummer/gårdsnummer stay put and the target sits in the nested object.
const fil = {
  id: 'r-t-abc',
  navn: '2027',
  dato: '2027-01-01',
  endringer: [
    {
      id: '5060-1811',
      navn: 'Grensejustering 5060 → 1811',
      type: 'kommune',
      transformasjoner: [
        {
          type: 'matrikkelenhet',
          fylkesnummer: ft('50', '18'),
          kommuneløpenummer: ft('60', '60'),
          gårdsnummer: ft('90', '90'),
          bruksnummer: { '10': { kommunelopenummer: 11, gardsnummer: 290, bruksnummer: 10 } },
        },
        {
          type: 'matrikkelenhet',
          fylkesnummer: ft('50', '18'),
          kommuneløpenummer: ft('60', '60'),
          gårdsnummer: ft('90', '90'),
          bruksnummer: { '4': { kommunelopenummer: 11, gardsnummer: 90, bruksnummer: 4 } },
        },
        {
          type: 'matrikkelenhet',
          fylkesnummer: ft('50', '18'),
          kommuneløpenummer: ft('60', '11'),
          gårdsnummer: ft('91', '91'),
        },
        {
          type: 'teig',
          fylkesnummer: ft('50', '18'),
          kommuneløpenummer: ft('60', '11'),
          teigId: ft('123', '123'),
        },
        {
          type: 'veg',
          fylkesnummer: { fra: '50', til: ['18'] },
          kommuneløpenummer: { fra: '60', til: ['11'] },
          adressekode: { fra: '1200', til: ['1300'] },
        },
        {
          type: 'vegadresse',
          fylkesnummer: ft('50', '18'),
          kommuneløpenummer: ft('60', '11'),
          adressekode: ft('1200', '1200'),
          adressenummer: ft('5', '5'),
        },
      ],
    },
  ],
}

describe('lesParameterfil', () => {
  it('groups by kommunepar and resolves the nested bruksnummer target', () => {
    const g = lesParameterfil(JSON.stringify(fil))
    expect(g).toMatchObject({ id: 'r-t-abc', dato: '2027-01-01', antall: 6 })
    const [p] = g.par
    expect(p).toMatchObject({ fraKommune: '5060', tilKommune: '1811', fylkesbytte: true })
    // Sorted naturally (90/4 before 90/10), and only the renumbered one is flagged. The
    // target kommune comes from the nested 11, not the outer 60 that stays put on purpose —
    // so it equals the pair's and is left out.
    expect(p.bruksnumre).toEqual([
      { fra: '90/4', til: '90/4', nyttNummer: false, tilKommune: undefined },
      { fra: '90/10', til: '290/10', nyttNummer: true, tilKommune: undefined },
    ])
    expect(p.heleGarder).toEqual([
      { fra: '91', til: '91', nyttNummer: false, tilKommune: undefined },
    ])
    expect(p.teiger).toEqual(['123'])
    expect(p.veger).toEqual([{ fra: '1200', til: '1300', nyttNummer: true, adressekode: '1200' }])
    expect(p.vegadresser).toEqual([
      { fra: '1200 nr 5', til: '1200 nr 5', nyttNummer: false, adressekode: '1200' },
    ])
    // One lookup per street, in the source kommune, however many rows name it.
    expect(adressekoder(g)).toEqual([{ kommune: '5060', adressekode: '1200' }])
  })

  // The outer kommuneløpenummer is only fra == fra for the bnr shape. Were the nested target
  // ever to point somewhere other than the pair, the review must say so rather than hide it.
  it('names a target kommune that differs from the pair', () => {
    const avvik = structuredClone(fil)
    avvik.endringer[0].transformasjoner = [
      {
        type: 'matrikkelenhet',
        fylkesnummer: ft('50', '18'),
        kommuneløpenummer: ft('60', '60'),
        gårdsnummer: ft('90', '90'),
        bruksnummer: { '4': { kommunelopenummer: 12, gardsnummer: 90, bruksnummer: 4 } },
      },
    ]
    expect(lesParameterfil(JSON.stringify(avvik)).par[0].bruksnumre[0].tilKommune).toBe('1812')
  })

  it('counts types it does not render instead of dropping them', () => {
    const krets = structuredClone(fil)
    krets.endringer[0].transformasjoner = [{ type: 'krets' } as never]
    expect(lesParameterfil(JSON.stringify(krets)).par[0].andre).toEqual(['krets'])
  })

  it('throws a readable error on something that is not a parameterfil', () => {
    expect(() => lesParameterfil('nope')).toThrow(UlesbarParameterfil)
    expect(() => lesParameterfil('{"id":1}')).toThrow(UlesbarParameterfil)
  })
})
