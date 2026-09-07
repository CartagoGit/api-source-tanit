---
id: x00067
title: "TANIT_* env vars are canonical; POSTMAN_* kept as deprecated alias"
kind: chore
status: done
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - b00001
shippedIn:
  - befa555
last-transition-id: batch-close-2026-09-07
last-transition-from: ready
---

# x00067 — Tanit env vars: canonical `TANIT_*`, deprecated `POSTMAN_*` alias

## Goal

The product is now branded Tanit (`b00001`). The docs already use
`TANIT_PROJECT_ROOT`, `TANIT_OUTPUT_DIR`, `TANIT_CONFIG`. The code
still reads `POSTMAN_PROJECT_ROOT`, `POSTMAN_OUTPUT_DIR`,
`POSTMAN_CONFIG`, `POSTMAN_BASE_PATH`, `POSTMAN_OUTPUT_BASENAME`,
`POSTMAN_EXAMPLE`. The drift is real and visible in the CLI help
output.

## Why (audit 2026-09-06 §11 — P2)

- The audit flags this as a **UX/doco drift** plus a **semantic**
  drift: Tanit is no longer only Postman.
- The fix is a single resolver: `envOrAlias("TANIT_X", "POSTMAN_X")`,
  deprecation warning emitted once per process when the alias is read.

## Approach

### S1 — Centralized env resolver

**Files**:

- `packages/core/helpers/env-or-alias.helper.ts` (new) — exports
  `envOrAlias<T>(canonical: string, deprecated: string): T | undefined`.
- `packages/core/helpers/env-or-alias.helper.spec.ts` (new) — ≥6 tests.

### S2 — Migrate every `process.env.POSTMAN_*` read

For each of:

- `POSTMAN_PROJECT_ROOT`
- `POSTMAN_OUTPUT_DIR`
- `POSTMAN_CONFIG`
- `POSTMAN_BASE_PATH`
- `POSTMAN_OUTPUT_BASENAME`
- `POSTMAN_EXAMPLE`
- `POSTMAN_PROJECT_ROOT`

…replace with `envOrAlias("TANIT_<X>", "POSTMAN_<X>")`. Emit a
deprecation warning on first read of `POSTMAN_<X>`.

**Files**: ~7 spots in `packages/core/discovery/output-paths.helper.ts`,
`packages/core/discovery/project-loader.service.ts`,
`packages/cli/commands/generate.script.ts`,
`packages/cli/commands/init.script.ts`.

**Gate**: `bun run test:core` green; `bun run test:cli` green.

### S3 — Update constants

- `packages/contracts/constants/core/base-url.constant.ts`:
  `BASE_PATH_ENV_VAR = "TANIT_BASE_PATH"` (canonical).
- `packages/core/discovery/output-paths.helper.ts`: the constant
  `OUTPUT_BASENAME_ENV_VAR = "TANIT_OUTPUT_BASENAME"` (canonical).

**Gate**: `bun run typecheck` green; `bun run lint` green.

### S4 — Documentation

Update `docs/INSTALL.md`, `docs/POSTMAN.md` (now renamed in spirit),
`README.md` to mention `TANIT_*` as canonical and `POSTMAN_*` as the
deprecated alias with a 1-major deprecation timeline.

**Gate**: `bun run lint:docs` green.

## Acceptance

- Every CLI flag/env reference works with the new `TANIT_*` name.
- The legacy `POSTMAN_*` names still work for at least one major.
- A deprecation warning is emitted (one per process) when the alias
  is read.
- `grep -rn "process.env.POSTMAN_" packages/` returns 0 hits in
  production code (constants/helpers exempt).

## Risks

- A test that asserts on `process.env.POSTMAN_OUTPUT_BASENAME` directly
  breaks. Mitigation: the tests that need a specific env var set the
  canonical name (`TANIT_OUTPUT_BASENAME`); the alias is exercised by
  one new dedicated test.

## Out of scope

- Removing the legacy alias. That happens in a future major version
  (tracked in `b00001` follow-ups).