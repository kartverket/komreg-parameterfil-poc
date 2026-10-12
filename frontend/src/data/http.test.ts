import { describe, expect, it } from 'vite-plus/test'
import { apiError, erKode } from './http'

const problem = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })

describe('apiError', () => {
  it("shows the backend's detail and exposes the code to branch on", async () => {
    const e = await apiError(
      problem(
        {
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: 'Grensejusteringen brukes av: Grensejustering 2027',
          instance: '/lists/7',
          kode: 'i-bruk',
          feil: [],
        },
        409,
      ),
      'Kunne ikke slette grensejusteringen',
    )

    expect(e.message).toBe('Grensejusteringen brukes av: Grensejustering 2027')
    expect(e.status).toBe(409)
    expect(erKode(e, 'i-bruk')).toBe(true)
    // Same status, different cause: this is why callers branch on the code.
    expect(erKode(e, 'endret-siden-lasting')).toBe(false)
  })

  it('falls back to what was attempted when the problem has no detail', async () => {
    const e = await apiError(
      problem({ title: 'Not Found', status: 404, instance: '/lists/7', kode: 'finnes-ikke' }, 404),
      'Kunne ikke hente grensejusteringen',
    )

    expect(e.message).toBe('Kunne ikke hente grensejusteringen')
    expect(e.kode).toBe('finnes-ikke')
  })

  it('carries every validation error', async () => {
    const e = await apiError(
      problem(
        {
          title: 'Bad Request',
          status: 400,
          detail: 'rad a: mangler ny kommune\nrad b: mangler ny kommune',
          instance: '/regulering',
          kode: 'ugyldig-regulering',
          feil: [
            { melding: 'rad a: mangler ny kommune' },
            { melding: 'rad b: mangler ny kommune' },
          ],
        },
        400,
      ),
      'Kunne ikke generere parameterfil',
    )

    expect(e.feil).toEqual(['rad a: mangler ny kommune', 'rad b: mangler ny kommune'])
  })

  it('has no code when the answer is not a problem body', async () => {
    // A proxy's HTML error page, or anything else that never reached our backend.
    const e = await apiError(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
      'Kunne ikke hente',
    )

    expect(e.message).toBe('Kunne ikke hente')
    expect(e.status).toBe(502)
    expect(e.kode).toBeNull()
  })
})
