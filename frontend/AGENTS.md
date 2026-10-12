# frontend — React + Vite SPA

Client-only React 19 + TypeScript SPA: select cadastral parcels on a map (OpenLayers) and
build komreg work lists. Talks only to the Kotlin backend, same-origin by default; dev
points `VITE_API_URL` at `:8080` (`.env.development`).

The reasoning behind the rules below lives in `../docs/adr/` and in the comments next to the
code. This file says what to keep true; read the pointer before changing the thing it guards.

## Toolchain — vite-plus (`vp`) on pnpm, not vanilla Vite

- `vp dev` — dev server (:5173)
- `vp test` — tests (Vitest, bundled in vite-plus)
  - Most tests are pure and run in Node. A component test opts into jsdom with
    `// @vitest-environment jsdom` on its first line (`ReguleringView.test.tsx`). Keep those
    to pages where a wrong click is expensive, and fake the backend by stubbing `fetch`.
  - No browser tests: CI has to stay fast enough to deploy from.
- `vp lint` — lint (oxlint). Warnings fail it (`denyWarnings`), so there is no backlog of
  them to ignore. Besides the layer rules it checks import cycles, `jsx-a11y` and the React
  Compiler's rules. Silence a finding on its own line with the reason beside it.
- `pnpm format` / `pnpm format:check` — oxfmt, configured under `fmt` in `vite.config.ts`.
  `.prettierignore` holds it to code; don't let it reformat the repo's docs.
- `tsc -b && vp build` — typecheck + build to `dist/`

Use `pnpm add` / `pnpm remove` for deps. Vite plugins go through `lazyPlugins(() => [...])`
in `vite.config.ts`, not a bare `plugins: []`.

## Updating dependencies

Dependabot opens the PRs (`../.github/dependabot.yml`). It does not keep these in step:

- **vite-plus moves as a set.** The catalog in `pnpm-workspace.yaml` holds `vite-plus`,
  `vite` and `vitest`; bump all three to what the vite-plus release bundles, and run
  `vp migrate` when its release notes say so. Vitest is updated by hand.
- **pnpm's version is in three places that must agree:** `devEngines` in `package.json`,
  `corepack prepare` in `Dockerfile.dev`, and `pnpm/action-setup` in
  `../.github/workflows/ci.yml`.
- **Node is `26` in two places:** `Dockerfile.dev` and `ci.yml`. Move the runtime and
  `@types/node` to a new major together.
- **Verify** with `tsc -b`, `vp lint`, `vp test` and `vp build`. CI also runs
  `pnpm format:check`.
- **Rebuild the dev container** with `docker compose up --build -V frontend`. Not `down -v`:
  that also deletes the database volume.

## TanStack skills in `node_modules`

Router and Table ship agent skills inside their npm packages, matched to the installed
version. Nothing loads them automatically. Before changing routing or a table, read the one
that fits the task; do not read them all.

- **Router** — `node_modules/.pnpm/node_modules/@tanstack/router-core/skills/router-core/`.
  Start with `SKILL.md`, which picks a sub-skill. The ones that apply here are `navigation`,
  `path-params`, `type-safety` and `not-found-and-errors`. The app follows their file-based
  setup, so the examples apply as written.
- **Table** — `node_modules/@tanstack/react-table/skills/` (`getting-started`,
  `table-state`) and `node_modules/.pnpm/node_modules/@tanstack/table-core/skills/`
  (`table-features` for sorting, filtering and the like). Only `LandingScreen.tsx` uses it.

Missing after a fresh clone? Run `pnpm install`. TanStack Query ships no skills.

## Where code goes

`src/` is layered and imports point downwards only. `vp lint` enforces the table below: the
layer rules are at the top of `vite.config.ts`, and a new feature folder has to be added to
`FEATURES` there. A file name in this document is unique under `src/`; the table says which
folder it is in.

