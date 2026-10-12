# 2. The parameterfil is the only output

Status: accepted

## Context

The app carried two output formats: the JSON parameterfil that komreg-backend actually ingests,
and an arbeidsliste CSV left over from the `komreg-parameterfil` tool this replaced. Only one of
them was real. The CSV was described as "a work-list for people, not an input to anything" —
true, and the reason it kept a whole derivation path alive (`toCsv`, a CSV-injection escaper, and
three `domain.ts` helpers that existed for nothing else) for an output no system reads.

Separately, `save` had grown two implementations — one on the map, one in the arbeidsliste header
— each with its own "Lagre som ny".

## Decision

**The JSON parameterfil is the app's only output.** CSV is deleted, not deprecated.

**A thing should be doable in exactly one place.** Navigating to it from several places is fine
— two links to the regulering are signposts. Two save buttons are not: that's two
implementations to keep honest. `SessionBar` now reads the store and owns the save mutation
itself, so every screen renders the same propless component.

## Consequences

- **Kommentarer are write-only.** They are still edited on the arbeidsliste and stored in the
  saved blob, but nothing carries them out of the app any more. Accepted: they are notes for a
  person, and komreg-backend's format has no field for them. **If a second output format ever
  appears, this is the first thing to reconsider** — the data is there, it just has no exit.
- Saving can't drift between two code paths.
- No save-as-copy anywhere: which list you are on changes at the top level only. If duplicating
  a list is ever wanted, it belongs on the landing screen as list management, not as a fifth
  button mid-session.

## Not recorded here

Which screen owns which panel, and how the routes nest, changed at the same time. That is layout
— it is written where it applies (`frontend/src/routes/`, `frontend/AGENTS.md`) and is cheap to change
again, so it does not need a decision record. The rule above is what outlives the arrangement.
