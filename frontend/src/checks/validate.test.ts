import { describe, it, expect } from 'vite-plus/test'
import {
  type RegisterFacts,
  type KomregIssue,
  validateKomreg,
  planLookups,
  checkSnapshot,
  vegnavnKey,
} from './validate'
import { buildKomregRows } from '@/domain/komreg'
import { adressekodeKey, gnrCoverageKey, type AddressInfo, type KomregRow } from '@/domain/domain'
import { teig } from '@/testing/fixtures'

const KOMMUNER = new Map([
  ['0301', 'Oslo'],
  ['4601', 'Bergen'],
])

// Facts with everything empty, i.e. "looked up, nothing registered". Override per test.
const facts = (over: Partial<RegisterFacts> = {}): RegisterFacts => ({
  kommuner: KOMMUNER,
  street: new Map(),
  streetByName: new Map(),
  gnrBnr: new Map(),
  ...over,
})

const addr = (adressekode: number, adressenavn: string, nummer: number): AddressInfo => ({
  adressetekst: `${adressenavn} ${nummer}`,
  adressenavn,
  nummer,
  bokstav: '',
  adressekode,
  point: null,
})

// A matrikkelenhet row for 0301-208/1, plus its vegadresse row on Storgata 37.
const rowsWithAddress = () =>
  buildKomregRows(
    [teig(1, '0301', 208, 1)],
    { '0301-208/1/0': [addr(10118, 'Storgata', 37)] },
    [],
    [],
  )

// The same address with Storgata flagged "hele vegen": a matrikkelenhet row plus one `veg`
// row. The adressekode and vegnavn collision checks apply to this shape only — a single
// vegadresse attaches to a street that already exists in the target kommune.
const rowsWithWholeStreet = () =>
  buildKomregRows(
    [teig(1, '0301', 208, 1)],
    { '0301-208/1/0': [addr(10118, 'Storgata', 37)] },
    [],
    [adressekodeKey('0301', 10118)],
  )

const texts = (issues: KomregIssue[], level?: KomregIssue['level']) =>
  issues.filter((i) => !level || i.level === level).map((i) => i.text)

describe('kommune checks', () => {
  const rows = [{ id: 'm:x', type: 'matrikkelenhet', kommunenummer: '0301' } as KomregRow]

  it('flags a missing target kommune', () => {
    expect(texts(validateKomreg(rows, '', {}, facts()), 'error')).toContain('Ingen ny kommune satt')
  })

  it('flags a kommunenummer that is not 4 digits', () => {
    const out = validateKomreg(rows, '461', {}, facts())
    expect(texts(out, 'error')[0]).toContain('må være 4 siffer')
  })

  it('flags a well-formed kommunenummer that does not exist', () => {
    expect(texts(validateKomreg(rows, '9999', {}, facts()), 'error')).toContain(
      'Kommune 9999 finnes ikke',
    )
  })

  it('warns when the target kommune equals the current one', () => {
    expect(texts(validateKomreg(rows, '0301', {}, facts()), 'warning')[0]).toContain(
      'samme som dagens',
    )
  })

  it('accepts a real, different kommune without complaint', () => {
    const out = validateKomreg(rows, '4601', {}, facts())
    expect(texts(out, 'error')).toEqual([])
    expect(texts(out, 'warning')).toEqual([])
  })
})

describe('adressekode against the address register', () => {
  it('allows an address to move to an existing target street when its number is free', () => {
    const rows = rowsWithAddress()
    const nv = { [rows[1].id]: { nyAdressekode: 20500 } }
    const out = validateKomreg(
      rows,
      '4601',
      nv,
      facts({ street: new Map([[adressekodeKey('4601', 20500), [addr(20500, 'Fjellveien', 3)]]]) }),
    )
    expect(texts(out, 'error')).toEqual([])
  })

  it('confirms a free adressekode as info, not as an error', () => {
    const rows = rowsWithAddress()
    const nv = { [rows[1].id]: { nyAdressekode: 20500 } }
    const out = validateKomreg(
      rows,
      '4601',
      nv,
      facts({ street: new Map([[adressekodeKey('4601', 20500), []]]) }),
    )
    expect(texts(out, 'info')).toContain('Adressekode 20500 er ledig i 4601 Bergen')
    expect(texts(out, 'error')).toEqual([])
  })

  // Leaving the field blank is the case most likely to collide, and the one the user never
  // consciously chose — the message has to name that, or it reads as a complaint about a
  // value they cannot find on screen.
  it('says so explicitly when a blank field carries the current code into a collision', () => {
    const rows = rowsWithWholeStreet()
    const out = validateKomreg(
      rows,
      '4601',
      {},
      facts({ street: new Map([[adressekodeKey('4601', 10118), [addr(10118, 'Bryggen', 1)]]]) }),
    )
    expect(texts(out, 'error')).toContain(
      'Ingen ny adressekode satt — dagens kode 10118 følger med og er allerede i bruk i 4601 Bergen (Bryggen)',
    )
  })

  it('reports an occupied house number on an existing street', () => {
    const rows = rowsWithAddress()
    const out = validateKomreg(
      rows,
      '4601',
      {},
      facts({
        street: new Map([[adressekodeKey('4601', 10118), [addr(10118, 'Storgata', 37)]]]),
      }),
    )
    expect(texts(out, 'error')).toContain(
      'Nr 37 er allerede i bruk på adressekode 10118 i 4601 Bergen',
    )
  })

  it('does not check house numbers against a street that does not exist yet', () => {
    const rows = rowsWithAddress()
    const out = validateKomreg(
      rows,
      '4601',
      {},
      facts({ street: new Map([[adressekodeKey('4601', 10118), []]]) }),
    )
    expect(texts(out, 'error')).toEqual([])
  })
})

