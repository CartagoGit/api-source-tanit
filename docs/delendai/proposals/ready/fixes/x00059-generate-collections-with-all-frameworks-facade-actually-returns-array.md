---
id: x00059
title: "`generateCollectionsWithAllFrameworks()` actually returns the array — closes the `monorepo` P1 facade bug"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - x00024
  - a00018
---

# x00059 — `generateCollectionsWithAllFrameworks()` returns the array, not the first

## Goal

Fix the broken plural facade in
[`packages/frameworks/index.ts`](../../../packages/frameworks/index.ts#L100-L120).

Today the function:

```ts
export async function generateCollectionsWithAllFrameworks(
  projectRoot: string,
  options: IGenerateOptions = {},
): Promise<ReadonlyArray<IGenerationResult>> {
  const result = await generateCollection(projectRoot, { ... });
  return Array.isArray(result) ? result.slice() : [result];
}
```

calls the **singular** `generateCollection()`, which on a multi-service
project throws `MultipleServicesWithoutCombineError` (x00024). So the
contract "ALWAYS returns `ReadonlyArray<IGenerationResult>`" is a lie.

Audit 2026-09-06 §18 priority 2 classified this as **P1**: a tool/LLM
that calls the plural facade against a monorepo gets an exception
instead of "one collection per service".

## Why

- The CLI does not yet consume it; only tests and the (private) MCP
  integration do. But the contract is **public** (exported from
  `packages/frameworks/index.ts`).
- The fix is one line: call `generateCollections()` (the plural core
  primitive) instead of `generateCollection()`. Both exist; only the
  plural one honours the contract.
- Without this fix, the upcoming `f00014` (Postman exporter emits
  inferred responses) cannot rely on `generateCollectionsWithAllFrameworks`
  to feed per-service catalogues into the new response inference flow.

## Approach

### S1 — One-line fix + tests

**Files**:

- `packages/frameworks/index.ts` — call `generateCollections()` instead
  of `generateCollection()`.
- `tests/frameworks/generate-collections-with-all-frameworks.spec.ts` (new)
  — 5 tests covering:
  1. Single-service project → returns 1-element array (legacy parity).
  2. Multi-service project with `--combine-services=false` → returns
     N-element array, one collection per service.
  3. Multi-service project with `--combine-services=true` → returns
     1-element array (the combined result, NOT N).
  4. Empty project (no matches, no legacy fallback) → returns 1-element
     array with the synthetic `unknown` service (legacy parity).
  5. Each entry in the array carries a distinct `serviceId`.

**Gate**: `bun run test:frameworks` green; `bun run typecheck` green.

### S2 — Wire the CLI to the plural facade

The CLI today still calls `generateWithAllFrameworks()` (the singular
facade). For multi-service projects it relies on `--combine-services`
to avoid the `MultipleServicesWithoutCombineError`. This is correct, but
it means every CLI run on a monorepo collapses services into one
collection. Audit 2026-09-06 §3.3 already proposed this as follow-up;
this slice ships it.

**Files**:

- `packages/cli/commands/generate.script.ts` — switch to
  `generateCollectionsWithAllFrameworks()` and write one file per entry.
- `packages/cli/commands/list-endpoints.script.ts` — same.
- `tests/cli/generate-monorepo-multi-service.spec.ts` — add 2 tests:
  1. Without `--combine-services`, the CLI writes N files
     (`<basename>-<service>.postman_collection.json`).
  2. With `--combine-services`, the CLI writes 1 file (legacy).

**Gate**: `bun run test:cli` green; `bun run test:e2e` green.

## Acceptance

- `generateCollectionsWithAllFrameworks(monorepoRoot)` returns N entries
  in a multi-service repo, no exception.
- `generateWithAllFrameworks(monorepoRoot)` keeps the legacy single-
  service / `--combine-services` contract (no regression).
- The CLI in monorepo mode (S2) writes one file per service when
  `--combine-services` is omitted; one file when present.

## Risks

- The `serviceId` of an entry in the array is the per-service id, not
  the project name. The CLI must derive the output filename from
  `result.serviceId ?? result.config.name` to avoid collisions.
- If the legacy CLI behaviour silently merges services was relied upon
  by some downstream, S2 changes that. Mitigation: S2 adds the e2e
  tests so any regression is caught early, and the change is opt-in via
  omitting `--combine-services` (the legacy flag is the default for
  existing commands).

## Out of scope

- Per-service progress bars in the CLI (orthogonal feature).
- Different output filename templates (orthogonal feature, tracked in
  `f00013-transport-generalization.md`).