---
id: x00066
title: "Unified CLI flag parser — single source of truth, no manual `args.indexOf`"
kind: refactor
status: done
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - a00018
shippedIn:
  - 0d765bb
last-transition-id: batch-close-2026-09-07
last-transition-from: ready
---

# x00066 — `parseCli(argv)` replaces every manual `args.indexOf` call

## Goal

Today the CLI has at least two different flag-parsing patterns:

1. The correct one: `readFlag(argv, "--output")` which handles both
   `--output <value>` and `--output=<value>`.
2. The brittle one: `args.indexOf("--output")` followed by hand-coded
   value extraction.

The second pattern appears in
[`generate.script.ts`](../../../packages/cli/commands/generate.script.ts#L172-L230)
for `--output`, `--basename`, `--framework`, `--framework-search-root`,
`--format`, `--envs`, etc. This means:

- `--output=/tmp/x.json` may or may not work, depending on which flag.
- A user-reported bug "the CLI doesn't accept `--basename=foo`"
  becomes "which flag did you use?".

## Why (audit 2026-09-06 §9 — P2)

- The fix is mechanical: one helper, every command consumes it.
- The behaviour is already defined in `readFlag()`; this slice just
  removes the manual `indexOf` calls.

## Approach

### S1 — `parseCli(argv, schema)` helper

**Files**:

- `packages/core/helpers/cli-schema.helper.ts` (new) — exports
  `parseCli<T>(argv: ReadonlyArray<string>, schema: CliSchema<T>):
  { values: T; errors: string[]; help: string }`.
- `packages/core/helpers/cli-schema.helper.spec.ts` (new) — ≥10 tests
  covering value/equals/repeatable/enum/default/unknown/help generation.

**Gate**: `bun run test:core` green.

### S2 — Migrate `generate.script.ts`

Replace the manual `indexOf` block with `parseCli(argv, GENERATE_SCHEMA)`.
Add 3 tests in `tests/cli/generate-flag-parsing.spec.ts`:
1. `--output=value` is honoured.
2. Unknown flags surface as warnings (not errors) so legacy scripts
   don't break.
3. `parseCli` produces the same `--help` text as today's hand-written
   help block.

**Gate**: `bun run test:cli` green; `bun run test:e2e` green.

### S3 — Migrate the rest

Apply the same refactor to `summary.script.ts`, `validate-json.script.ts`,
`stats.script.ts`, `diff.script.ts`, `list-endpoints.script.ts`,
`open-postman.script.ts`, `init.script.ts`. One PR per file; each
keeps its existing `--help` text identical (snapshotted in tests).

**Gate**: `bun run test:cli` green; `bun run validate` green.

## Acceptance

- `grep -rn "args.indexOf(\"--" packages/cli/` returns 0 hits in
  production code (tests exempt).
- Every CLI flag accepts both `--flag value` and `--flag=value`.
- Every CLI command produces identical `--help` output before and
  after the refactor (snapshot test).

## Out of scope

- A new `commander`/`yargs` dependency. The `parseCli` helper is a
  thin typed wrapper over the existing `readFlag`; adding a dependency
  is not justified for the gain.