describe('vegnavn collision', () => {
  it('flags a street name already registered under a different adressekode', () => {
    const rows = rowsWithWholeStreet()
    const nv = { [rows[1].id]: { nyAdressekode: 20500 } }
    const out = validateKomreg(
      rows,
      '4601',
      nv,
      facts({
        street: new Map([[adressekodeKey('4601', 20500), []]]),
        streetByName: new Map([[vegnavnKey('4601', 'Storgata'), [addr(31000, 'Storgata', 5)]]]),
      }),
    )
    expect(texts(out, 'error')).toContain(
      'Vegnavnet «Storgata» finnes allerede i 4601 Bergen (adressekode 31000)',
    )
  })

  // The upstream search is a broad match, so a hit is not automatically a collision.
  it('ignores search hits whose name only resembles the one being moved', () => {
    const rows = rowsWithAddress()
    const nv = { [rows[1].id]: { nyAdressekode: 20500 } }
    const out = validateKomreg(
      rows,
      '4601',
      nv,
      facts({
        street: new Map([[adressekodeKey('4601', 20500), []]]),
        streetByName: new Map([[vegnavnKey('4601', 'Storgata'), [addr(31000, 'Storgaten', 5)]]]),
      }),
    )
    expect(texts(out, 'error')).toEqual([])
  })

  it('does not call the target code a collision with itself', () => {
    const rows = rowsWithAddress()
    const nv = { [rows[1].id]: { nyAdressekode: 20500 } }
    const out = validateKomreg(
      rows,
      '4601',
      nv,
      facts({
        street: new Map([[adressekodeKey('4601', 20500), []]]),
        streetByName: new Map([[vegnavnKey('4601', 'Storgata'), [addr(20500, 'Storgata', 5)]]]),
      }),
    )
    expect(texts(out, 'error')).toEqual([])
  })
})

describe('matrikkelenhet against the eiendomskart', () => {
  const rows = () => buildKomregRows([teig(1, '0301', 208, 1)], {}, [], [])

  it('warns — never errors — when the target gnr/bnr is already occupied', () => {
    const out = validateKomreg(
      rows(),
      '4601',
      {},
      facts({ gnrBnr: new Map([[gnrCoverageKey('4601', 208), new Set([1, 2])]]) }),
    )
    expect(texts(out, 'warning')).toContain('208/1 finnes allerede i eiendomskartet i 4601 Bergen')
    expect(texts(out, 'error')).toEqual([])
  })

  // The point of the whole matrikkel half: a miss is not proof the number is free, and the
  // wording must keep saying so rather than reporting a clean "ledig".
  it('never reports a miss as free, and carries the caveat on the line itself', () => {
    const out = validateKomreg(
      rows(),
      '4601',
      {},
      facts({ gnrBnr: new Map([[gnrCoverageKey('4601', 208), new Set([9])]]) }),
    )
    const info = texts(out, 'info').join(' ')
    expect(info).toContain('ikke funnet i eiendomskartet')
    expect(info).toContain('kan ikke bekrefte at matrikkelenheten er ledig')
    expect(info).not.toContain('er ledig i')
  })

  it('checks the whole series for a whole-gnr row (blank bruksnummer)', () => {
    const wholeGnr = buildKomregRows([teig(1, '0301', 208, 1)], {}, ['0301-208'], [])
    const out = validateKomreg(
      wholeGnr,
      '4601',
      {},
      facts({ gnrBnr: new Map([[gnrCoverageKey('4601', 208), new Set([1, 2, 3])]]) }),
    )
    expect(texts(out, 'warning')).toContain(
      'Gnr 208 i 4601 Bergen har allerede 3 bruksnummer i eiendomskartet',
    )
  })

  it('stays silent when the gnr was never looked up', () => {
    const out = validateKomreg(rows(), '4601', {}, facts())
    expect(texts(out)).toEqual([])
  })
})

