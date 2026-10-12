# KomReg parameterfil PoC

Tool for selecting Norwegian cadastral parcels (teiger) on a map and building the komreg
parameterfil for a **grensejustering**. Sammenslåing and deling are out of scope. Monorepo,
two toolchains — each half has its own `AGENTS.md`:

- `frontend/` — React + Vite SPA (pnpm + vite-plus). See `frontend/AGENTS.md`.
- `backend/`  — Kotlin / Ktor + Postgres (Gradle). See `backend/AGENTS.md`.

## How the halves connect

- SPA calls the API same-origin by default. Every API route is under `/api`
  (`/api/lists`, `/api/geo/*`); the docs name routes without the prefix. In dev
  `VITE_API_URL` (`frontend/.env.development`) points it at the backend on `:8080`
  and the backend enables CORS via `DEV_CORS=1`. Prod sits behind Caddy (no CORS).
- Backend persists the frontend's working state as an **opaque `WorkingState` JSON
  blob** — the server stays generic; the frontend owns the schema and validates it
  with Zod on load.
- Backend also **hands the finished regulering over** to komreg-backend (`/kjoring/*` →
  its `POST /reguleringer` and `GET /run/{regId}`), rather than the browser doing it: that
  service has no CORS plugin, and a token would have to live server-side. Local only, no
  token sent, and both servers default to :8080 — see `docs/adr/0003-send-til-komreg-backend.md`.
- Backend **proxies** the Geonorge/Kartverket address/teig lookups (`/geo/*`) and
  stores none of it — a stale teig or address would land in a real regulering. Map
  tiles/WMS and the click point-lookup go straight from the browser to Kartverket.

## Dev

- `compose.yml` runs the dev stack: `db` (Postgres :5432), `backend` (:8080),
  `frontend` (Vite :5173). Dev-only — not the prod setup.
- Reviewing a pull request? Use the `code-review` skill in `.github/skills/`.

## Docs

- `docs/architecture.md` — the whole system in two diagrams (C4 context + containers), and the
  boundary rules between the SPA, Ktor and the outside world. Start here.
- `docs/parameterfil-grensejustering.md` — how the parameterfil is built, how
  komreg-backend reads it and picks a rule, and the exact shape each of the four
  transformasjoner must have. Read it before touching `ReguleringBuilder.kt`.
- `docs/adr/` — numbered decision records. Each one records what was measured, what the
  public data can and can't tell us, and why the part turned out the way it did. Open-data-only
  for now — the real MatrikkelAPI needs applied-for credentials — so every ADR that works
  around a missing field says so under a "data gaps" heading.
  - `0001` grunnkrets selection, `0002` the parameterfil as the only output, `0003` sending to
    komreg-backend, `0004` saved reguleringer and test runs, `0005` komreg-backend target and
    token, `0007` the check against the matrikkel.
  - `0006-krets-som-transformasjon.md` — **open question**, no code. Should a grensejustering
    renumber the grunnkrets it moves, or is a krets spanning both kommuner the intended end
    state? Read it before answering "we need a krets parameter" either way.
- `README.md` — project overview.
