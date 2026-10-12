import { describe, it, expect } from 'vite-plus/test'
import { assignTeigAddresses } from './teigAddresses'
import { teig } from '@/testing/fixtures'
import type { AddressInfo } from '@/domain/domain'

describe('assignTeigAddresses', () => {
  const addr = (nummer: number, point: [number, number] | null): AddressInfo => ({
    adressetekst: `Gate ${nummer}`,
    adressenavn: 'Gate',
    nummer,
    bokstav: '',
    adressekode: 100,
    point,
  })
  const square = (x0: number, y0: number, x1: number, y1: number) => ({
    type: 'Polygon' as const,
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  })
  // Two teiger of the same matrikkelenhet (0301-208/1/0), disjoint squares.
  const key = '0301-208/1/0'
  const t1 = { ...teig(1, '0301', 208, 1), geometry: square(0, 0, 10, 10) }
  const t2 = { ...teig(2, '0301', 208, 1), geometry: square(20, 0, 30, 10) }

  it('puts an address on the teig whose polygon contains it, not on siblings', () => {
    const a = addr(1, [25, 5])
    const out = assignTeigAddresses([t1, t2], { [key]: [a] })
    expect(out[1]).toEqual([])
    expect(out[2]).toEqual([a])
  })

  // Regression: an address inside none of the teiger (geocoding jitter, missing
  // point) used to vanish from the arbeidsliste entirely.
  it('falls back to the first teig when no polygon contains the address', () => {
    const outside = addr(1, [99, 99])
    const noPoint = addr(2, null)
    const out = assignTeigAddresses([t1, t2], { [key]: [outside, noPoint] })
    expect(out[1]).toEqual([outside, noPoint])
    expect(out[2]).toEqual([])
  })

  it('passes loading through untouched', () => {
    const out = assignTeigAddresses([t1], { [key]: 'loading' })
    expect(out[1]).toBe('loading')
  })

  it('preserves addresses when a teig has empty geometry', () => {
    const empty = teig(1, '0301', 208, 1)
    const a = addr(1, [25, 5])
    const out = assignTeigAddresses([empty, t2], { [key]: [a] })
    expect(out[1]).toEqual([])
    expect(out[2]).toEqual([a])

    // Without any usable polygon, the existing first-teig fallback still applies.
    expect(assignTeigAddresses([empty], { [key]: [a] })[1]).toEqual([a])
  })
})
