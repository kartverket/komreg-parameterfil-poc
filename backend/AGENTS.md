# backend — Kotlin / Ktor + Postgres

Ktor server (Netty) on Kotlin 2.4, JVM 25. Five jobs: persist the frontend's `WorkingState` blob,
proxy the public Geonorge/Kartverket geo APIs, build komreg-backend's `Regulering` payload from the
rows the frontend hands it, persist the saved reguleringer and their test-run history, and hand a
payload over to komreg-backend. Nothing else.

The reasoning behind the rules below lives in `../docs/adr/` and in the comments next to the code.
This file says what to keep true; read the pointer before changing the thing it guards.

**No auth, anywhere.** `/lists` is a _global_ CRUD with sequential ids and no owner column. Fine on
localhost; a second user or a shared host means adding auth first. Outbound is the exception:
`kjoring/` attaches an Entra token when the target is `dev`.

## Toolchain — Gradle

Run from `backend/`; the application and its tests live in the `server` subproject.

- `./gradlew run` — serves :8080. Needs `DEV_DB=1` (and `DEV_CORS=1` against `vp dev`); boot
  **fails** without DB config.
- `./gradlew build` — compile + `ktlintCheck` + test. Tests start Postgres via Testcontainers.
- `./gradlew test` — tests only.
- `./gradlew ktlintFormat` — format. Style comes from the repo-root `.editorconfig`.
- Use JDK 25. Keep `jvmToolchain`, CI's `java-version` and both Docker stages on the same Java
  major.
- Dependency versions live in `gradle/libs.versions.toml`; bump them there.
- **Comments and docs are in English.** Identifiers and domain terms stay Norwegian
  (`kjorTestkjoring`, teig, kjøring), and so does every string a user sees: UI text, error messages
  and log messages.

## Layout (`server/src/main/kotlin/no/komreg/`)

Feature packages (vertical slices) under a small cross-cutting root. Each slice owns its routes and
repository, and gets DTOs or a service _only when it needs one_.

| Path              | What it holds                                                                    |
| ----------------- | -------------------------------------------------------------------------------- |
| `Application.kt`  | `main()` and `module()`, the composition root: DI registrations, plugins, routes |
| `Plugins.kt`      | Serialization, compression, CallId + CallLogging, StatusPages, dev CORS          |
| `Database.kt`     | Hikari pool, Flyway at boot, `withConnection`, `Connection.transaction { }`      |
| `HealthRoutes.kt` | `/health/live` and `/health/ready`                                               |
| `lists/`          | `/lists`: CRUD for the working-state blob                                        |
| `regulering/`     | `POST /regulering`: builds the parameterfil from resolved rows                   |
| `reguleringer/`   | `/reguleringer`: saved definitions and tracked test runs                         |
| `kjoring/`        | The outbound path to komreg-backend, and `/kjoring` read routes over it          |
| `geo/`            | `/geo`: proxy for Geonorge/Kartverket                                            |

Cross-cutting rules:

- Routes are `Route` extensions taking what they need as parameters, mounted under `route("/api")`
  in `module()`. This file names them without the prefix. Only `/health/*` sits outside it: the SPA
  has pages at `/reguleringer` and `/kjoring` too, and behind one origin a proxy can only tell a
  page from an API call by the path.
- Read path variables via `call.pathParameters` and query strings via
  `call.request.queryParameters`, never the merged `call.parameters`.
- Every DB access goes through `Database.withConnection`; transactions use
  `Connection.transaction { }` from `Database.kt`. Don't write a second copy in a slice.
- **Every error leaves through `call.problem(status, Kode.…, detail)`** (`Problem.kt`):
  `application/problem+json`. `detail` is Norwegian text for the user; `kode` is what the frontend
  branches on. Adding a `Kode` is fine; renaming or removing one breaks the frontend. Only
  `/health/*` answers plain text, for the probes.
- StatusPages has a `Throwable` catch-all, so client errors need their own mapping there or they
  surface as 500. `ListsApiTest` pins each mapping; run it after a Ktor upgrade.
- Tests boot the real `module()` and override dependencies through the DI container, e.g.
  `dependencies.provide<HttpClient> { mockEngine }`.

### `lists/`

- The blob is **opaque**: store and return it as-is. The frontend owns the schema. Don't grow domain
  logic over it.
