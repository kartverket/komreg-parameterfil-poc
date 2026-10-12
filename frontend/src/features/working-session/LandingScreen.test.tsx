// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { LandingScreen } from './LandingScreen'
import { SessionBar } from './components/SessionPanel'
import { useStore } from './store'
import { teig } from '@/testing/fixtures'

// The landing screen is where a list is chosen by what it says about itself. These tests
// keep that description true to what is saved.

const LISTE = {
  id: 7,
  name: 'Nærøysund–Bindal',
  createdAt: '2026-10-01 09:00:00+00',
  updatedAt: '2026-10-01 09:30:00+00',
}
const lagret = () => ({
  selected: [teig(501, '5060', null, null)],
  comments: {},
  batchKommune: '1811',
  newValues: {},
  wholeGnr: [],
  wholeAdressekode: [],
})

window.scrollTo = () => {}
const realFetch = globalThis.fetch
const realConfirm = window.confirm
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
  window.confirm = realConfirm
})

// A backend that keeps what is PUT to it, so a later GET answers with the saved state.
function fakeBackend() {
  let data: unknown = lagret()
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${new URL(input, 'http://backend').pathname}`
    if (key === 'GET /api/lists') return Response.json([LISTE])
    if (key === 'GET /api/lists/7') return Response.json({ ...LISTE, data })
    if (key === 'PUT /api/lists/7') {
      data = (JSON.parse(init!.body as string) as { data: unknown }).data
      return Response.json({ updatedAt: '2026-10-09 12:00:00+00' })
    }
    return new Response(null, { status: 501 })
  }) as unknown as typeof fetch
}

// The save control and the landing screen under one client, as they are in the app: the
// save happens on the work pages and the landing screen shows its result afterwards.
function renderLandingWithSave() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <>
          <SessionBar />
          <LandingScreen />
        </>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return queryClient
}

const shows = (text: string) => waitFor(() => expect(document.body.textContent).toContain(text))

describe('LandingScreen', () => {
  it('shows the kommuner a list moves between', async () => {
    fakeBackend()
    renderLandingWithSave()

    await shows('5060 → 1811')
  })

  it('shows the new target kommune after the list is saved with another one', async () => {
    fakeBackend()
    useStore.getState().applyWorkingState(lagret())
    useStore.getState().setCurrentList(LISTE.id, LISTE.name, LISTE.updatedAt)
    renderLandingWithSave()
    await shows('5060 → 1811')

    useStore.getState().setBatchKommune('1812')
    fireEvent.click(screen.getByRole('button', { name: 'Oppdater' }))

    await shows('5060 → 1812')
  })

  // Regression test: a save that answers after another list was opened used to hand that
  // list the saved one's id and version, so the next save overwrote the wrong list.
  it('leaves the opened list current when an earlier save answers late', async () => {
    const ANNEN = { ...LISTE, id: 8, name: 'Bindal–Namsos', updatedAt: '2026-10-03 08:00:00+00' }
    let answerSave = () => {}
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${new URL(input, 'http://backend').pathname}`
      if (key === 'GET /api/lists') return Response.json([LISTE, ANNEN])
      if (key === 'GET /api/lists/7') return Response.json({ ...LISTE, data: lagret() })
      if (key === 'GET /api/lists/8') return Response.json({ ...ANNEN, data: lagret() })
      if (key === 'PUT /api/lists/7') {
        await new Promise<void>((resolve) => (answerSave = resolve))
        return Response.json({ updatedAt: '2026-10-09 12:00:00+00' })
      }
      return new Response(null, { status: 501 })
    }) as unknown as typeof fetch
    // The edit below is still unsaved while the save is under way, so opening asks first.
    window.confirm = () => true
    useStore.getState().applyWorkingState(lagret())
    useStore.getState().setCurrentList(LISTE.id, LISTE.name, LISTE.updatedAt)
    const queryClient = renderLandingWithSave()
    await shows(ANNEN.name)

    useStore.getState().setBatchKommune('1812')
    fireEvent.click(screen.getByRole('button', { name: 'Oppdater' }))
    const rad = screen.getByText(ANNEN.name).closest('tr')!
    fireEvent.click(within(rad).getByRole('button', { name: 'Åpne' }))
    await waitFor(() => expect(useStore.getState().currentListId).toBe(ANNEN.id))

    answerSave()
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))

    const { currentListId, currentListName, currentListUpdatedAt } = useStore.getState()
    expect({ currentListId, currentListName, currentListUpdatedAt }).toEqual({
      currentListId: ANNEN.id,
      currentListName: ANNEN.name,
      currentListUpdatedAt: ANNEN.updatedAt,
    })
  })
})
