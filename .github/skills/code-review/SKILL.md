---
name: code-review
description: Review a pull request in komreg-parameterfil-poc, including Dependabot updates. Use for every code review in this repository.
---

# Reviewing komreg-parameterfil-poc

The tool builds the parameterfil komreg-backend runs, and a run against `dev` can write to
Matrikkelen. The most expensive mistake here is a wrong parameterfil that still looks right.

`AGENTS.md`, `backend/AGENTS.md` and `frontend/AGENTS.md` say what must stay true. Review against
them; don't restate them.

## What to block on

- **The wire format.** `ReguleringDto.kt` must match komreg-backend exactly. A change there needs
  `ReguleringKontraktTest` and `ReguleringBuilderTest` to cover it.
- **The token.** Only `KomregClient` attaches it. Anything that makes it a client-wide default
  sends it to Geonorge.
- **Row rules.** A second copy of `buildKomregRows` or `resolveTarget`, or the two callers
  drifting apart.
- **Migrations.** An applied `V*.sql` edited instead of a new one added.
- **Error codes.** A `Kode` renamed or removed: the frontend branches on it.

## Then

- A bug fix needs a regression test that fails without the fix.
- No end-to-end tests. Don't ask for them.
- Skip formatting and anything `vp lint` or ktlint catches.

## Dependency updates

A green patch or minor update needs no comment. Look closer when the update is a major, a minor of
a `0.x` package, or CI is red.

- Read the release notes against how this repo uses the package. Say what breaks and where, or
  that nothing here touches what changed.
- Block a bump that moves only part of a set:
  - `vite-plus`, `vite` and `vitest` (the catalog in `frontend/pnpm-workspace.yaml`).
  - pnpm: `frontend/package.json`, `frontend/Dockerfile.dev`, `.github/workflows/ci.yml`.
  - Node: `frontend/Dockerfile.dev`, `ci.yml`, and the major of `@types/node`.
  - Java: `jvmToolchain`, `ci.yml` and both stages of `backend/Dockerfile`.
- CI does not build `frontend/Dockerfile.dev`. A Node or pnpm bump has to say that the image was
  built.
- Red CI: check whether `main` is red too before blaming the update.

Few comments. Each one has file, line and a concrete failing case, marked blocking or non-blocking.