- `PUT` carries `expectedUpdatedAt` and answers 409 when the list was saved since. The check is in
  the `UPDATE`'s own `WHERE`.
- `DELETE` answers 409 naming the reguleringer a list belongs to. `?force=1` removes the memberships
  and the list in one transaction; test-run history is untouched.
- No service: the routes call the repository directly.

### `regulering/`

Read `../docs/parameterfil-grensejustering.md` before touching this slice.

- `ReguleringDto.kt` mirrors komreg-backend's wire format. Field names and `@SerialName`
  discriminators must match exactly: it has no `ignoreUnknownKeys` and no defaults, so drift is an
  opaque 500. Serialize with the slice's own `reguleringJson`, not the app's `DefaultJson`.
- The cut is at **resolved rows**. The frontend has already run `buildKomregRows` and
  `resolveTarget`; don't re-derive those rules here.
- `ReguleringBuilder.kt` emits four types: `matrikkelenhet`, `teig`, `veg`, `vegadresse`. Don't tidy
  the matrikkelenhet asymmetry; the comment there says what breaks.
- The DTO file also declares `fylke`, `kommune` and `krets`, and **nothing constructs them**.
  `KretsTransformasjonDTO` is not half-built support for moving a grunnkrets. Don't wire it up
  before `../docs/adr/0006-krets-som-transformasjon.md` is answered.
- This slice only builds. No DB, no state, no outbound call.
- Touching the format? Run `ReguleringKontraktTest` (decodes our output with a bare `Json {}`
  against an independent copy of the DTOs) and `ReguleringBuilderTest` (byte-for-byte against
  `server/src/test/resources/regulering/grensejustering-5060-1811.json`).

### `kjoring/`

ADRs: `../docs/adr/0003-send-til-komreg-backend.md`,
`../docs/adr/0005-komreg-backend-miljo-og-token.md`.

- **`KomregClient` is the single outbound path** to komreg-backend. The token is attached there, so
  don't add a second call site.
- **The token must never become a client-wide default.** The `HttpClient` is shared with the geo
  proxy, so `defaultRequest { bearerAuth(…) }` or an `Auth` plugin would send a Kartverket Entra
  token to Geonorge. `KjoringApiTest` asserts a `/geo/*` request carries no `Authorization` header;
  leave that test alone.
- **Auth follows from the target and is never its own switch** (`KomregTarget.kt`). An unknown
  target, or one missing its url or client id, fails at boot. There is deliberately no `prod`.
- The token is never logged and never written to disk. `KOMREG_DEV_TOKEN` wins over `az` when set
  and does not refresh.
- **`/is-running` is display only and must not be used as a guard.** It stays true after a run
  nobody rolled back. See `../docs/adr/0004-saved-regulering-test-runs.md`; `ReguleringerApiTest`
  has the regression test.
- **Send and start do NOT collapse a non-200 to 502.** The upstream status and body are the only
  diagnostics there are, so `KomregResult` carries them. The two read routes do collapse to 502.
- **The payload is passed through as an opaque string**, never parsed.
- `GET /kjoring/reguleringer` reduces the upstream body to id, navn, dato and counts.
- No execution here: a test run starts from its saved regulering.

### `reguleringer/`

ADR: `../docs/adr/0004-saved-regulering-test-runs.md`.

- `ReguleringerRoutes.kt` is HTTP only. Integrity violations are caught by SQLSTATE class `23` and
  answered 409, not pre-checked. Other SQL failures must reach StatusPages.
- `ReguleringerService.kt` holds the test run. The _order_ of validate, build, journal, send and
  start is the design; see its KDoc. It returns a sealed `TestkjoringUtfall`, not exceptions.
- `startSendtKjoring` claims the row `sent` → `start_unknown` in one conditional `UPDATE` before
  calling `/run`, so two clicks can't start it twice.
- `ReguleringerRepository.kt`: name the columns, never `SELECT *`. Run rows omit `payload`
  (megabytes per row); `payload()` fetches it alone. `ORDER BY` must use the qualified
  `t.created_at`, since the selected column is cast to text.
- Stale or non-member sources are rejected inside the transaction, against the database, never
  against what the client sent. Lock the regulering first, then the source rows in id order.
