# KomReg parameterfil PoC

A desktop web app for selecting Norwegian cadastral parcels (teiger) on a map and building the
komreg parameterfil for a **grensejustering**. **React + Vite SPA** frontend, **Kotlin/Ktor +
PostgreSQL** backend, wired together with Docker Compose.

## What it produces

The **parameterfil**: the `Regulering` JSON that komreg-backend executes against Matrikkelen. Pick
teiger on the map — one at a time, a whole gårdsnummer-serie, or every teig in a **grunnkrets** —
then decide what moves where on the arbeidsliste and the komreg-liste, and save the list. Repeat per
area.

The _Reguleringer_ page stores multiple named reguleringer. Each one explicitly contains the saved
grensejusteringer for that delivery, so a 2027 regulering does not silently absorb new 2028 work. A
test run can use one, several, or all of its members and snapshots the exact saved versions and
payload it used. Three selected lists covering one kommunepar each give you four files:

- `<id>-samlet.json` — all three kommunepar as `endringer` in one regulering, for running the whole
  thing in one kjøring
- `<id>-<fra>-<til>.json` × 3 — one kommunepar each, for running them one at a time

Both kinds are complete `POST /reguleringer` bodies.

```
KomReg parameterfil PoC                                    komreg-backend
  frontend  --rader-->  backend  --JSON-->  komreg-backend   POST /reguleringer
 (velg i kart)         (bygger payloaden)                    GET  /run/{regId}
                                \--> nedlasting (uendret)
```

Lists can be unticked to keep a draft out. Pooling is also what catches conflicts _between_ lists:
two lists moving the same gnr are a duplicate kilde-ident, reported before upload rather than
surfacing as "More than one match" partway through a kjøring.

**Kjør test** generates a fresh one-use komreg id, stores the payload, posts it to komreg-backend,
and starts it. `/kjoring` remains a read-only view of komreg-backend's inventory and global running
status. Downloading previews and historical payloads remains available.

Two things to know. `POST /reguleringer` does **not** upsert — `regulering.id` is the primary key
and the handler is a plain `INSERT`, so re-sending an existing id comes back as komreg-backend's
generic `500 "Failed to save Regulering."`; delete it there and send again. And `GET /run/{regId}`
is fire-and-forget against Matrikkelen: it answers as soon as the background coroutine is running,
and nothing here can stop it — which is why Start kjøring asks first.

### Which komreg-backend

`KOMREG_TARGET`, read once when **our** backend starts. Auth follows from the target, so there is no
way to be half-switched, and a misconfigured target refuses to boot rather than falling back.

|               | `local` (default)       | `dev`                                                      |
| ------------- | ----------------------- | ---------------------------------------------------------- |
| URL           | `http://localhost:8081` | `https://komreg-backend.atkv3-dev.kartverket-intern.cloud` |
| Auth          | none                    | Entra bearer, fetched with `az`                            |
| Start it with | `./dev.sh`              | `./dev.sh dev`                                             |

Overridable with `KOMREG_LOCAL_URL` / `KOMREG_DEV_URL` / `KOMREG_DEV_CLIENT_ID`, but the defaults
are right; normally you set only `KOMREG_TARGET`.

#### One command

```bash
./dev.sh            # local  — komreg-backend on your own machine
./dev.sh dev        # dev    — komreg-backend in atkv3-dev, with your Entra token
```

Both bring up the whole stack in Docker (Postgres, our backend, the Vite dev server) on
http://localhost:5173.

For `local`, start komreg-backend first — both servers default to port 8080, so give it another:

```bash
cd ../komreg-backend && PORT=8081 ./gradlew :server:run   # its own .env, TOGGLE_SINK_OFF=true
```

For `dev`, the script fetches the token with `az` **on the host** and passes it into the container,
because the backend image has neither `az` nor your Azure login. That token does not refresh, so
**re-run `./dev.sh dev` when it expires** (roughly hourly) — you will see a 401 from komreg-backend,
not a crash.

#### Or run the backend on the host

Worth doing if you are iterating on the backend, or if the container cannot reach
`kartverket-intern.cloud` through your VPN (container traffic is NAT'd via the host, which usually
works, but Tailscale setups vary). Here `az` runs in-process, so the token refreshes itself:

```bash
docker compose up -d db                  # Postgres only — not the backend, it would take :8080
cd backend
KOMREG_TARGET=dev DEV_DB=1 DEV_CORS=1 TEST_RUNS_ENABLED=1 ./gradlew run
cd ../frontend && pnpm dev
```

`TEST_RUNS_ENABLED=1` matters: compose sets it for you, `./gradlew run` does not, and without it
**Kjør test** answers _"Testkjøring er ikke aktivert i dette miljøet."_ `DEV_DB=1` points at the
compose Postgres; `DEV_CORS=1` lets the Vite dev server call it.

Either way, the backend logs the target it resolved on boot, and says where the token came from:
`komreg-backend: dev (https://komreg-backend.atkv3-dev...), token: az-cli, testkjoring: på` (or
`token: KOMREG_DEV_TOKEN` when it was passed in).

`dev` needs three things, and the third catches people out because it is not in komreg-backend's
README either:

1. Azure CLI, and `az login --allow-no-subscriptions`.
2. Membership in the Entra group `AAD_TF_TEAM_SMIA`.
3. **The Kartverket network (VPN/Tailscale)** — the dev ingress is on `kartverket-intern.cloud` and
   is not publicly reachable.

Worth proving those three outside the app first, so a later failure is unambiguously ours:

```bash
TOKEN=$(az account get-access-token \
  --scope 6f6f58a9-c0fa-47b7-9db5-3624dbcfd893/.default --query accessToken -o tsv)
curl -H "Authorization: Bearer $TOKEN" \
  https://komreg-backend.atkv3-dev.kartverket-intern.cloud/reguleringer
```

