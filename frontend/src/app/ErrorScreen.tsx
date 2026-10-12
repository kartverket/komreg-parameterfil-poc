// What a render crash shows, wherever it is caught. Plain elements on purpose: the screen
// that reports a broken component should not be built from the components that may be broken.
//
// `reset` renders the failed part again without leaving the page. Offer it whenever there is
// one: "Last på nytt" also throws away the working session, which lives in memory.
export function ErrorScreen({ error, reset }: { error: unknown; reset?: () => void }) {
  return (
    <div role="alert" className="p-6 text-foreground" style={{ fontFamily: 'system-ui' }}>
      <h2>Noe gikk galt</h2>
      <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.8 }}>
        {error instanceof Error ? error.message : String(error)}
      </pre>
      <div className="flex gap-2">
        {reset && (
          <button type="button" onClick={reset}>
            Prøv igjen
          </button>
        )}
        <button type="button" onClick={() => location.reload()}>
          Last på nytt
        </button>
      </div>
    </div>
  )
}
