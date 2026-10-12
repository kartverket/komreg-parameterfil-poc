import { Component, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { ErrorScreen } from './ErrorScreen'
import { router } from './router'

// Last-resort guard: a crash the router's own boundaries did not catch (the router itself,
// or a route's error screen failing) shows a message instead of a blank white page. A crash
// inside a route never gets this far, see `defaultErrorComponent` in router.tsx. Must be a
// class — React has no hook equivalent for getDerivedStateFromError.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) return <ErrorScreen error={this.state.error} />
    return this.props.children
  }
}

// One cache for the whole app, made once at module load so no render can replace it.
const queryClient = new QueryClient()

// Everything the app is wired from, in one place: main.tsx only mounts this.
function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

export default App