The app fetches the token the same way, caches it in memory for 50 minutes, and never writes it to
disk or logs it. The page header shows which komreg-backend you are on and the test-run confirm
names it — `TOGGLE_SINK_OFF` is set on the deployed pod, not by us, so **a `dev` run can write to
Matrikkelen**.

See `docs/adr/0005-komreg-backend-miljo-og-token.md`; `docs/adr/0003-send-til-komreg-backend.md` has
why the call goes through our own backend rather than from the browser.

> The format this app emits is described in
> [`docs/parameterfil-grensejustering.md`](docs/parameterfil-grensejustering.md); the team's full
> field reference is `regulering-format.md` in `kartverket/smia-docs`. This app emits the four
> transformasjon types a grensejustering (K3) needs — `matrikkelenhet`, `teig`, `veg`, `vegadresse`.
> Sammenslåing and deling need `fylke`/`kommune`/`krets` too and are out of scope. Whether a
> grensejustering should _also_ renumber the grunnkrets it moves is open —
> `docs/adr/0006-krets-som-transformasjon.md`.
>
> The JSON is the app's only output (`docs/adr/0002-parameterfil-only-output.md`).

## Running the app (Docker)

Everything runs via Docker Compose — Postgres, the Ktor backend, and the Vite dev server (hot
reload). `docker compose up` targets `local`; use `./dev.sh dev` to point the same stack at
atkv3-dev (it only adds the token — see [Which komreg-backend](#which-komreg-backend)):

```bash
docker compose up --build
```

- Frontend (Vite dev server): http://localhost:5173
- Backend API: http://localhost:8080/api
- Postgres: localhost:5432

**Day-to-day, just `docker compose up`.** Dependencies are installed _inside_ the images, so you
don't need Node/pnpm on the host to run the app. The services start in order (db → backend →
frontend) via healthchecks.

### When you change frontend dependencies

The Docker build installs from the committed `pnpm-lock.yaml` with `--frozen-lockfile` (for
reproducible builds), so the lockfile must be in sync first:

```bash
cd frontend
pnpm add <pkg>      # or pnpm remove <pkg> — updates pnpm-lock.yaml automatically
cd ..
docker compose up --build --renew-anon-volumes
```

- Use **`pnpm add`/`pnpm remove`** to manage deps — they keep the lockfile in sync. Hand-editing
  `package.json` without installing breaks the frozen-lockfile build.
- **`--renew-anon-volumes`** refreshes the container's `node_modules` — the anonymous volume can
  otherwise hold on to stale deps after a change.

### Toolchain versions (manual, not Dependabot)

Dependabot opens PRs for npm packages, Gradle, Docker tags and GitHub Actions. It does **not** bump
these, so change them by hand, in all the listed places:

- **Node.js** (`26`): `frontend/Dockerfile.dev` (`FROM node:26-slim`), `.github/workflows/ci.yml`
  (`node-version`) and `@types/node` in `frontend/package.json`. Dependabot ignores major bumps of
  these.
- **pnpm** (`12.11.2`): `frontend/package.json` (`devEngines.packageManager`), the
  `npm install -g pnpm@…` line in `frontend/Dockerfile.dev`, and `version` for `pnpm/action-setup`
  in `.github/workflows/ci.yml`. Then run `pnpm install` so the lockfile matches.
- **vite-plus / vite / vitest**: the catalog in `frontend/pnpm-workspace.yaml`. Dependabot groups
  vite-plus with vite, but vitest is bumped by hand to what vite-plus bundles.
- **`vp` CLI**: `vp upgrade`.
- **GitHub Actions** are pinned to commit SHAs with the version as a comment. Dependabot proposes
  updates for them.

The full list, with the reasons, is in
[`frontend/AGENTS.md`](frontend/AGENTS.md#updating-dependencies).

The TanStack agent skills are linked into `frontend/.github/skills/` by pnpm. Approving a new
package that ships skills is a `pnpm approve` step, and the decision is kept in
`frontend/pnpm-workspace.yaml`.

### Useful commands

```bash
docker compose up -d              # detached
docker compose logs -f frontend   # follow a service's logs
docker compose down               # stop
docker compose down -v            # stop + wipe the Postgres volume (fresh DB)
```

## Frontend dev (without Docker)

```bash
cd frontend
pnpm install
pnpm dev        # vp dev server   (also: pnpm build, pnpm test, pnpm lint)
```

Saving/loading lists **and the address/teig lookups** need the backend running — it proxies the
Geonorge/Kartverket geodata, so the frontend calls it (`http://localhost:8080` by default, override
with `VITE_API_URL`) instead of the external APIs. Only the base map tiles work without the backend.

## Docs

- **In the app: «Hva komreg trenger»** (`/parametre` — no link points at it, go there by URL) — the
  arbeidsdeling in one page, for whoever is using the tool. What komreg does by itself, the handful
  of values you actually enter, what follows from them, and what is deliberately not a parameter. It
  opens on the three 1.1.2027 sakene, because translating those into komreg parameters is the job.
  Deliberately not a copy of the wire format; that stays in `regulering-format.md`.
- [`docs/architecture.md`](docs/architecture.md) — the whole system in two diagrams (C4 context +
  containers): what talks to what, and the rules at each boundary.
- [`docs/parameterfil-grensejustering.md`](docs/parameterfil-grensejustering.md) — how the
  parameterfil is built, how komreg-backend reads it, and the shape each of the four
  transformasjoner must have.
- [`docs/adr/`](docs/adr/) — decision records: why each part turned out the way it did. See
  `AGENTS.md` for the list.
