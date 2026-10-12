import { describe, it, expect } from 'vite-plus/test'
import { buildRad } from './regulering'
import type { KomregRow } from '@/domain/domain'

const mnr = (gnr: number, bnr?: number): KomregRow => ({
  id: bnr === undefined ? `m:5060-${gnr}/all` : `m:5060-${gnr}/${bnr}`,
  type: 'matrikkelenhet',
  kommunenummer: '5060',
  gardsnummer: gnr,
  bruksnummer: bnr,
})

// Thin mapping, but it is the boundary: a wrong field name here sends a blank the backend
// reads as "missing" or, worse, as "hele gården".
describe('buildRad', () => {
  it('resolves the target kommune from the batch value', () => {
    const r = buildRad(mnr(90, 4), '1811', {})
    expect(r).toMatchObject({
      id: 'm:5060-90/4',
      type: 'matrikkelenhet',
      kommunenummer: '5060',
      nyKommunenummer: '1811',
      gardsnummer: '90',
      bruksnummer: '4',
      // No override set → the row's current values carry over.
      nyGardsnummer: '90',
      nyBruksnummer: '4',
    })
  })

  it('lets a per-row override win over the batch kommune', () => {
    const r = buildRad(mnr(90, 4), '1811', {
      'm:5060-90/4': { nyKommunenummer: '1812', nyGardsnummer: 290 },
    })
    expect(r.nyKommunenummer).toBe('1812')
    expect(r.nyGardsnummer).toBe('290')
  })

  // The blank is the instruction, not a missing value — the backend reads it as
  // "hele gården" and omits the bruksnummer map entirely.
  it('keeps a whole-gnr row’s bruksnummer blank', () => {
    const r = buildRad(mnr(90), '1811', {})
    expect(r.bruksnummer).toBe('')
    expect(r.nyBruksnummer).toBe('')
    expect(r.gardsnummer).toBe('90')
  })

  it('blanks fields that do not belong to the row’s type', () => {
    const r = buildRad(mnr(90, 4), '1811', {})
    expect(r.adressekode).toBe('')
    expect(r.adressenummer).toBe('')
    expect(r.teigid).toBe('')
  })

  it('carries teig and address rows across', () => {
    const teig = buildRad(
      { id: 't:1', type: 'teig', kommunenummer: '5060', teigid: 155336128 },
      '1811',
      {},
    )
    expect(teig).toMatchObject({ type: 'teig', teigid: '155336128', nyKommunenummer: '1811' })

    const adr = buildRad(
      {
        id: 'v:1',
        type: 'vegadresse',
        kommunenummer: '5060',
        adressekode: 51505,
        adressenummer: 3045,
      },
      '1811',
      {},
    )
    expect(adr).toMatchObject({
      adressekode: '51505',
      nyAdressekode: '51505',
      adressenummer: '3045',
      nyAdressenummer: '3045',
    })
  })

  it('sends a blank rather than "null" when the kommune is unknown', () => {
    const r = buildRad({ ...mnr(90, 4), kommunenummer: null }, '', {})
    expect(r.kommunenummer).toBe('')
    expect(r.nyKommunenummer).toBe('')
  })
})
