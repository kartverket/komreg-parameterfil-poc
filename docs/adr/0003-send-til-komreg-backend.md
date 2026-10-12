# 3. The app sends the regulering to komreg-backend, and starts the kjøring

Status: accepted; **amended in part by ADR-0005** (the "local only, no
token" scope below — its own "revisit when" fired) and by ADR-0004 (execution moved from
`/kjoring` into saved reguleringer). The transport decision — proxy through our own backend —
is unchanged, and is what made both of those cheap.

## Context

The app stopped one step short of the finish line. `/regulering` pooled every saved
grensejustering into one `Regulering`, the backend serialized it with the same kotlinx config
komreg-backend parses with, and you **downloaded a .json file** — then opened Bruno or curl,
`POST /reguleringer` by hand, and `GET /run/{regId}` by hand.

That gap was deliberate. `regulering/ReguleringRoutes.kt` said so verbatim:

> *Vi POSTer aldri videre til komreg-backend herfra. Det ville krevd Entra-token, og innlegging
> + GET /run/{regId} gjøres bevisst for hånd — /run er fire-and-forget mot Matrikkelen.*

Both halves of that are still true **in dev and prod**, where komreg-backend sits behind SKIP's
ztoperator and wants an Entra token. Neither is true **on localhost**, where komreg-backend
installs no Authentication plugin and no CORS plugin at all — there is nothing to bypass, and
Bruno's own local environment skips the `Authorization` header for exactly this reason.

So the reason to keep a human in the middle was never really "it needs a token". It was "the
run is irreversible". A confirm dialog addresses that; a manual file round-trip is a clumsy
proxy for it.

## Decision

**The app sends the regulering and starts the kjøring, over a proxy in our own backend, with
no token, locally.** Download is unchanged and stays.

- **Browser → our Ktor backend → komreg-backend**, never browser → komreg-backend. komreg-backend
  has no CORS plugin, so a direct fetch is blocked without changing that repo; the
  standing rule is that API calls go through Ktor rather than the browser; and when a token
  arrives it belongs server-side. This is the `/geo/*` proxy shape we already have.
- **No `Authorization` header is sent anywhere.** Pointing this at dev or prod needs Entra
  first — and then the token goes in the `kjoring/` slice, not in the SPA.
- **Send lives on `/regulering`, start lives on `/kjoring`.** Not a split for its own sake:
  `/regulering` is the only page where the payload exists, and rebuilding the list picker and
  the generate step on `/kjoring` to get a Send button there would be a second implementation
  of one action — the thing ADR-0002 forbids. `/kjoring` is the operations half: what
  komreg-backend holds, whether a kjøring is active, and starting one.
- **The payload crosses as a string, untouched.** `ReguleringFil.json` goes from the backend to
  the browser to the backend and out, never through a JS object and never re-parsed by us. What
  the Filer table describes is byte for byte what lands over there, and `ReguleringKontraktTest`
  remains the thing that vouches for it.
- **`GET /run/{regId}` is exposed as our `POST /kjoring/start/{regId}`**, behind a
  `window.confirm`. It is a GET over there, but it is irreversible, and a GET can be fired by a
  prefetch or a pasted link.

## Consequences

- **Two Ktor servers both default to :8080.** Ours and komreg-backend's. Run komreg-backend as
  `PORT=8081 ./gradlew :server:run` and set `KOMREG_BACKEND_URL` to match. That URL is HOCON
  config rather than a hardcoded const like the geo upstreams, because unlike Kartverket's fixed
  public URLs it moves with the environment — but it is **optional with a default**, unlike
  `db.*`: everything except `/kjoring` works with komreg-backend switched off, so an unset value
  must not stop us booting.
- **`POST /reguleringer` is not an upsert.** `regulering.id` is the primary key and the handler
  is a plain `INSERT`, so re-sending the same id is a constraint violation — swallowed, like
  every other failure there, into one `500 "Failed to save Regulering."`. There is no 400 at
  all. Our proxy therefore **does not** collapse a non-200 to 502 the way the geo proxy does:
  the difference between that 500 and a `409` "already finished" is the entire diagnostic, so
  the upstream status and text are relayed verbatim, and only "never got there" is our own 502.
  Fixing a duplicate is `DELETE /reguleringer/{id}` and re-send.
- **`GET /reguleringer` is reduced server-side** to id/navn/dato/count. It returns every stored
  regulering in full, and a 2028 run is tens of thousands of transformasjoner. Same grep as
  `/geo/kommune-teiger-uten-mnr` reducing megabytes of GML to a list of ids.
- **The `regId` guard is load-bearing.** It is interpolated into an outbound URL path, so
  `^[A-Za-z0-9_-]{1,64}$` is checked before any upstream call — the same ordering as the digit
  guards in `GeoRoutes.kt`, and asserted with a hit counter for the same reason.
- **komreg-backend cannot be mocked from its own repo** — it has no `ktor-server-test-host` and
  no HTTP stub. `KjoringApiTest` fakes it with `MockEngine` from our side instead, which is what
  the geo tests already do for Geonorge. For a real run, `TOGGLE_SINK_OFF=true` over there stops
  anything being written back to Matrikkelen.

## Data gaps

- **komreg-backend's `ReguleringValidator` has no rules for a pure grensejustering.** Its rules
  fire on fylkesdeling, kommunedeling and vegdeling; a grensejustering matches none of them, so
  it passes validation by not being covered. Our `POST /regulering` validation and `validate.ts`
  are still the only checks that run on this payload, and shipping it further does not change
  that — it only removes the pause where someone used to look at the file.
- Validation over there runs at `GET /run/{regId}`, **not** at `POST /reguleringer`. A payload
  can land successfully and still fail at start.
- **`POST /skjema`** (`{"mottaker":"DB_MATRIKKEL_MOTTAKER1"|"DB_MATRIKKEL_MOTTAKER2"}`) is step
  one of komreg-backend's own documented flow, and it will not even boot unless a
  `mottakerskjema` row has `isfree = true`. Out of scope here — that is its setup, not ours —
  but it is the first thing to check when a fresh local instance refuses to start.

## Revisit when

komreg-backend is reachable anywhere other than localhost. Then this needs Entra first, in the
`kjoring/` slice, and the "no token" line above stops being a description and becomes a bug.