describe('duplicate targets within the list', () => {
  it('flags two matrikkelenhet rows moved onto the same gnr/bnr', () => {
    const rows = buildKomregRows([teig(1, '0301', 208, 1), teig(2, '0301', 209, 1)], {}, [], [])
    const nv = { [rows[1].id]: { nyGardsnummer: 208, nyBruksnummer: 1 } }
    const out = validateKomreg(rows, '4601', nv, facts())
    expect(texts(out, 'error')).toContain('2 rader flyttes til samme mål (4601 208/1)')
    // Both rows carry the finding — the cell is per row, so only flagging one hides half of it.
    expect(out.filter((i) => i.text.includes('samme mål'))).toHaveLength(2)
  })

  it('accepts distinct targets', () => {
    const rows = buildKomregRows([teig(1, '0301', 208, 1), teig(2, '0301', 209, 1)], {}, [], [])
    expect(texts(validateKomreg(rows, '4601', {}, facts()), 'error')).toEqual([])
  })
})

describe('number format and range', () => {
  const rows = () => buildKomregRows([teig(1, '0301', 208, 1)], {}, [], [])

  it('rejects a non-integer and a non-positive number', () => {
    const id = rows()[0].id
    const nan = validateKomreg(rows(), '4601', { [id]: { nyGardsnummer: NaN } }, facts())
    expect(texts(nan, 'error')).toContain('Gårdsnummer må være et heltall')
    const zero = validateKomreg(rows(), '4601', { [id]: { nyBruksnummer: 0 } }, facts())
    expect(texts(zero, 'error')).toContain('Bruksnummer må være større enn 0')
  })

  // Warning, not error: the bounds are our expectation of Kartverket's, not a contract.
  it('warns rather than errors on an out-of-range value', () => {
    const id = rows()[0].id
    const out = validateKomreg(rows(), '4601', { [id]: { nyGardsnummer: 999999 } }, facts())
    expect(texts(out, 'warning')[0]).toContain('utenfor forventet område')
    expect(texts(out, 'error')).toEqual([])
  })

  // Otherwise fixing the kommune would reveal a second, previously hidden round of errors.
  it('still checks numbers when the kommune itself is wrong', () => {
    const id = rows()[0].id
    const out = validateKomreg(rows(), '9999', { [id]: { nyGardsnummer: -1 } }, facts())
    expect(texts(out, 'error')).toContain('Kommune 9999 finnes ikke')
    expect(texts(out, 'error')).toContain('Gårdsnummer må være større enn 0')
  })
})

describe('planLookups', () => {
  it('dedupes rows that share a target street or gnr into one lookup each', () => {
    const rows = buildKomregRows(
      [teig(1, '0301', 208, 1), teig(2, '0301', 208, 2)],
      {
        '0301-208/1/0': [addr(10118, 'Storgata', 37)],
        '0301-208/2/0': [addr(10118, 'Storgata', 39)],
      },
      [],
      [],
    )
    const plan = planLookups(rows, '4601', {}, KOMMUNER)
    expect(plan.streets).toHaveLength(1)
    expect(plan.names).toHaveLength(1)
    expect(plan.gnr).toHaveLength(1)
    expect(plan.gnr[0]).toMatchObject({ kommunenummer: '4601', gardsnummer: 208 })
  })

  // No point spending requests on a kommune that cannot resolve — the kommune issue
  // already explains the row, and the lookups would 400 or return noise.
  it('plans nothing for an unknown target kommune', () => {
    const plan = planLookups(rowsWithAddress(), '9999', {}, KOMMUNER)
    expect(plan).toEqual({ streets: [], names: [], gnr: [] })
  })
})

describe('checkSnapshot', () => {
  it('changes when a new value, the batch kommune, or the row set changes', () => {
    const rows = rowsWithAddress()
    const base = checkSnapshot(rows, '4601', {})
    expect(checkSnapshot(rows, '4601', {})).toBe(base)
    expect(checkSnapshot(rows, '0301', {})).not.toBe(base)
    expect(checkSnapshot(rows, '4601', { [rows[0].id]: { nyGardsnummer: 5 } })).not.toBe(base)
    expect(checkSnapshot(rows.slice(0, 1), '4601', {})).not.toBe(base)
  })
})
