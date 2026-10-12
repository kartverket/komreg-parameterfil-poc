// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { routerDefaults } from './router'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// A layout with one page in it, the shape of the map shell and a work page, under the app's
// own router defaults. The page crashes for as long as `broken` is set.
function renderCrashingPage(fault: { broken: boolean }) {
  // React logs every caught render error; that is expected here, not noise worth reading.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const root = createRootRoute({
    component: () => (
      <>
        <header>Kartskall</header>
        <Outlet />
      </>
    ),
  })
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => {
      if (fault.broken) throw new Error('Arbeidslisten gikk i stykker')
      return <p>Arbeidsliste</p>
    },
  })
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    ...routerDefaults,
  })
  render(<RouterProvider router={router} />)
}

describe('a page that crashes while rendering', () => {
  it('shows our error screen in place of the page, and keeps the layout around it', async () => {
    renderCrashingPage({ broken: true })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Noe gikk galt')
    expect(alert.textContent).toContain('Arbeidslisten gikk i stykker')
    expect(screen.getByText('Kartskall')).toBeTruthy()
  })

  it('comes back with "Prøv igjen" once the cause is gone, without a reload', async () => {
    const fault = { broken: true }
    renderCrashingPage(fault)

    await screen.findByRole('alert')
    fault.broken = false
    fireEvent.click(screen.getByRole('button', { name: 'Prøv igjen' }))

    expect(await screen.findByText('Arbeidsliste')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
