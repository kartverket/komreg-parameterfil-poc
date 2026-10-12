import { describe, it, expect, afterEach } from 'vite-plus/test'
import { fetchMiljo, fetchKomregReguleringer, fetchKjorerNa } from './kjoring'

// Same hand-rolled fetch stub as external.test.ts, but recording the request too.
const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  const urls: string[] = []
  globalThis.fetch = (async (url: string) => {
    urls.push(url)
    return { ok: response.ok, status: response.status, json: async () => response.body }
  }) as unknown as typeof fetch
  return urls
}

describe('fetchMiljo', () => {
  it('reads the target the backend is pointed at', async () => {
    const urls = mockFetch({
      ok: true,
      status: 200,
      body: {
        navn: 'dev',
        url: 'https://komreg-backend.atkv3-dev.kartverket-intern.cloud',
        kreverToken: true,
        tokenOk: true,
      },
    })

    const miljo = await fetchMiljo()

    expect(urls[0]).toContain('/kjoring/miljo')
    expect(miljo.navn).toBe('dev')
    expect(miljo.kreverToken).toBe(true)
  })

  it('carries the token problem through so the badge can show it', async () => {
    // The badge is the only place this surfaces before you click something, so the
    // message has to survive the trip rather than collapsing into a generic error.
    mockFetch({
      ok: true,
      status: 200,
      body: {
        navn: 'dev',
        url: 'https://x',
        kreverToken: true,
        tokenOk: false,
        tokenFeil: 'Ikke innlogget i Azure. Kjør «az login --allow-no-subscriptions».',
      },
    })

    const miljo = await fetchMiljo()

    expect(miljo.tokenOk).toBe(false)
    expect(miljo.tokenFeil).toContain('az login')
  })

  it('throws when the backend cannot answer', async () => {
    mockFetch({ ok: false, status: 502, body: null })
    await expect(fetchMiljo()).rejects.toThrow()
  })
})

describe('fetchKomregReguleringer', () => {
  it('returns the summaries', async () => {
    mockFetch({
      ok: true,
      status: 200,
      body: [
        {
          id: 'vest_lofoten',
          navn: 'Vest-Lofoten',
          dato: '2028-01-01',
          antallEndringer: 2,
          antallTransformasjoner: 4,
          transformasjonerPerType: { teig: 2, veg: 2 },
        },
      ],
    })
    const [first] = await fetchKomregReguleringer()
    // The counts are the point of the listing: antallEndringer is one per kommunepar,
    // so it says nothing about how big the kjøring is.
    expect(first.antallTransformasjoner).toBe(4)
    expect(first.transformasjonerPerType).toEqual({ teig: 2, veg: 2 })
  })

  it('throws when komreg-backend cannot be reached', async () => {
    mockFetch({ ok: false, status: 502, body: null })
    await expect(fetchKomregReguleringer()).rejects.toThrow()
  })
})

describe('fetchKjorerNa', () => {
  it('unwraps the flag', async () => {
    mockFetch({ ok: true, status: 200, body: { kjorer: true } })
    expect(await fetchKjorerNa()).toBe(true)
  })
})