- `update()` checks `updated_at` on the row it read and again in the `UPDATE`'s `WHERE`.
- The payload and source snapshot are stored before sending. `*_unknown` results are recorded and
  **never retried automatically**. Status strings must match the CHECK in
  `V3__saved_reguleringer.sql`.
- Execution is refused unless `testRuns.enabled` is set.
- `ReguleringerApiTest` and `ReguleringerConcurrencyTest` drive this **over HTTP only**. Keep them
  free of repository and service types.

### `geo/`

- `upstream()` in `GeoRoutes.kt` collapses every failure (unreachable, timed out, non-200) to null,
  so each route answers 502 in one place.
- **Every value spliced into an upstream URL or FES filter passes the digit guard** (`allNumeric`).
  Free-text params are length-capped and URL-encoded.
- **Nothing is stored.** A cache with a 30-day TTL was removed because stale teiger could reach a
  real regulering (`V2__drop_geo_cache.sql`). If one returns, it must be a shared Postgres table
  with a short TTL, never in-process.
- `/geo/grunnkrets-teiger` calls upstream twice and POSTs the krets geometry server-side. It filters
  on the teig's `representasjonspunkt`, not its area, and is the only route that can answer 404. See
  `../docs/adr/0001-grunnkrets-teig-selection.md`.
- `/geo/kommune-teiger-uten-mnr` reduces the upstream body to a list of teig lokalids
  (`../docs/adr/0007-sjekk-mot-matrikkelen.md`). The Teig WFS writes gårdsnummer **0** for teiger
  without a matrikkelnummer; the filter relies on that.
- `/geo/kommuner` returns the whole list on purpose: a per-number lookup could not tell "no such
  kommune" from an outage.
- `GrunnkretsService.kt` and `KommuneService.kt` are pure string/XML work, no HTTP.

## Config

HOCON in `server/src/main/resources/application.conf`, env-substituted. Read values with
`environment.config.propertyOrNull("…")?.getString()`.

| Key                       | Env                                | Notes                                                                        |
| ------------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `ktor.deployment.port`    | `PORT`                             | Default 8080                                                                 |
| `db.{url,user,password}`  | `DB_URL`, `DB_USER`, `DB_PASSWORD` | **Unset is a startup error** unless `DEV_DB=1`                               |
| `db.runtime.*`            | `DB_*_TIMEOUT_SECONDS`             | Statement, lock, idle-transaction and socket timeouts for pooled connections |
| `db.migration.*`          | `DB_MIGRATION_*`                   | Longer limits on Flyway's own unpooled connections                           |
| `komregBackend.target`    | `KOMREG_TARGET`                    | `local` (default) or `dev`; a broken value is a startup error                |
| `komregBackend.dev.token` | `KOMREG_DEV_TOKEN`                 | Only from the environment, never committed                                   |
| `dev.cors`, `dev.db`      | `DEV_CORS`, `DEV_DB`               | Dev-only, off unless `1`                                                     |
| `testRuns.enabled`        | `TEST_RUNS_ENABLED`                | Gate for test execution; unset disables it                                   |

- The local komreg-backend default is port 8081, because it also defaults to 8080.
- Never relax a pooled connection for a migration and return it to requests.
- **Tests build a `MapApplicationConfig`, so `application.conf` is not loaded for them.** Anything
  `module()` requires at boot must be added to `testConfig` (`TestDb.kt`) in the same change.
- Hardcoded, change in source: outbound timeouts (`Application.kt`, raised per request in
  `GeoRoutes.kt` and `KomregClient.kt`), `MAX_LIST_BYTES`, `MAX_FREE_TEXT`, `maximumPoolSize`, and
  the upstream URLs.

## Deployment constraints

Nothing is deployed; this runs on localhost via `compose.yml`. The code is still written to run as
2+ stateless pods, and should stay that way (`../docs/architecture.md`, "Deployment"):

- All shared state is in Postgres. Never hold per-user state in a field.
- Never edit an applied `V*.sql`; add the next `V<n>__….sql`. Flyway migrates at boot.
- Keep `shutdownGracePeriod` and `shutdownTimeout` under the pod's termination grace period.
- Each pod has its own pool: total connections are pods × `maximumPoolSize`.
- `/health/live` checks nothing but the process; `/health/ready` checks the database.
