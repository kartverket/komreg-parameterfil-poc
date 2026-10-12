# 1. Which teiger belong to a grunnkrets

Status: accepted

## Context

A komreg work list grew a few teiger at a time — one map click, one matrikkelnummer, or a
whole gårdsnummer-serie. There was no way to say "everything in this area", which is how the
work is actually divided. A grunnkrets is the natural unit for it.

The question sounds like a lookup and isn't. **No public source answers "which teiger are in
grunnkrets X".** We derive it geometrically, from two datasets that were never surveyed to
agree with each other.

### What the public data gives us

Everything this app uses is open, no key, no application:

| source | gives | doesn't give |
|---|---|---|
| `wfs.matrikkelen-eiendomskart-teig` (WFS) | teig polygons, `representasjonspunkt`, matrikkelnummer, spatial filters | any krets attribute; ownership; whether a matrikkelenhet exists at all |
| `api.kartverket.no/eiendom` | teig polygons near a point / for a gnr-bnr | anything non-geometric |
| `ws.geonorge.no/adresser` | the authoritative address register | **no grunnkrets field** (verified) |
| `wfs.grunnkretser` (SSB via Geonorge) | grunnkrets polygons, nummer, navn | which parcels are in them |

So the krets↔teig relation exists in no feed we can read. It has to be computed from a
grunnkrets polygon and a teig geometry — and those come from **independent surveys whose lines
often nearly coincide**, because grunnkrets boundaries frequently follow property lines. The
two datasets disagree by metres exactly where the answer is decided.

### Measurements

Grunnkrets 15250101 (Liabygda — rural, spans a fjord) and 33010301 (Bragernes sentrum 1 —
urban):

| rule | Liabygda | Bragernes | behaviour |
|---|---|---|---|
| `Intersects` on `app:område` | 557 | 174 | any parcel clipping the boundary joins **whole**; the selection visibly spills into the next krets |
| `Within` on `app:område` | 528 | 156 | a parcel conceptually inside but missing containment by a sliver is **dropped, silently** |
| `Within` on `app:representasjonspunkt` | **537** | **160** | — |

`Within` on the area is the more dangerous of the two: a missing parcel leaves no trace on
screen, while an extra one is visible and removable.

A second, purely mechanical constraint: a grunnkrets ring runs to ~1800 points
(Vinstrafjellet, 34360106), which inlined into a FES filter is an ~88 KB URL.

## Decision

**A teig belongs to the grunnkrets its `representasjonspunkt` falls in.** The backend filters
`fes:Within` on `app:representasjonspunkt`, never on `app:område`.

Kartverket generates that point inside the parcel, and point-in-polygon is the standard way a
parcel is assigned to exactly one statistical unit. It is not a compromise between the two
area rules but a different one, right for a different reason: the point sits in the parcel's
interior, nowhere near the boundary, so the survey mismatch cannot move it.

**The spatial query is a server-side POST.** `GET /geo/grunnkrets-teiger?grunnkretsnummer=`
takes an 8-digit number, fetches the krets polygon, lifts its `<app:område>` out untouched and
POSTs that to the Teig WFS. The browser never sends a geometry, so `/geo/*` stays GET-only and
digit-guarded.

## Consequences

- The selection no longer spills across the boundary: the 20 parcels that only clipped
  Liabygda are gone, and the 9 that strict containment would have lost are kept.
- **Exactly one krets claims each teig** — a partition, not an overlap. Pulling two
  neighbouring kretser cannot double-count.
- **A genuinely straddling teig is not split.** It stays with whichever krets holds its point.
  The frontend draws the krets outline so those get picked up by hand.
- The result is a *derived answer, not a registry fact.* It is reproducible and defensible,
  but it is ours — not something Kartverket or SSB would confirm.
- One extra upstream call per selection (the krets lookup, ~5 KB, ~0.1 s).
- `/geo/grunnkrets-teiger` is the only `/geo` route that can honestly answer **404**: the krets
  lookup returned 200, so an empty result really is "no such nummer" and not an outage.
- A krets is 150–550 teiger, so the fetch confirms with a count before merging — and expect
  parcels from a neighbouring **kommune**, since a krets boundary does not stop at one.

## Data gaps to revisit if we get Matrikkel access

The app is deliberately public-data-only today. The real MatrikkelAPI needs applied-for
credentials. These are the places where that would change the answer rather than just speed it
up — check them before assuming this ADR still holds:

- **Kretstilhørighet.** Matrikkelen is understood to carry krets membership per matrikkelenhet.
  If it does, it replaces this entire decision: an authoritative assignment instead of a
  geometric derivation, and the straddling-teig question stops being ours to answer. **Verify
  this first** — it is the single thing that would obsolete the rule above. Note this covers
  more than grunnkrets: **sokn** is one of Matrikkelen's krets types, and there is no public
  service for soknegrenser at all, so the Matrikkel-geoserveren is the only route to it.
- **Existence of a matrikkelenhet.** No open API confirms one exists; the eiendom API is
  geometry-driven, so a Teig WFS hit proves "occupied" and a miss proves nothing. This is why
  the komreg move check's matrikkel half is `warning`/`info` and never `error` (see
  `frontend/src/checks/validate.ts`). Real access would make that half authoritative.
- **Teiger with no matrikkelnummer** ("Mnr mangler" / "Mnr vann mangler" — 35 of Liabygda's
  537). We can carry them as `teig` rows but cannot resolve them any further from public data.
- **Addresses have no krets field**, so address-driven selection is impossible today even
  though it would be a natural cross-check on the geometric result.

## Fit with the stack

Worth recording because it nearly didn't fit. The whole spatial computation is pushed into the
WFS, which means **we carry no geometry library on either side** — Kotlin proxies and lifts
one XML element, OpenLayers draws the outline, and nothing computes an intersection. That is
the only reason this feature is small.

What would break that: splitting a straddling teig, or ranking parcels by how much of their
area lies inside, both need real polygon boolean ops — JTS server-side or turf/polygon-clipping
in the browser. Neither is here, and adding one is a real decision, not a detail. If a future
requirement needs overlap *fractions* rather than a yes/no assignment, that is the moment to
reopen this.

## Alternatives rejected

- **BBOX plus client-side filtering** — over-fetches (262 vs 156 on the urban test) and needs
  a polygon predicate in the browser to do worse what the WFS does exactly.
- **Address-driven selection** — no grunnkrets field in the address API, and it would miss
  undeveloped parcels regardless.
- **Simplifying the ring** to fit a GET — changes boundary semantics to save a POST.

## Notes

Two upstream shape traps found while building this, both about teiger with no matrikkelnummer
— which komreg needs as `teig` rows alongside veg/vegadresse/matrikkelenhet, so neither is
cosmetic:

- The Teig WFS writes `gardsnummer` **0** where the eiendom API leaves it null. Everything
  downstream keys off null, so it is normalised in `toTeigProps` — the one choke point every
  teig passes through, from any source. Don't move it into the parsers.
- `matrikkelnummerTekst` hangs on the **teig**, not on the matrikkelenhet. Reading it off the
  latter yields null and turns every "Mnr (vann) mangler" parcel into a bare "Registrert".
