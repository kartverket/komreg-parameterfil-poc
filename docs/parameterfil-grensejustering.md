# The parameterfil for a grensejustering

This document explains how KomReg parameterfil PoC builds the parameterfil (the "regulering
JSON"), how komreg-backend reads it, and which shape each transformasjon must have for
komreg-backend to do what we mean.

It is written for whoever is going to change `ReguleringBuilder.kt`, debug a kjøring or check a
finished file by hand.

**Sources.** Everything about komreg-backend is read from its code at commit `203e6fb`
(2026-10-05) and checked by running our files through that same code. That check is not in this
repo. What cannot be read from the public code is marked `[TO BE CLARIFIED]`.

**Scope.** The document covers the four transformasjon types a grensejustering uses. The team's
full field reference is `regulering-format.md` in `kartverket/smia-docs`. It has not been compared
with this document.

## Contents

1. [The flow from map selection to kjøring](#1-the-flow-from-map-selection-to-kjøring)
2. [The outer shape of the file](#2-the-outer-shape-of-the-file)
3. [How komreg-backend reads the file](#3-how-komreg-backend-reads-the-file)
4. [How komreg-backend picks a rule](#4-how-komreg-backend-picks-a-rule)
5. [The four transformasjoner](#5-the-four-transformasjoner)
6. [What comes along without a row of its own](#6-what-comes-along-without-a-row-of-its-own)
7. [Number limits](#7-number-limits)
8. [Who checks what](#8-who-checks-what)
9. [Checking a file](#9-checking-a-file)

## 1. The flow from map selection to kjøring

```
frontend                    backend (this one)              komreg-backend
────────                    ──────────────────              ──────────────
selected teiger
  → buildKomregRows
  → resolveTarget
  → rows ────────────────►  POST /regulering
                            ReguleringBuilder
                            → JSON (the parameterfil) ───►  POST /reguleringer   stores
                                                            GET  /run/{regId}    runs
```

1. The frontend turns the selected teiger into **rows**: one row per thing to be moved, with the
   current values and the new values. That happens in `frontend/src/domain/komreg.ts`.
2. Our backend turns the rows into the parameterfil. That happens in
   `backend/server/src/main/kotlin/no/komreg/regulering/ReguleringBuilder.kt`, which is the only place
   that knows komreg-backend's format.
3. komreg-backend stores the file when it receives it on `POST /reguleringer`, and only runs it
   when someone calls `GET /run/{regId}`.

The rows are grouped by kommunepar. Each pair (source → target) becomes one `endring` in the
file. A regulering with three grensejusteringer therefore gives three endringer in the combined
file, plus one file of its own per kommunepar.

## 2. The outer shape of the file

```json
{
  "id": "komreg2027-b48ac2",
  "navn": "KomReg2027",
  "dato": "2027-01-01",
  "endringer": [
    {
      "id": "5060-1811",
      "navn": "Grensejustering 5060 → 1811",
      "type": "kommune",
      "utgåendeFylker": [],
      "utgåendeKommuner": [],
      "nyeFylker": [],
      "nyeKommuner": [],
      "transformasjoner": []
    }
  ]
}
```

### Regulering

| Field       | Type         | Meaning                                                                                              |
| ----------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `id`        | text         | Primary key in komreg-backend's `regulering` table. An id that already exists gives an error on save. |
| `navn`      | text         | Display name.                                                                                        |
| `dato`      | `YYYY-MM-DD` | The ikrafttredelsesdato. It is stored in its own column and passed on to the registers when the kjøring writes. |
| `endringer` | list         | One per kommunepar.                                                                                  |

`dato` is not the date the file was made. A test run can carry today's date, but the real file
for 2027 must have `2027-01-01`.

### Endring

| Field                                                            | Value in a grensejustering          |
| ---------------------------------------------------------------- | ----------------------------------- |
| `id`                                                             | `<fra>-<til>`, for example `5060-1811` |
| `navn`                                                           | `Grensejustering <fra> → <til>`     |
| `type`                                                           | `"kommune"`                         |
| `utgåendeFylker`, `utgåendeKommuner`, `nyeFylker`, `nyeKommuner` | Always empty lists                  |
| `transformasjoner`                                               | The rows, see chapter 5             |

The four lists **must be in the file even though they are empty**. `EndringDTO` in komreg-backend
has no default values, so a missing field makes the whole file be rejected.

A grensejustering creates no kommune and closes none. Both kommuner remain, which is why the
lists are empty and the file has no `kommune` or `fylke` transformasjon.

### A kommunenummer is split in two

komreg-backend never uses the four-digit kommunenummer. It is split into fylkesnummer (the first
two digits) and kommuneløpenummer (the last two):

| Kommune         | `fylkesnummer` | `kommuneløpenummer` |
| --------------- | -------------- | ------------------- |
| 5060 Bindal     | `"50"`         | `"60"`              |
| 1811 Nærøysund  | `"18"`         | `"11"`              |
| 3209 Ullensaker | `"32"`         | `"09"`              |

A change of fylke and a change of kommune are therefore two different fields. It is easy to
change one and forget the other, see [5.2](#52-matrikkelenhet-a-single-bruksnummer).

## 3. How komreg-backend reads the file

### Saving: `POST /reguleringer`

komreg-backend decodes the file with a default kotlinx `Json` with no settings of its own
(`routes/ReguleringRoutes.kt`). That means:

- **Unknown keys are rejected.** An extra field gives an error.
- **Missing fields are rejected**, except the few that have a default value (`bruksnummer` in a
  matrikkelenhet and the fields inside it).
- **The wrong shape is rejected.** A text where there should be a list gives an error.

Every error on save gives the same answer: `500 Failed to save Regulering.` The answer does not
say what was wrong. The cause is only in komreg-backend's log.

On save **only the shape** is checked. The values inside `fra` and `til` are text and are not
interpreted yet, with one exception: the keys in `bruksnummer` must be numbers that fit in a
`Short`.

### Running: `GET /run/{regId}`

Only when the kjøring starts does the rest happen:

1. `ReguleringValidator` checks the regulering. It has rules for splitting a fylke, a kommune and
   a veg, and **no rules for a pure grensejustering**. A grensejustering passes unchecked.
2. `toReguleringsinput()` turns the text values into numbers. A value that is not a number, or
   that is too large, fails here, see [chapter 7](#7-number-limits).
3. `mapInput` turns each transformasjon into one or more **rules**.
4. `IdentTransformer` applies the rules to every entity in the registers.

So a file can be saved without error and still fail when it is run.

## 4. How komreg-backend picks a rule

This chapter is the key to understanding why the transformasjoner must look the way they do.

### Idents

Everything komreg-backend moves has an **ident**: a sequence of components that points out the
entity. The shapes below are the ones komreg-backend uses in its own tests (`TestIdentTypes.kt`):

| Entity               | Ident                                                                   |
| -------------------- | ----------------------------------------------------------------------- |
| Gårdsnummerserie     | fylke, kommuneløpenummer, gnr                                           |
| Matrikkelenhet       | fylke, kommuneløpenummer, gnr, bnr, festenummer, seksjonsnummer         |
| Teig                 | fylke, kommuneløpenummer, gnr, bnr, festenummer, seksjonsnummer, teigId |
| Veg (adresseparsell) | fylke, kommuneløpenummer, adressekode                                   |
| Vegadresse           | fylke, kommuneløpenummer, adressekode, adressenummer                    |
| Bygning              | fylke, kommuneløpenummer, bygningsnummer                                |

A teig without a matrikkelnummer has gnr 0 and bnr 0 in its ident.

### Rules

A rule has a **source** and a **target**, both written as idents. The source can be shorter than
the ident it is meant to hit. A rule with the source "fylke 50, kommune 60, gnr 153" hits every
ident that has exactly those three values, whatever else it has.

When a rule hits, only the components the rule mentions are replaced. The rest of the ident
stays.

### The most specific rule wins

For each ident, `IdentTransformer` does this:

1. Find every rule that has the same fylke and kommune in its source, and where all the
   components in the source are in the ident with the same value.
2. Keep only the rules with the most components.
3. If one rule is left, it is used.
4. If several equally specific rules are left, `RuntimeException("More than one match")` is
   thrown and the kjøring stops.
5. If no rule hits, the ident is left untouched.

Two consequences that decide how the file must be built:

- **Two rules with the same source are always an error.** That includes rules you do not know you
  have made, see [5.2](#52-matrikkelenhet-a-single-bruksnummer).
- **A more specific rule overrides a less specific one.** A rule for one bruksnummer (four
  components) wins over a rule for the whole gård (three components).

## 5. The four transformasjoner

The `type` field decides which transformasjon it is. komreg-backend also knows `fylke`, `kommune`
and `krets`. `ReguleringBuilder` never produces those three, see ADR-0006.

The order in the file is matrikkelenhet, teig, veg, vegadresse. komreg-backend does not care
about the order. It is kept fixed so that files can be compared line by line.

### 5.1 Matrikkelenhet: the whole gård

Used when every bruksnummer under a gårdsnummer is to be moved. The row has an empty
bruksnummer.

```json
{
  "type": "matrikkelenhet",
  "fylkesnummer": { "fra": "50", "til": "18" },
  "kommuneløpenummer": { "fra": "60", "til": "11" },
  "gårdsnummer": { "fra": "153", "til": "353" }
}
```

- The target is in `til` on the outer object.
- `bruksnummer` must **not be in the file at all**.
- komreg-backend makes one rule: gård 5060-153 → 1811-353. It hits the gårdsnummerserie, every
  matrikkelenhet under it and every teig that belongs to them.

`gårdsnummer.til` must be greater than 0. If it is 0, and there is no `bruksnummer`,
komreg-backend rejects the transformasjon.

### 5.2 Matrikkelenhet: a single bruksnummer

Used when only some bruksnummer under a gård are to be moved. There is one transformasjon per
bruksnummer.

```json
{
  "type": "matrikkelenhet",
  "fylkesnummer": { "fra": "50", "til": "50" },
  "kommuneløpenummer": { "fra": "60", "til": "60" },
  "gårdsnummer": { "fra": "90", "til": "90" },
  "bruksnummer": {
    "4": {
      "fylkesnummer": 18,
      "kommunelopenummer": 11,
      "gardsnummer": 290,
      "bruksnummer": 4
    }
  }
}
```

Here the shape is the reverse of [5.1](#51-matrikkelenhet-the-whole-gård), and that is on
purpose:

- **The whole outer object has `fra` equal to `til`**, for fylke, kommune and gårdsnummer. That
  means "the gård stays where it is".
- **The whole target is in the nested object**: new fylke, new kommune, new gårdsnummer and new
  bruksnummer.
- The key (`"4"`) is the bruksnummer today.

komreg-backend then makes one rule: 5060-90/4 → 1811-290/4. Every other bruksnummer under gård 90
hits no rule and stays in Bindal.

#### Why the outer object must be left untouched

`mapMatrikkelenhetendring` in komreg-backend compares the outer `fra` with the outer `til`. Only
when **all three** components are equal does it skip the rule for the gård itself. If one of them
differs, it makes a rule for the gård in addition to the rule for the bruksnummer.

That gives two errors at once when several bruksnummer on the same gård are moved:

1. The gård gets a target nobody asked for. With the outer fylke `50 → 18` and kommune `60 → 60`
   the target became 1860-90, which is Vestvågøy.
2. Every row makes the same rule for the gård again. Every other bruksnummer under the gård then
   hits several equally specific rules, and the kjøring stops with `More than one match`.

An earlier version of `ReguleringBuilder` had this bug. It was invisible inside one fylke,
because the outer fylke is then equal on both sides anyway. The two files that have been run in
prod both moved inside one fylke.

#### The fields in the nested object

| Field               | Type   | Note                                                              |
| ------------------- | ------ | ----------------------------------------------------------------- |
| `fylkesnummer`      | number | A field left out inherits the outer `til`. The builder always sets it. |
| `kommunelopenummer` | number | Without ø.                                                        |
| `gardsnummer`       | number | Without å.                                                        |
| `bruksnummer`       | number | Required.                                                         |

Two things set this object apart from the rest of the file:

- **The field names lack ø and å.** The outer field is called `kommuneløpenummer`, the inner one
  `kommunelopenummer`. That is how komreg-backend has named them.
- **The values are numbers, not text.** Everything inside `fra` and `til` is text in quotation
  marks.

#### Do not mix the two shapes on the same gård

A gård cannot both be moved as a whole and have single bruksnummer listed. The two shapes give
conflicting rules. `ReguleringBuilder` rejects it with an error message before the file is made.

### 5.3 Teig

Used **only for teiger without a matrikkelnummer**. A teig with a matrikkelnummer follows its
matrikkelenhet, see [chapter 6](#6-what-comes-along-without-a-row-of-its-own).

```json
{
  "type": "teig",
  "fylkesnummer": { "fra": "50", "til": "18" },
  "kommuneløpenummer": { "fra": "60", "til": "11" },
  "teigId": { "fra": "155336128", "til": "155336128" }
}
```

- `teigId` is the same before and after. Only which kommune it belongs to changes.
- komreg-backend makes one rule with the source "fylke, kommune, teigId". It hits only that one
  teig.

### 5.4 Veg: the whole veg

Used when a whole adressekode is to be moved, with every address on it.

```json
{
  "type": "veg",
  "fylkesnummer": { "fra": "50", "til": ["18"] },
  "kommuneløpenummer": { "fra": "60", "til": ["11"] },
  "adressekode": { "fra": "51501", "til": ["1053"] }
}
```

- **`til` is a list**, also when it has only one element. In the three other transformasjoner
  `til` is a single text. A text here makes the file be rejected on save.
- `adressekode.til` is the adressekode the veg gets in the target kommune. It equals `fra` when
  the veg keeps its code.
- komreg-backend makes one rule with the source "fylke, kommune, adressekode". It hits the veg
  and every vegadresse with that adressekode.
- A veg cannot be moved to a `(kommune, adressekode)` that already exists. Pick a free
  adressekode for the whole veg. When the target kommune already has the right veg, the relevant
  addresses are moved one by one with `vegadresse` rows to the existing code. The parameter
  format cannot express deleting the existing veg.

The list form exists because komreg-backend can split a veg between several kommuner. Then
`kommuneløpenummer.til` has several elements, and `ReguleringValidator` requires vegadresse rows
that say where each address goes. `ReguleringBuilder` never produces such a split.

### 5.5 Vegadresse

Used when single addresses are to be moved and the veg is not moved as a whole.

```json
{
  "type": "vegadresse",
  "fylkesnummer": { "fra": "50", "til": "18" },
  "kommuneløpenummer": { "fra": "60", "til": "11" },
  "adressekode": { "fra": "51505", "til": "51505" },
  "adressenummer": { "fra": "3045", "til": "3045" }
}
```

- `til` is a single text, not a list.
- komreg-backend makes one rule with four components. It hits only that one address, and it wins
  over a veg rule for the same adressekode.

A vegadresse row alone moves the address, but **not the veg**. It is therefore used when the
address is to be attached to a veg that already exists in the target kommune. The address can
keep its adressekode, but the adressenummer must be free on the target veg.

### Overview

| Transformasjon                      | Shape of `til` | Where the target is  | Rule in komreg-backend            |
| ----------------------------------- | -------------- | -------------------- | --------------------------------- |
| Matrikkelenhet, the whole gård      | text           | outer object         | gård → gård                       |
| Matrikkelenhet, a single bruksnummer | text          | nested `bruksnummer` | one bruksnummer → one bruksnummer |
| Teig                                | text           | outer object         | one teig                          |
| Veg                                 | **list**       | outer object         | the veg and every address on it   |
| Vegadresse                          | text           | outer object         | one address                       |

## 6. What comes along without a row of its own

A rule hits every ident that contains the components in its source. So one row often moves more
than it mentions.

| Row                  | Comes along automatically                                              |
| -------------------- | ---------------------------------------------------------------------- |
| The whole gård       | The gårdsnummerserie, every matrikkelenhet and every teig under the gård |
| A single bruksnummer | The matrikkelenhet and the teiger that have that gnr/bnr in their ident |
| Veg                  | Every vegadresse with the adressekode                                  |

This does **not** come along, and needs a row of its own:

| What                              | Why                                                                   | Row                    |
| --------------------------------- | --------------------------------------------------------------------- | ---------------------- |
| A teig without a matrikkelnummer  | Its ident has gnr 0 and bnr 0, so no matrikkelenhet rule hits         | `teig`                 |
| A vegadresse on a moved property  | Its ident has no gnr or bnr                                           | `vegadresse` or `veg`  |

That is why `buildKomregRows` makes a `teig` row only for teiger without a matrikkelnummer, and
always makes address rows for the addresses on a selected property.

### Bygninger

A bygning does not have a gårdsnummer in its own ident. It is linked to the matrikkelenhet
through an **associated ident**. When the matrikkelenhet moves, the link is updated, but the
bygning's own ident keeps the old kommune. That is so because a grensejustering has no kommune
rule that can hit the bygning directly.

`[TO BE CLARIFIED: Does Matrikkelen set the right kommune on the bygning from the new link? That cannot be read from the public code in komreg-backend.]`

## 7. Number limits

The values in `fra` and `til` are text in the file, but komreg-backend turns them into numbers
when the kjøring starts. A value that does not fit gives an error in the middle of `GET /run`,
not when the file is saved.

| Field                        | Type in komreg-backend | Largest value |
| ---------------------------- | ---------------------- | ------------- |
| `fylkesnummer`               | `Long`                 | –             |
| `kommuneløpenummer`          | `Byte`                 | 127           |
| `gårdsnummer`                | `Int`                  | 2 147 483 647 |
| Key in `bruksnummer`         | `Short`                | 32 767        |
| `bruksnummer` (nested)       | `Short`                | 32 767        |
| `gardsnummer` (nested)       | `Int`                  | 2 147 483 647 |
| `kommunelopenummer` (nested) | `Byte`                 | 127           |
| `teigId`                     | `Long`                 | –             |
| `adressekode`                | `Int`                  | 2 147 483 647 |
| `adressenummer`              | `Short`                | 32 767        |

Today `ReguleringBuilder` only checks the new gårdsnummer and the new bruksnummer in
single-bruksnummer rows. The other fields are not checked before the file is made. The values
fetched from the registers are numbers. The risk is in new values a person types in: a new
adressekode, a new adressenummer and a new gårdsnummer for a whole gård.

## 8. Who checks what

| Check                                                                  | Where                                       | When                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| The move targets exist and are free (best effort)                      | `frontend/src/checks/validate.ts`, "Sjekk verdier" | On request, and as a mandatory fresh check before the file is generated or sent |
| The list matches Matrikkelen today                                     | `frontend/src/checks/matrikkelsjekk.ts`     | On request, and as a warning before sending                                   |
| Required fields, four-digit kommunenummer, new kommune differs from the current one | `ReguleringBuilder.validerRader` | When the file is made                                                       |
| The same source or the same target on two rows                         | `ReguleringBuilder.finnDuplikater`          | When the file is made                                                         |
| The whole gård and a single bruksnummer on the same gård               | `ReguleringBuilder.finnMotstridendeGnr`     | When the file is made                                                         |
| komreg-backend can decode the file                                     | `ReguleringKontraktTest`                    | In the tests                                                                  |
| The shape of the JSON                                                  | komreg-backend, `POST /reguleringer`        | On save                                                                       |
| Splitting of fylke, kommune and veg                                    | komreg-backend, `ReguleringValidator`       | On run                                                                        |
| That two rules do not hit the same ident                               | komreg-backend, `IdentTransformer`          | During the kjøring                                                            |

For a grensejustering komreg-backend has no check of the content of its own. What we do not
catch before the file is sent first shows up as an error during the kjøring.

## 9. Checking a file

Go through these points in a finished file:

1. **`dato`** is the ikrafttredelsesdato, not today's date.
2. **Every endring** has the four empty lists.
3. **A single bruksnummer:** the outer object has `fra` equal to `til` for fylke, kommune and
   gårdsnummer, and the nested object has all four fields.
4. **The whole gård:** no `bruksnummer` key, and `gårdsnummer.til` is greater than 0.
5. **Veg:** `til` is a list in all three fields.
6. **No gård** is listed both as the whole gård and with single bruksnummer.
7. **No source** is listed twice: the same gnr/bnr, the same teigId, the same adressekode or the
   same adressekode and adressenummer.
8. **Vegadresser without a veg row:** the adressekode exists in the target kommune.