| Folder | Holds | May import |
| --- | --- | --- |
| `app/` | The router and the last-resort error boundary | anything |
| `routes/` | Route files and nothing else | features and everything below |
| `features/<name>/` | One workflow: its screens, components, hooks, state and clients | everything below, never another feature |
| `checks/` | `validate.ts` and `matrikkelsjekk.ts`: rules plus the lookups they need, used by more than one feature | `data/`, `domain/`, `lib/` |
| `components/`, `hooks/` | UI shared by several features: `ui/` (shadcn), `MiljoBadge`, `useConfirm` | `data/`, `domain/`, `lib/` |
| `data/` | Clients for our backend and the query definitions shared across features: `http.ts`, `lists.ts`, `listQueries.ts`, `external.ts`, `kommunerQuery.ts`, `kjoring.ts`, `useAddresses.ts`, `useKjoring.ts` | `domain/`, `lib/` |
| `domain/` | Types, Zod schemas and keys (`domain.ts`) and the row rules (`komreg.ts`). No React, no OpenLayers, no fetch, no DOM | nothing |
| `lib/` | Helpers that know nothing about komreg: `utils.ts`, `download.ts` | nothing |
| `testing/` | Test fixtures | `domain/` |

The features:

- `working-session/` — everything that edits one list: the landing screen that picks it, the
  map (`MapView`, `map/useOlMap.ts`), the arbeidsliste, the komreg-liste and the store.
- `reguleringer/` — saved reguleringer, the parameterfil preview and the test runs.
- `kjoring/` — the read-only view of what komreg-backend holds.
- `parametre/` — the static explainer.

Something two features need goes down a layer, not sideways: that is why the row rules, the
checks and the address lookups are not in a feature. Import across folders with `@/`, inside
a folder with `./`. No `index.ts` re-export files: they pull a whole folder into a chunk that
needed one function.

Tests sit beside the file they test.

## State and structure

- Server state → TanStack Query. Shared session state → Zustand (`store.ts` in
  `features/working-session/`).
  Ephemeral UI state → local `useState`.
- **One thing, one place** (`../docs/adr/0002-parameterfil-only-output.md`). Navigating to
  something from several places is fine; *doing* it from several is not. `SessionBar`
  (`SessionPanel.tsx`) is the single save control and `MiljoBadge` the single environment
  indicator. Both are propless and fetch for themselves; render them, don't copy them.
- **A destination keeps the same label everywhere**, e.g. "Arbeidsliste", "Lister",
  "Hva komreg trenger".
- **The UI says "grensejustering", the code says "list".** `ListSummary`, `/lists`,
  `useWorkingList` and the `lists` table keep the old name on purpose; renaming them is a
  backend migration and its own change. Nothing enforces one kommunepar per list.
- **Routing is file-based (`src/routes/`).** A file there is a route; `__root.tsx` has the
  map of them. `src/routeTree.gen.ts` is generated by the TanStack Router plugin in
  `vite.config.ts` and committed, because `tsc -b` runs before the build in CI. Never edit
  it or the path string in `createFileRoute(...)` by hand; rename the file instead.
  - Keep page components in their feature folder and import them into the route file. Do
    not export a component from a route file: that stops the plugin from splitting it into
    its own chunk.
  - Read params with `Route.useParams()` in the route file. No `strict: false`, no casts.
  - `/`, `/reguleringer`, `/kjoring` and `/parametre` have no map. `_map.tsx` is a
    **pathless layout route** holding `MapView`, with `/kart` and the work pages in its
    `<Outlet/>`. Don't move a work page out from under `_map`: OpenLayers would remount on
    every tab switch.
- **A crashing page shows `ErrorScreen` in its own place** (`defaultErrorComponent` in
  `app/router.tsx`), with the layout around it left standing. A crash under `_map` therefore
  keeps the map and the session. Don't give a route its own `errorComponent` unless it can
  say something more useful. Failed requests are not crashes; they are handled where the
  request is made.
