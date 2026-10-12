// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { SessionBar } from './SessionPanel'
import { useStore } from '../store'
import { teig } from '@/testing/fixtures'

// The single save control, rendered alone: a wrong "saved" here is lost work, because the
// dirty flag is what stands between an edit and "load another list" replacing it.

const realFetch = globalThis.fetch
beforeEach(() => {
  useStore.getState().applyWorkingState({
    selected: [teig(501, '5060', null, null)],
    comments: {},
    batchKommune: '1811',
    newValues: {},
    wholeGnr: [],
    wholeAdressekode: [],
  })
  useStore.getState().setCurrentList(7, 'Nærøysund–Bindal', '2026-10-01 09:30:00+00')
})
afterEach(() => {
  cleanup()
  globalThis.fetch = realFetch
})

function renderSessionBar() {
  const router = createRouter({
    routeTree: createRootRoute({ component: SessionBar }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

describe('SessionBar', () => {
  it('keeps an edit made while the save is in flight as unsaved', async () => {
    // The PUT stays open until the test answers it, so there is a moment to edit in.
    let answer: (r: Response) => void = () => {}
    const bodies: unknown[] = []
    globalThis.fetch = ((_input: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init?.body as string))
      return new Promise<Response>((resolve) => (answer = resolve))
    }) as unknown as typeof fetch
    renderSessionBar()

    fireEvent.click(await screen.findByRole('button', { name: 'Oppdater' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    useStore.getState().setComment(501, 'skrevet mens lagringen pågikk')
    answer(Response.json({ updatedAt: '2026-10-09 12:00:00+00' }))
    await screen.findByText('Oppdatert «Nærøysund–Bindal»')

    // What was sent did not have the comment, so the comment is not saved.
    expect((bodies[0] as { data: { comments: unknown } }).data.comments).toEqual({})
    expect(useStore.getState().isDirty()).toBe(true)
  })

  it('is clean after a save nothing was edited during', async () => {
    globalThis.fetch = (async () =>
      Response.json({ updatedAt: '2026-10-09 12:00:00+00' })) as unknown as typeof fetch
    useStore.getState().setComment(501, 'en kommentar')
    renderSessionBar()

    fireEvent.click(await screen.findByRole('button', { name: 'Oppdater' }))
    await screen.findByText('Oppdatert «Nærøysund–Bindal»')

    expect(useStore.getState().isDirty()).toBe(false)
    expect(useStore.getState().currentListUpdatedAt).toBe('2026-10-09 12:00:00+00')
  })
})
