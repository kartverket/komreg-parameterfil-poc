import { describe, it, expect } from 'vite-plus/test'
import { buildKomregRows, clearedRowGnrValues, rowGnrOffsetValues } from './komreg'
import { teig } from '@/testing/fixtures'
import type { AddressInfo } from './domain'

describe('buildKomregRows', () => {
  it('collapses teiger of the same matrikkelenhet into one row', () => {
    const rows = buildKomregRows([teig(1, '0301', 208, 1), teig(2, '0301', 208, 1)], {}, [], [])
    const mn = rows.filter((r) => r.type === 'matrikkelenhet')
    expect(mn).toHaveLength(1)
    expect(mn[0]).toMatchObject({ kommunenummer: '0301', gardsnummer: 208, bruksnummer: 1 })
  })

  it('blanks bruksnummer when the gnr is flagged "whole gnr"', () => {
    const rows = buildKomregRows(
      [teig(1, '0301', 208, 1), teig(2, '0301', 208, 2)],
      {},
      ['0301-208'],
      [],
    )
    const mn = rows.filter((r) => r.type === 'matrikkelenhet')
    expect(mn).toHaveLength(1)
    expect(mn[0].bruksnummer).toBeUndefined()
  })

  // The move check compares the street's name against the target kommune, so the name has
  // to survive derivation — adressekode alone can't detect a vegnavn already taken there.
  it('carries the vegnavn onto the derived address rows', () => {
    const a: AddressInfo = {
      adressetekst: 'Storgata 37',
      adressenavn: 'Storgata',
      nummer: 37,
      bokstav: '',
      adressekode: 10118,
      point: null,
    }
    const rows = buildKomregRows([teig(1, '0301', 208, 1)], { '0301-208/1/0': [a] }, [], [])
    expect(rows.find((r) => r.type === 'vegadresse')?.adressenavn).toBe('Storgata')
    const whole = buildKomregRows(
      [teig(1, '0301', 208, 1)],
      { '0301-208/1/0': [a] },
      [],
      ['0301-10118'],
    )
    expect(whole.find((r) => r.type === 'veg')?.adressenavn).toBe('Storgata')
  })

  it('emits a teig row for an unregistered teig (no gnr)', () => {
    const rows = buildKomregRows([teig(9, '0301', null, null)], {}, [], [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'teig', teigid: 9 })
  })
})

describe('rowGnrOffsetValues', () => {
  // The real shape this exists for: a grensejustering out of 1525 whose matrikkelenhet rows
  // all land on occupied gårdsnummer in the target, plus one address and one mnr-less teig
  // that have no gårdsnummer to shift.
  const addr: AddressInfo = {
    adressetekst: 'Storgata 37',
    adressenavn: 'Storgata',
    nummer: 37,
    bokstav: '',
    adressekode: 10118,
    point: null,
  }
  const rows = buildKomregRows(
    [teig(1, '1525', 1, 3), teig(2, '1525', 58, 1), teig(9, '1525', null, null)],
    { '1525-1/3/0': [addr] },
    ['1525-58'],
    [],
  )

  it('shifts every matrikkelenhet row by the offset, keyed by row id', () => {
    // gnr 1 is a single bnr, gnr 58 is flagged whole-gnr: two different id shapes, both
    // shifted, because the type is what decides — not the id.
    expect(rowGnrOffsetValues(rows, 200)).toEqual({
      'm:1525-1/3': { nyGardsnummer: 201 },
      'm:1525-58/all': { nyGardsnummer: 258 },
    })
  })

  it('leaves veg, vegadresse and teig rows out entirely', () => {
    const touched = new Set(Object.keys(rowGnrOffsetValues(rows, 200)))
    for (const r of rows) {
      if (r.type !== 'matrikkelenhet') expect(touched.has(r.id)).toBe(false)
    }
    // The fixture has to actually contain the other kinds, or this asserts nothing.
    expect(rows.some((r) => r.type === 'vegadresse')).toBe(true)
    expect(rows.some((r) => r.type === 'teig')).toBe(true)
  })

  // Each row is computed from its own current gnr, never from what is already in
  // newValues, so the button can be pressed twice without landing on +400.
  it('is idempotent — applying twice does not shift a shifted series', () => {
    const once = rowGnrOffsetValues(rows, 200)
    expect(rowGnrOffsetValues(rows, 200)).toEqual(once)
  })
})

describe('clearedRowGnrValues', () => {
  const rows = buildKomregRows([teig(1, '1525', 1, 3), teig(9, '1525', null, null)], {}, [], [])

  // Undoing the offset must not take a hand-typed bruksnummer or målkommune with it.
  it('clears only nyGardsnummer, keeping the rest of the row edits', () => {
    const before = {
      'm:1525-1/3': { nyGardsnummer: 201, nyBruksnummer: 7, nyKommunenummer: '1578' },
    }
    expect(clearedRowGnrValues(rows, before)).toEqual({
      'm:1525-1/3': { nyGardsnummer: undefined, nyBruksnummer: 7, nyKommunenummer: '1578' },
    })
  })

  it('skips rows that have no new gårdsnummer to take back', () => {
    expect(clearedRowGnrValues(rows, { 'm:1525-1/3': { nyBruksnummer: 7 } })).toEqual({})
  })
})
