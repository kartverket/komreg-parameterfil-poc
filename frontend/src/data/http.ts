import { z } from 'zod'

// What every call to our own backend (Ktor) shares: where it lives, and what a refused or
// failed answer becomes. The clients for each resource are beside this file.

// Every API route sits under /api: the SPA has pages at /reguleringer and /kjoring too, and
// behind one origin a proxy can only tell a page from an API call by the path.
//
// Same-origin ('') unless overridden — prod serves the API behind the same host, so
// a build with no env vars set does the right thing. Dev needs the cross-origin
// backend (:8080) and sets VITE_API_URL in .env.development.
export const API_BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`

// The backend's one error body: application/problem+json (RFC 9457), see Problem.kt.
// Not .strict(), like every other boundary schema here: a new field is a non-event.
const problemSchema = z.object({
  status: z.number(),
  kode: z.string(),
  detail: z.string().optional(),
  feil: z.array(z.object({ melding: z.string() })).default([]),
})

/**
 * A refused or failed API call.
 *
 * `message` is text for the user: the backend's `detail` when it sent one, else the caller's
 * fallback. `kode` is what to branch on — never the text, and never the status alone, since
 * one status has several causes (`endret-siden-lasting` and `i-bruk` are both 409). It is
 * null when the answer was not a problem body at all: a proxy's error page, or no backend.
 */
export class ApiError extends Error {
  // Declared and assigned separately: `erasableSyntaxOnly` rules out parameter properties.
  readonly status: number
  readonly kode: string | null
  readonly feil: string[]
  constructor(message: string, status: number, kode: string | null, feil: string[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.kode = kode
    this.feil = feil
  }
}

/** The one place a failed response becomes an error. `fallback` says what was attempted. */
export async function apiError(r: Response, fallback: string): Promise<ApiError> {
  const problem = problemSchema.safeParse(await r.json().catch(() => null))
  if (!problem.success) return new ApiError(fallback, r.status, null, [])
  const { kode, detail, feil } = problem.data
  return new ApiError(
    detail ?? fallback,
    r.status,
    kode,
    feil.map((x) => x.melding),
  )
}

export const erKode = (e: unknown, kode: string): e is ApiError =>
  e instanceof ApiError && e.kode === kode