- shadcn components are vendored in `src/components/ui/`; edit them freely.
- Design tokens are CSS variables in `src/index.css`, dark-only. The OpenLayers styles in
  `useOlMap.ts` are canvas, so they carry their own hexes.
- Use `useConfirm` for new confirms, not `window.confirm`. Convert the remaining
  `window.confirm` and `window.alert` calls when the surrounding code is next edited, not in
  one sweep. Error paths also `console.error` the caught value.

## Data boundaries

- **Zod guards every boundary the app reads from:** the `WorkingState` blob on load
  (`domain.ts`, applied in `useWorkingList.ts`), every JSON geo response
  (`external.ts`), and the raw teig properties (`toTeigProps` in `domain.ts`).
  - **Never `.strict()`.** Unknown keys are stripped; the schemas catch a field that
    vanished or changed type.
  - **One failure shape:** `parsed()` in `external.ts`. Its message says "uventet
    svarformat", never "unreachable".
  - Geometry stays near-opaque (`z.custom`); it goes straight to OpenLayers.
  - XML is not Zod-checked (`parseTeigGml`, `fetchGrunnkretsAt`); `toTeigProps` covers the
    teiger that come out of it.
- **`toTeigProps` is the one choke point every teig passes through**, and it normalises
  `gardsnummer` 0 to null. The Teig WFS writes 0 where the eiendom API leaves null, and
  everything downstream keys off null. Don't move this check into the parsers.
- **A failed call to our own API becomes an `ApiError` in one place:** `apiError()` in
  `http.ts`. Branch on its `kode` with `erKode(e, '…')`, never on the message or the status
  alone. The geo lookups in `external.ts` keep their own messages; they say what was
  being looked up.
- **A query is defined once**, with `queryOptions`, beside the client it calls:
  `listQueries.ts`, `kommunerQuery.ts`, `useAddresses.ts` and `useKjoring.ts` in `data/`,
  and `queries.ts` in `features/reguleringer/`. Don't type a key out in a component: two
  spellings of one key is how a save refreshed the list index and left the list cached.
  - A write to a list ends in `listSaved` or `listDeleted`, which say what it made stale.
  - **`staleTime: Infinity` means "only we change it, or nothing does in a session"**: one
    list's contents, addresses, the kommune list, the geo searches, a stored test payload.
    Everything komreg-backend or another user can change keeps the default and refetches on
    mount: the list index, reguleringer, test runs, kjøring, the miljø (it moves
    when the backend restarts, and the run confirm fetches it fresh every time).
  - **Opening a list and generating a parameterfil never read the cache.** Both call
    `getList` directly; a cached copy there would be the wrong one.
- **`AddressInfo.adressekode` is nullable.** A matrikkeladresse has no street, so it can
  never become a veg or vegadresse row. Don't cast it away.
- **All API calls go through our own backend**, never straight to komreg-backend or the geo
  APIs. Only map tiles, WMS and the click point-lookup go from the browser to Kartverket.
- **`useAddresses` is concurrency-gated** (a module-level semaphore of 6, shared with
  `fetchAddressesFor`). Don't remove it: a large grunnkrets selection creates thousands of
  requests at once and the browser fails them all.

## Map

- **Two click modes compete for the same map click**, "Legg til teig" and "Grunnkrets".
  They are mutually exclusive in `MapView`.
- **Grunnkrets selection** adds every teig whose *representasjonspunkt* falls in the krets
  (`../docs/adr/0001-grunnkrets-teig-selection.md`), several hundred at a time, so it
  confirms with the count first. Expect teiger from a neighbouring kommune and slow address
  lookups.
- **The "Eiendomsgrenser" layer has `minZoom: 13`, and that cannot be lowered.** Past
  1:40 000 the WMS returns blank tiles inside a 200. The same WMS ignores `cql_filter` and
  cannot be filtered by kommune. Gnr/Bnr labels are a second layer held to zoom 15.

## Rows, validation and the parameterfil

