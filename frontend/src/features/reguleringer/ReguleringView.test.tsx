// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from '@/routeTree.gen'
import { teig } from '@/testing/fixtures'

// The one page where a wrong click is expensive: against `dev` a kjøring can write to
// Matrikkelen and cannot be stopped from here. These tests render the real page against a
// faked backend and check what the confirm says and what is sent. They are the only tests
// that render a component — the rules themselves are covered by the pure tests beside the
// modules that hold them.

const REGULERING = {
  id: 1,
  baseId: 'grensejustering-2027-a1b2c3',
  navn: 'Grensejustering 2027',
  dato: '2027-01-01',
  listIds: [7],
  archivedAt: null,
  createdAt: '2026-10-01 10:00:00+00',
  updatedAt: '2026-10-02 10:00:00+00',
}
const LISTE = {
  id: 7,
  name: 'Nærøysund–Bindal',
  createdAt: '2026-10-01 09:00:00+00',
  updatedAt: '2026-10-01 09:30:00+00',
}
// One teig without matrikkelnummer, moving from Nærøysund (5060) to Bindal (1811). Without
// a gnr there are no address lookups and no gnr-serie to fetch, so the two register checks
// need only the kommune list and the kommune's mnr-less teiger.
const WORKING_STATE = { selected: [teig(501, '5060', null, null)], batchKommune: '1811' }
const MILJO = {
  navn: 'dev',
  url: 'https://komreg-backend.atkv3-dev.kartverket-intern.cloud',
  kreverToken: true,
  tokenOk: true,
}

interface FakeBackend {
  /** What `GET /kjoring/miljo` answers. A test swaps it to restart the backend elsewhere. */
  miljo: typeof MILJO
  /** Bodies of every `POST /reguleringer/1/testkjoringer`, in order. */
  testRuns: unknown[]
  /** Requests no handler knew. A test should end with this empty. */
  unhandled: string[]
}

// The router restores scroll position on navigation, and jsdom only logs "not implemented".
window.scrollTo = () => {}

const realFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
})

