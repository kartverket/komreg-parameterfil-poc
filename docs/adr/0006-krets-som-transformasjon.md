# 6. Should a grensejustering move the krets itself?

Status: **open — the question is raised and the evidence gathered, but it is
not ours to decide.** Qualifies an earlier scope note's "do not wire it up", which is narrower
than it reads. That note is not part of this repo; the passage it turns on is quoted below.

Paths under `../../docs/systems/` and the `regulering-format.md` line references point at the
team's documentation in `kartverket/smia-docs`, which lives outside this repo.

> **Update: the question is no longer hypothetical.** All three 1.1.2027 sakene are now
> known, and **one of them moves a whole grunnkrets** — Stranda → Fjord. The other two move part
> of a krets, which the format cannot express as a krets transformasjon at all. See
> [Also recorded](#also-recorded-while-we-were-in-here) for the three sakene and their shapes.
> This moves the second "Revisit when" bullet from a conditional to a live one.

## Context

The question that started this: *for the 2027 run we are moving grunnkretser — don't we need a
krets parameter in the client and in the parameterfil?*

The earlier scope note answered "no" flatly:

> **"Flytt grunnkrets" is the selection flow, not a transformasjon type.** … `ReguleringBuilder`
> never constructs one. … Do not wire it up on the assumption that it is.

That is right about the *selection* flow and right that a K3 does not **require** a krets
transformasjon. It does not address a different question that nobody had asked yet: whether the
krets **entity** should be renumbered into its new kommune. Those are not the same question, and
the evidence below says the second one is real.

**Nothing was built.** This ADR is the note, not the change.

## What we found

### 1. komreg-backend supports moving a krets, fully, and has since 2023

Not half-built, not stubbed, not TODO'd:

| | |
|---|---|
| `server/.../routes/Regulering.kt:269-276` | `KretsTransformasjonDTO` — `fylkesnummer`, `kommuneløpenummer`, `kretsnummer`, `kretstype`, all `FraTil` (1:1, no splitting) |
| `routes/Regulering.kt:88-111` | `toReguleringsinput()` builds a `Kretsendring`; `kretsnummer` is parsed `.toLong()` |
| `transformation/.../Transformer.kt:203, 405-422` | `mapKretsendring` → `IdentTransformer.Mapping.Simple` over `identTypeOf4<Fylkesnummer, Lopenummer, Kretstype, Kretsnummer>()` |
| `transformation/src/test/.../TransformerKretsTest.kt:113-195` | a test named **«Grensejuster en hel krets»**, asserting fylke 12→13, løpenummer 34→24, kretsnummer 2→10 |

The other side has a *named, tested grensejustering-of-a-whole-krets path.* Whatever we conclude,
it is not that the capability is missing.

### 2. Our side mirrors the DTO and never constructs it

`ReguleringDto.kt:86` declares `KretsTransformasjonDTO`; `GYLDIGE_TYPER` at
`ReguleringBuilder.kt:217` is `setOf("matrikkelenhet", "teig", "veg", "vegadresse")`, so a row of
type `krets` is rejected as *ukjent type*. The only executable reference is the exhaustive-`when`
counting branch at `ReguleringService.kt:30`, which is unreachable.

### 3. The documented K3 recipe has no krets in it

`../../docs/systems/komreg/regulering-format.md:321` makes a krets transformasjon **required only
for kommunedeling** (`KOMMUNEDELING_MANGLER_KRETSER`), and no kommunedeling is planned —
`grensejusteringer.md:141` notes there has been no publicly decided one in modern Norwegian
history. `grensejusteringer.md:148-160` lists what a K3 moves: "matrikkelenheter, teiger, og
eventuelt veger og vegadresser". No krets.

But the same document, three paragraphs earlier (`:56-60`), says the opposite is *also* true at
kommune level:

> **Konsekvensen er kaskaderende.** … arver alt under det nye prefikset automatisk:
> matrikkelenheter, teiger, veger, vegadresser, **kretser**, bygninger.

A pure K3 has no `kommune` transformasjon to cascade from — which is exactly why the two
statements do not settle the case between them.

### 4. The measurement: in 2025 a whole grunnkrets moved, and it was *not* renumbered

This is the finding that makes the question real rather than theoretical.

`regulering_2025.json` ("Årskiftet 24/25", 2025-01-01) is **4201 Risør → 4213 Tvedestrand**,
fylke 42 both sides. `../../docs/systems/komreg/planlegging/poc-komreg-klient.md:35-38` describes
it as the run where "**siden en hel grunnkrets ble flyttet**, var det mulig å hente ut alt som
trengtes via geometriske SQL-spørringer".

Its payload contains `matrikkelenhet` ×7, `teig` ×23, `veg` ×1, `vegadresse` ×52 — and **zero**
`krets` transformasjoner. So do all four other reference payloads, the prod-run
`komreg_payload.json` included.

The post-run check (`../../docs/systems/komreg/arkiv/validering.md:40-44`) then says:

> select 'Fant grunnkrets i Tvedestrand: ' … from krets k, **kommunerforkrets** f where
> f.kommuneid = 4213 … and k.class='Grunnkrets' and **k.kretsnr=305**
>
> Selecten kan også kjøres etter at komreg er kjørt. Da skal den finne **105 rader (en
> grunnkrets, en veg og 103 matrikkelenheter).**

Read it carefully: after the run, grunnkrets **305 is still numbered 305**, and it is reachable
from Tvedestrand through the `kommunerforkrets` **join table**. It did not move. It **spread** —
it now hangs off both kommuner.

That is coherent with the model rather than a bug: `kapabiliteter.md:174` records that
"KretsSource uses `associatedIdents` because **one krets can span multiple kommuner**". A krets is
allowed to belong to several. So doing nothing produces a krets spanning two kommuner, and sending
a `krets` transformasjon produces one renumbered into the target.

Both are reachable. Nothing in either repo says which is *correct*.

## The open question

> When a grensejustering moves an entire grunnkrets from kommune A to kommune B, should the krets
> be renumbered into B (an explicit `krets` transformasjon), or is "the krets now spans A and B"
> the intended end state?

Sub-questions that have to go with it, because the answer is worthless without them:

- **Was the 2025 outcome intended, or an accepted gap nobody looked at?** The validation SQL
  *predicts* 105 rows including the grunnkrets, so someone expected it. Expected is not the same
  as wanted.
- **Who allocates the new kretsnummer in the target kommune?** A krets move is 1:1 and needs a
  free number on the other side — the same collision problem as gårdsnummer, but we have no
  source for existing kretsnummer in a kommune, so it cannot be defaulted or checked.
- **Does NIBAS have to agree?** `../../docs/systems/nibas/README.md:3` makes NIBAS the master of
  administrative inndelinger, grunnkretser included. If grunnkrets numbering is mastered there,
  komreg renumbering one may be the wrong half of the system to do it in.
- **Only whole kretser, or partial ones too?** A boundary that cuts *through* a krets moves some
  of its teiger and leaves the rest. A `krets` transformasjon is 1:1 with no splitting, so it
  cannot express that case at all — and that case is the common one. **In 2027 it is two of the
  three sakene**, so the answer only has to cover Stranda → Fjord. Worth keeping the two apart:
  the partial case is not an open question, it is closed by the format. Only the whole-krets case
  is undecided.

**Why this ADR does not answer it:** nothing in these three repos can. It is a Matrikkelen/komreg
domain decision, and the honest position is that the tool can do either and the question belongs
to the people who own the register.

## What the scope note got right, and where it stops

Kept, unchanged:

- Clicking a grunnkrets is a **selection** mechanism (`ADR-0001`), and the teiger it selects move
  as ordinary rows. That is not a krets transformasjon and never was.
- A K3 does not **require** a krets transformasjon. The validator never asks for one outside a
  kommunedeling, and the 2027 run will pass validation without one.
- `KretsTransformasjonDTO` is not half-finished work left lying around.

Qualified:

- "Do not wire it up" was written against the reading *"someone will mistake the mirrored DTO for
  unfinished grunnkrets-selection support"*. That warning stands. It should not be read as *"a
  krets transformasjon is never wanted"* — the question above is a real one, and the note did
  not have `TransformerKretsTest` or the 2025 post-run state in view when it was written.

## If the answer turns out to be yes

Recorded so the work does not have to be re-derived. Measured at roughly a day, mostly UI.

- **Backend** (`regulering/`): `RadDTO` gains `kretsnummer` / `nyKretsnummer` / `kretstype`;
  `GYLDIGE_TYPER` gains `"krets"`; `byggTransformasjoner` appends a `KretsTransformasjonDTO`
  **last, after vegadresse** — the emission order mirrors the prod payload, so appending keeps a
  regulering *without* kretsendringer byte-identical to the reference files; `validerRader` needs
  kretsnummer+kretstype as required fields and a `toLongOrNull()` guard (komreg-backend parses
  `.toLong()` only at `GET /run`, so a bad value is a 500 mid-kjøring, not an error while building
  the file); `kildeIdent`/`målIdent` need krets entries, keyed on **kretstype+kretsnummer** — the
  same number can exist as both Grunnkrets and Kirkesokn in one kommune.
- **`ReguleringKontraktTest`** has no `BKrets` in its independent copy of komreg-backend's DTOs.
  Adding one is not optional: that test is the only thing that catches a field name drifting from
  the other side.
- **Frontend**: a krets is not derived from a teig, so it is a second row source alongside
  `buildKomregRows` — plus a panel to enter the target kretsnummer, and a manual add, since
  sokn/skolekrets/stemmekrets have no usable map layer.
- **It must be opt-in.** A grunnkrets pick that silently started emitting a krets transformasjon
  would change the output of every existing saved list and break the byte-for-byte diff against
  `komreg_payload.json` that `ReguleringBuilder` was verified with.
- **`kretstype` is 1:1** — `regulering-format.md:147` says "alt 1:1, inkludert kretstype", and the
  example keeps it unchanged. Moving a krets and reclassifying one are different operations.
- **The number to send is not the one on screen.** The WFS gives an 8-digit `grunnkretsnummer` =
  kommunenummer(4) + kretsnummer(4) (`GeoRoutes.kt:72`). komreg wants the krets's own number as a
  `Long`: `"42010305"` → kommune `4201`, kretsnummer `305` — which is exactly the `k.kretsnr=305`
  the 2025 validation SQL checks.

## Data gaps to revisit if we get Matrikkel access

- **Existing kretsnummer per kommune.** No open source lists them, so a target kretsnummer cannot
  be defaulted, collision-checked, or validated — it would be hand-entered and unverified. This is
  the single thing that most limits how good a krets move can be made here.
- **Kretstilhørighet per matrikkelenhet.** Already `ADR-0001`'s first data gap. If Matrikkelen
  carries it, krets membership stops being our geometric derivation, and the "does this teig's
  krets move with it" question gets an authoritative answer instead of a computed one.
- **Sokn and skolekrets have no public geometry at all**, so those kretstyper can only ever be
  entered by hand from this codebase.

## Also recorded while we were in here

- **2027 is three grensejusteringer, and all three are now known.** They are listed in
  regjeringen.no's factbox on
  [justeringer av kommunegrenser](https://www.regjeringen.no/no/tema/kommuner-og-regioner/kommunestruktur/Verktoy/justeringer-av-kommunegrenser/id2571217/),
  which supersedes `grensejusteringer.md:205` ("antall og hvilke kommuner ikke fastsatt enda") and
  the "de to andre justeringene" hedge in `planlegging/poc-komreg-klient.md:107-111`:

  | saken | kommunepar | krets-form |
  |---|---|---|
  | Ullensaker → Eidsvoll | `3209` → `3240`, within fylke 32 | part of a grunnkrets |
  | Nærøysund → Bindal | `5060` → `1811`, **50→18, the K3-over-fylkegrense variant** | part of a grunnkrets |
  | Stranda → Fjord | `1525` → `1578`, within fylke 15 | **a whole grunnkrets** |

  The krets-forms are domain knowledge recorded here, not read off a document — no file
  in either repo states them, which is why this ADR was written with the whole-krets case as a
  hypothetical. Two consequences: the two partial cases need nothing new (the format has no
  splitting form for a krets, so they can only ever be ordinary rader), and **Stranda → Fjord is
  the one that needs the decision above**. Note it is also the saken with no reference payload and
  no mention anywhere in either repo — `vibes/README.md:16-21` generated the other two, and
  `poc-komreg-klient.md:107` compared Ullensaker→Eidsvoll against a hand-made prod file. Nobody has
  looked at this one yet.

  Also worth knowing while reading the old generator: the labels in
  `vibes/grensejustering/GenerateGrensejusteringPayload.kt:40-54` and `vibes/README.md:21` have the
  Nærøysund/Bindal names and fylker **swapped** (`fraKommune = "60" // Bindal`). The *numbers* are
  right and match `ReguleringKontraktTest` (5060 → 1811); the comments are not.

  Anything built here should stay generic over N kommunepar, which the export already is.
- **A pure K3 passes komreg-backend's validator with no checks at all**
  (`regulering-format.md:342-344`, and flagged as a risk in
  `planlegging/forberedelse-2027.md:174-193`). `ReguleringBuilder.validerRader` is the only
  structural check that exists for the 2027 payloads. Worth remembering before trusting a green
  run.

## Revisit when

- **Someone who owns the register answers the question above.** That is the blocker; everything
  else here is ready.
- **Before the Stranda → Fjord payload is built.** This is no longer conditional: a whole
  grunnkrets *is* in the 2027 set, so the question has to be settled before that run, not after —
  a krets left spanning two kommuner is much harder to fix afterwards than to get right up front.
  The other two sakene can proceed regardless; nothing about them depends on the answer.
- **MatrikkelAPI access lands.** Reopens the data gaps above, and makes a target-kretsnummer
  collision check possible for the first time.
