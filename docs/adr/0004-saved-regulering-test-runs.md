# 4. Reguleringer are saved definitions; test runs snapshot a selected subset

Status: accepted (test execution only)

## Context

The original `/regulering` page was temporary state and started with every saved
grensejustering selected. That cannot separate a 2027 delivery from work for 2028, and
komreg-backend cannot accept the same regulering id twice.

## Decision

A regulering is persisted with explicit list membership, metadata and an archive state.
Membership is the boundary of the delivery: a 2027 regulering contains only the chosen
2027 lists. A test run chooses any non-empty subset of those members, so one adjustment
and all adjustments can be tested without creating duplicate regulering definitions.

Lists remain live while work continues. At execution, the client resolves the latest
saved versions and sends their ids and `updatedAt` values with the rows. The backend
rejects stale or non-member sources, generates a fresh `<base-id>-t-<suffix>` payload,
and stores the exact JSON and source versions before handing it to komreg-backend.

Run history records only what can be known: prepared, sent, rejection/unknown outcomes,
or start accepted. komreg-backend has no per-run completion result. Network-ambiguous
actions are never retried automatically.

Test execution is gated by `TEST_RUNS_ENABLED=1`. Production authentication,
finalization and execution remain out of scope.

## What `/is-running` is not

We briefly gated the Kjør test-button on komreg-backend's `GET /is-running`, on the
assumption that it runs one kjøring at a time. Reading its source settled both halves,
and both were wrong:

- The flag is true for `KJØRER`, `STARTET_TILBAKEFØRING` **and `IKKE_TILBAKEFØRT`.** The
  last is a resting state — ran, never rolled back — so after one test run nobody
  tilbakeførte, the flag stays true indefinitely. The button went permanently grey.
- It is not a concurrency lock. Its consumer over there is CI
  (`check-is-komreg-dev-running.yml`), which uses it to decide whether it is safe to
  *deploy* the dev environment. komreg-backend's own conflict check is per regulering
  (`ReguleringService.getOrThrowRegulering` throws `ReguleringAlreadyRunning` only for
  that regId), and since every test run mints a fresh `externalId`, it can never fire
  for us.

So the gate is gone from both halves; the flag is displayed on `/kjoring` and labelled
for what it means. Do not re-add it as a guard. A run that genuinely cannot proceed
fails on the send, with a message that says more than a naked boolean can.

The same round trip took the *other* client-side gates off the button. Archived, unsaved
changes and not-yet-saved membership are now warnings in the confirm dialog rather than a
disabled button: the server decides all three anyway, it decides on what is **saved**, and
it has the whole reason. A refusal that says why beats a grey button with no way forward —
and a disabled shadcn button cannot even carry a tooltip (`disabled:pointer-events-none`).
Only "nothing is selected" still disables, because the fix for it is one click away.

**Data gap:** there is no endpoint that answers "is a kjøring in progress right now",
and none that says which one or since when. If komreg-backend ever grows a real run
status, a *warning* (not a block) in the confirm dialog is the place for it.

## Consequences

- New lists never enter an existing regulering automatically.
- One list may belong to several reguleringer.
- A referenced list cannot be deleted; reguleringer are archived instead of deleted.
- Historical payloads are immutable downloads. Re-running always uses the current saved
  list versions and gets a new external id.

## Send uten start

Sending and starting are now two actions. `POST /reguleringer/{id}/testkjoringer` takes
`start: false` and stops at `sent`: the regulering lies in komreg-backend's database and
nothing has run. `POST /reguleringer/{id}/testkjoringer/{runId}/start` starts that row later
with the same external id and the same stored payload — no new payload, no new id.
`start` defaults to `true`, so send-and-start is unchanged for any caller that doesn't know.

- **The guard is a state transition, not a read.** `claimStart` moves `sent` → `start_unknown`
  in the `UPDATE`'s own `WHERE` before the call to `/run`, so a double click or a second tab
  cannot reach `/run` twice. `start_unknown` is also the true state while the call is in
  flight; a crash mid-call leaves the row in the one state nobody re-runs without checking.
  No migration — every status already existed.
- **List and regulering versions are not re-checked at start.** They guarded what was sent,
  and that is done. The history already marks a run whose lists changed since.
- **A sent regulering is not a validated one.** komreg-backend validates at `/run`, not at
  `POST` (ADR-0003 data gaps), so `sent` says it landed, not that it will start. The confirm
  dialog says so.

Why: a fagperson should be able to look at what is in komreg-backend — and at the
parameterfil review on the regulering page — before anything runs.