// Answers every backend call the page makes. An unknown request is answered 501 and
// recorded rather than thrown: a throw inside fetch would be swallowed by whichever query
// made the call, and the test would fail somewhere else with no hint why.
function fakeBackend(workingState: unknown = WORKING_STATE): FakeBackend {
  const state: FakeBackend = { miljo: MILJO, testRuns: [], unhandled: [] }
  const runs: unknown[] = []
  const answers: Record<string, (body: unknown) => unknown> = {
    'GET /api/reguleringer/1': () => REGULERING,
    'GET /api/lists': () => [LISTE],
    'GET /api/lists/7': () => ({ ...LISTE, data: workingState }),
    'GET /api/reguleringer/1/testkjoringer': () => runs,
    'GET /api/kjoring/miljo': () => state.miljo,
    'GET /api/geo/kommuner': () => [
      { kommunenummer: '1811', kommunenavn: 'Bindal' },
      { kommunenummer: '5060', kommunenavn: 'Nærøysund' },
    ],
    'GET /api/geo/kommune-teiger-uten-mnr': () => [501],
    'POST /api/reguleringer/1/testkjoringer': (body) => {
      const sent = body as { start: boolean; sources: unknown[] }
      state.testRuns.push(sent)
      const run = {
        id: 1,
        externalId: `${REGULERING.baseId}-t-0001`,
        status: sent.start ? 'start_accepted' : 'sent',
        sources: sent.sources,
        sendStatus: 200,
        sendMessage: null,
        startStatus: sent.start ? 200 : null,
        startMessage: null,
        createdAt: '2026-10-09 12:00:00+00',
        updatedAt: '2026-10-09 12:00:00+00',
      }
      runs.unshift(run)
      return run
    },
  }
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${new URL(input, 'http://backend').pathname}`
    const answer = answers[key]
    if (!answer) {
      state.unhandled.push(`${method} ${input}`)
      return new Response(null, { status: 501 })
    }
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    return Response.json(answer(body))
  }) as unknown as typeof fetch
  return state
}

// The page as the app mounts it: StrictMode, a query client, and the app's own route tree
// opened at the regulering's URL — so the route file and its path param are under test too.
function renderPage() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/reguleringer/1'] }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

describe('ReguleringView', () => {
  it('selects every member for the test run on first load', async () => {
    const backend = fakeBackend()
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Testutvalg (1 av 1)' }, { timeout: 3000 }),
    ).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Send og kjør' }).disabled).toBe(
      false,
    )
    expect(backend.unhandled).toEqual([])
  })

  it('names the target and host in the confirm, and sends only after it is answered', async () => {
    const backend = fakeBackend()
    renderPage()
    await screen.findByRole('heading', { name: 'Testutvalg (1 av 1)' }, { timeout: 3000 })
    // The confirm reads the target from the same query as the badge; wait for it.
    await screen.findByText('dev')

    fireEvent.click(screen.getByRole('button', { name: 'Send og kjør' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Sende og starte «Grensejustering 2027»?')
    expect(dialog.textContent).toContain('Med: Nærøysund–Bindal.')
    expect(dialog.textContent).toContain(`Mot DEV (${MILJO.url}).`)
    expect(dialog.textContent).toContain('Kjøringen kan ikke stoppes herfra.')
    expect(backend.testRuns).toEqual([])

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send og kjør' }))

    expect(await screen.findByRole('heading', { name: 'Testhistorikk (1)' })).toBeTruthy()
    expect(backend.testRuns).toEqual([
      {
        expectedKomregUrl: MILJO.url,
        expectedReguleringUpdatedAt: REGULERING.updatedAt,
        sources: [{ listId: 7, name: LISTE.name, updatedAt: LISTE.updatedAt }],
        rader: [
          expect.objectContaining({ type: 'teig', kommunenummer: '5060', nyKommunenummer: '1811' }),
        ],
        start: true,
      },
    ])
    expect(backend.unhandled).toEqual([])
  })

  // Regression test: the target was read once and kept for the life of the tab, so a backend
  // restarted against dev was still called LOCAL in the confirm while the run went to dev.
  it('names the target the backend has now, not the one it had when the page loaded', async () => {
    const backend = fakeBackend()
    backend.miljo = {
      navn: 'local',
      url: 'http://localhost:8081',
      kreverToken: false,
      tokenOk: true,
    }
    renderPage()
    await screen.findByRole('heading', { name: 'Testutvalg (1 av 1)' }, { timeout: 3000 })
    await screen.findByText('local')

    backend.miljo = MILJO
    fireEvent.click(screen.getByRole('button', { name: 'Send og kjør' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain(`Mot DEV (${MILJO.url}).`)
    expect(dialog.textContent).not.toContain('LOCAL')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send og kjør' }))

    expect(await screen.findByRole('heading', { name: 'Testhistorikk (1)' })).toBeTruthy()
    expect(backend.testRuns).toEqual([expect.objectContaining({ expectedKomregUrl: MILJO.url })])
    expect(backend.unhandled).toEqual([])
  })

  it('sends nothing when the confirm is cancelled', async () => {
    const backend = fakeBackend()
    renderPage()
    await screen.findByRole('heading', { name: 'Testutvalg (1 av 1)' }, { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: 'Send og kjør' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Avbryt' }))

    // "Send og kjør" is enabled again only once the confirm flow has finished.
    expect(await screen.findByRole('heading', { name: 'Testhistorikk (0)' })).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(backend.testRuns).toEqual([])
    expect(backend.unhandled).toEqual([])
  })

  // The move check runs on the saved lists before the confirm is even shown. An error it can
  // prove stops there: no dialog to click through, and nothing sent.
  it('refuses to send a list whose target kommune does not exist, and says which list', async () => {
    const backend = fakeBackend({ ...WORKING_STATE, batchKommune: '9999' })
    renderPage()
    await screen.findByRole('heading', { name: 'Testutvalg (1 av 1)' }, { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: 'Send og kjør' }))

    const melding = await screen.findByText(/Parameterfilen kan ikke lages/)
    expect(melding.textContent).toContain('«Nærøysund–Bindal»')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(backend.testRuns).toEqual([])
  })

  it('disables sending only when nothing is left in the test selection', async () => {
    fakeBackend()
    renderPage()
    await screen.findByRole('heading', { name: 'Testutvalg (1 av 1)' }, { timeout: 3000 })
    const send = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Send og kjør' })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Nærøysund–Bindal' }))

    expect(screen.getByRole('heading', { name: 'Testutvalg (0 av 1)' })).toBeTruthy()
    expect(send().disabled).toBe(true)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Nærøysund–Bindal' }))
    expect(send().disabled).toBe(false)
  })

  it('takes a list out of the test selection when it leaves the regulering', async () => {
    fakeBackend()
    renderPage()
    await screen.findByRole('heading', { name: 'Testutvalg (1 av 1)' }, { timeout: 3000 })

    // The membership table comes first on the page; its checkbox is the first one.
    fireEvent.click(screen.getAllByRole('checkbox')[0])

    expect(screen.getByRole('heading', { name: 'Testutvalg (0 av 0)' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Nærøysund–Bindal' })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Lagre' }).disabled).toBe(false)
  })
})