- **One row derivation, used twice.** `buildKomregRows` runs in `useExports` for the live
  session and in `useRegulering` per saved list. Both must call it the same way.
- **`resolveTarget` (`komreg.ts`) is shared** by `validate.ts` and the export. Don't write a
  second copy of the fallback rules.
- **The gnr offset** ("Forskyv gnr" in `KomregTable`) writes per-row `nyGardsnummer` into
  `newValues`. It is not a resolution rule of its own.
- **`regulering.ts` is a client, not a builder.** The backend owns komreg-backend's wire
  format. Use the backend's serialized string verbatim; don't re-serialize it.
- **`validate.ts` keeps its rules pure:** `validateKomreg` works on the rows plus a
  `RegisterFacts` bag, and `checkKomreg` is the one function in it that fetches them. The
  store runs it for the session (`runKomregCheck`), `useRegulering.ts` for saved lists. Matrikkel findings are
  best-effort and stay `warning` or `info`, never `error`; address findings are
  authoritative.
- **No CSV.** The JSON parameterfil is the only output. `kommentarer` are notes and never
  leave the app.
- **Unsaved work is not downloadable.** Generation re-reads each list from `/lists/{id}`.
- **Don't reintroduce per-list reguleringer.** Rows from all chosen lists are pooled into
  one request, which is what makes a conflict between two lists show up before the kjøring.
- `ReguleringMeta` (id, navn, dato) is page state on the regulering view, not part of
  `WorkingState`.
- **`ReguleringView` holds the drafts, the test selection and the one confirm.** Its sections
  (`ReguleringFields`, `MedlemmerTable`, `PreviewFiles`, `RunHistory`) display and report
  clicks; what a run is made from is resolved in `useRegulering.ts`. Keep it one path to a
  run.
- **The store says nothing to the user.** Its lookups set a marker, clear it and rethrow;
  `useCoverageActions.ts` owns the wording.

## Reguleringer, test runs and kjøring

ADRs: `../docs/adr/0004-saved-regulering-test-runs.md`,
`../docs/adr/0005-komreg-backend-miljo-og-token.md`.

- **Saved reguleringer own test execution** (`/reguleringer/:id`). `/kjoring` is read-only.
- **"Send" and "Send og kjør" disable on one thing only: an empty testutvalg.** Archived,
  unsaved changes and unsaved membership are warnings in the confirm dialog; the server
  decides. Don't move them back onto `disabled`.
- **`useKjorerNa` is display only and gates nothing.** Don't re-add it as a guard.
- **The test-run confirm names the target and host.** A run against `dev` can write to
  Matrikkelen. Keep that confirm specific.
- **`MiljoBadge` reads the target from the server**, not a `VITE_` variable.
- The Kjøring table counts a regulering by **transformasjoner**, not endringer (there is one
  endring per kommunepar).
- **`ParameterfilGjennomgang` reads the payload string** (`gjennomgang.ts`), never the
  komreg rows: it reviews what is sent. "Skriv ut" portals a copy to `<body>`; see
  `.utskrift` in `index.css`.
- **"Sjekk mot matrikkelen" flags, never fixes** (`MatrikkelsjekkPanel`,
  `matrikkelsjekk.ts`, `../docs/adr/0007-sjekk-mot-matrikkelen.md`). A failed lookup counts
  as *ikke sjekket*, never *borte*. The send confirm runs the same check as a warning.

## `/parametre` ("Hva komreg trenger")

- No link points at it; reach it by URL. If it gets an entry point, it goes in the
  landing-screen header beside `Regulering →` and `Kjøring →`.
- It reads **no store and no query**, so it is correct when opened cold. Keep it that way.
- It **does not restate the wire format**; that belongs in `regulering-format.md` in
  `kartverket/smia-docs`.
- Two of the three 1.1.2027 saker move *part* of a grunnkrets, and Stranda → Fjord moves a
  whole one. Only the last is open (`../docs/adr/0006-krets-som-transformasjon.md`). Don't
  collapse them into "krets is unresolved".
