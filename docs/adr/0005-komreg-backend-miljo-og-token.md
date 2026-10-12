# 5. One variable picks which komreg-backend; auth follows from it

Status: accepted (local tool, dev target)

Amends ADR-0003, whose body says the handoff is "local only, and sends no token" and whose
"revisit when" was *"komreg-backend is reachable anywhere other than localhost"*. It is, so this
is that revisit. ADR-0003's transport decision — proxy through our Ktor backend — is unchanged
and is what makes this cheap.

## Context

KomReg parameterfil PoC runs on a laptop. The komreg-backend worth talking to is the one deployed to
**atkv3-dev**, and reaching it was a hand-made Postman/Bruno call. We want the same app, pointed
either at a local komreg-backend or at dev, switchable without editing code.

KomReg parameterfil PoC itself is **not** being deployed; that is what keeps this small.

## Decision

**`KOMREG_TARGET` picks a named target, and everything else follows from it.**

| | `local` (default) | `dev` |
|---|---|---|
| url | `http://localhost:8081` | `https://komreg-backend.atkv3-dev.kartverket-intern.cloud` |
| token | none | Entra bearer via `az` |

- **Auth is derived from the target, never its own switch.** A separate `auth` setting would make
  "dev url, auth still off" reachable, and that failure reads as a mystery 401 rather than a
  misconfiguration. komreg-backend's own Bruno collection uses exactly this rule
  (`if (bru.getEnvName() !== 'local')`).
- **The token comes from `az account get-access-token --scope <clientId>/.default`**, cached in
  memory and refreshed past 50 minutes — a direct port of that Bruno script, down to the TTL. So
  there is one way to *obtain* a token and it is the documented one (komreg-backend README,
  "Tilgangsstyring"). Rejected: a service principal with a client secret — it needs an app
  registration created and granted, puts a real secret on the laptop, and would make
  komreg-backend's log say a robot ran the regulering. Authorization there is by Entra **group**
  membership (`AAD_TF_TEAM_SMIA`), so a delegated user token is the right shape: the audit trail
  names the person who clicked.
- **The token is attached per call, inside `KomregClient`, and never as a client-wide default.**
  The `HttpClient` is shared with the geo proxy, so a `defaultRequest { bearerAuth(…) }` or an
  `Auth` plugin install would ship a Kartverket-internal Entra token to `ws.geonorge.no` and
  `api.kartverket.no` on every address lookup. That is the tidier-looking way to write this and
  the only dangerous one; `KjoringApiTest` asserts a `/geo/*` request carries no `Authorization`
  header while the target is `dev`.
- **`KomregClient` is the single outbound path.** `kjoring/`'s read routes were forwarding through
  their own copy of the HTTP glue; they now go through the client too, because a second call site
  is one that can forget the token.
- **A token may also be handed in as `KOMREG_DEV_TOKEN`, and then it wins.** This is not a second
  auth mechanism — it is the same `az` token, fetched one process out. A container has no `az`
  binary and no Azure login, so without this the whole stack could not run under compose against
  dev, and "one command to run everything" would have been a lie. `dev.sh` fetches it on the host
  and passes it through. It does **not** refresh, so a compose run needs restarting roughly hourly;
  the backend on the host refreshes itself. `KomregClient` takes a `suspend () -> String` rather
  than an `AzureCliToken`, so it does not know or care which of the two it got.
- **The target is shown in the UI.** `MiljoBadge` — propless, self-fetching, one component with
  several mount points, like `SessionBar` — sits in the header of `/kjoring` and of the regulering
  detail page, and the test-run confirm names the target and host. Fetched from the backend rather
  than a `VITE_` variable, which would drift the moment someone restarts with a different target.
- **A run names the target it was confirmed against.** A page left open across such a restart
  would otherwise confirm one target and send to another. The confirm fetches the target fresh,
  and both the send and the separate start carry its url (`expectedKomregUrl`); the backend
  answers 409 when that is not where it points, before it journals, sends or claims anything.
- **No `prod` target.** No prod hostname is committed anywhere, prod is gated on a different group
  (`AAD_KOMREG_PROD_USERS`), and adding it should be a deliberate change with its own decision —
  not one env var away from a laptop.

## Consequences

- **Nothing changes in komreg-backend. No CORS, no auth, nothing.** This is ADR-0003's proxy
  paying off: the browser only ever talks to our Ktor backend, so komreg-backend never sees a
  cross-origin request, and the token stays server-side where it belongs. Had we gone
  browser-direct, this change would have needed a CORS plugin over there *and* an Entra token
  living in JavaScript.
- **No Caddy either.** Caddy is the answer to serving *KomReg parameterfil PoC* in production,
  which is a different, still-open problem.
- **A misconfigured target refuses to boot**, naming the valid targets or the missing env var —
  the same posture as `Database.fromConfig`. Quietly running "dev" against localhost is the
  outcome worth crashing over.
- **The dev ingress is internal-only** (`kartverket-intern.cloud`; the CI health check joins
  Tailscale to reach it). A laptop needs the Kartverket network *and* a token, and that
  prerequisite is not written down in komreg-backend's README — so the unreachable-message says
  it for the `dev` target.
- **Dead code went with it.** `/kjoring/regulering` and `/kjoring/start`, plus `sendRegulering` /
  `startKjoring` / `useSendRegulering` / `useStartKjoring` / `SendResultat`, had no callers left
  after ADR-0004 moved execution into saved reguleringer. Removed rather than left carrying a
  token.
- The client id in `application.conf` is a public OAuth identifier, not a secret — it is committed
  in komreg-backend's own `http/skip/http-client.env.json`. **The token is the secret**, is never
  written to disk or logged, and never leaves the backend (`/kjoring/miljo` reports only whether
  one could be obtained).

## Data gaps

- The ztoperator `AuthPolicy` for komreg-backend lives in `kartverket/smia-apps`, not in
  komreg-backend, so the exact issuer / audience / `acceptedResources` are unverified here. What
  is verified: the README's documented flow is a delegated `az` token, and that is what we send.
- **`TOGGLE_SINK_OFF` is set on the deployed pod, not by us.** A dev run can write back to
  Matrikkelen and we cannot stop it from the client side. This is why the badge and the confirm
  both name the environment.

## Revisit when

KomReg parameterfil PoC is itself deployed. A server process cannot shell out to a developer's `az`, so
that is the point at which the service-principal flow rejected above becomes the right answer.
