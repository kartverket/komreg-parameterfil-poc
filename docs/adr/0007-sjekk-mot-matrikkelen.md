# 7. A saved list is checked against the matrikkel on request, and findings are flagged, not fixed

Status: accepted

## Context

A saved list is a snapshot: each teig's lokalid, matrikkelnummer and geometry as they were
when it was picked. The matrikkel moves on — teiger are split, merged, moved to another
matrikkelenhet or deleted. Fetching again only ever finds what exists *today*, so what has
gone simply stops being there, and nothing says so. The parameterfil would still name it.

This is not hypothetical. On 2026-10-02 the check below, run against the live Teig WFS,
found two of the 16 teiger in the saved list «Bindaln» gone: one replaced by two new
lokalid-er on the same matrikkelenhet, one by a teig now on 5060-90/4.

## Decision

**"Sjekk mot matrikkelen" on the arbeidsliste** (`MatrikkelsjekkPanel`, rules in
`frontend/src/checks/matrikkelsjekk.ts`). For the loaded list:

- Teiger with a matrikkelnummer: one `/geo/gnr-teiger` call per kommune+gnr — the route the
  gnr-serie selection already uses, so **no new backend route** — diffed on lokalid:
  - **borte** — the lokalid is not in its gnr any more. `enhetBorte` when the matrikkelenhet
    has no teig left either: then the parameterfil names a unit the register no longer draws.
  - **endret** (`nyEnhet`) — same lokalid, now on another matrikkelenhet. Rows are keyed off
    the matrikkelenhet, so this changes what would move.
  - **ny** — a teig on a matrikkelenhet the list moves that the list doesn't hold. It moves
    anyway (komreg moves the unit), but the list and the map don't show it. Not reported for
    a whole-gnr row: the list never claimed every bnr there.
- Teiger without matrikkelnummer: `/geo/kommune-teiger-uten-mnr` per kommune; the lokalid is
  either still there or **borte**.
- For each **borte**, the eiendom point API at the teig's interior point lists what lies there
  now, as candidates to add.

**Flag, don't fix.** Every finding is a row with its own action (fjern / oppdater / legg til /
ignorer), and an action only edits the working state; nothing is saved until Oppdater.
A **failed lookup is "ikke sjekket", never "borte"** — reporting a teig as gone because the
network blipped is the one answer this must never give.

## Consequences

- One WFS call per gnr, four at a time. A grunnkrets list spans dozens of gnr; it takes
  seconds, and runs only when asked.
- **Send and Send og kjør run it too, as a warning.** Before the confirm opens, each chosen
  list is checked as *saved*, and anything gone, moved to another matrikkelenhet or
  uncheckable becomes one paragraph in the dialog. Not a gate: the open data can lag, and the
  person sending knows the vedtak. `ny` teiger are left out there — they move with their unit.
  The check is still not part of saving or generating.

## Data gaps

- **No history in open data.** We see *that* a teig is gone, never *why* — merged, split,
  renumbered and deleted look the same. The point lookup is the nearest substitute.
- **Geometry changes are not reported.** The saved geometry comes from several sources
  (eiendom API click, geokoding, WFS GML) with different precision, so a coordinate compare
  would flag everything. An area compare with a tolerance is the next step if needed.
- **Addresses are not diffed.** The list does not store them — they are fetched fresh when
  rows are derived — so there is no baseline to compare with. They are current by
  construction; what can't be seen is which ones appeared or disappeared since.
- **Whole streets (`wholeAdressekode`) are not checked.**
- The MatrikkelAPI would answer all of the above directly; it needs applied-for credentials.
