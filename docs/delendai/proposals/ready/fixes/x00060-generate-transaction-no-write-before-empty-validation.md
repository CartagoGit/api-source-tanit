---
id: x00060
title: "Generate is a transaction — no write before 0-endpoint validation, atomic commit"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - a00018
---

# x00060 — Generate runs as a single transaction: validate before any write

## Goal

Stop `generate.script.ts` from writing a Postman collection to disk and
then discovering (after the fact) that it had 0 endpoints.

Today:

```ts
await writeFileAtomic(OUTPUT_PATH, json + "\n");   // ← WRITES
const { requests, folders } = countItems(collection);
if (requests === 0 && !args.includes("--allow-empty")) {
  return { code: 1, report: null };               // ← VALIDATES AFTER
}
```

The audit's example is real: a project had a valid collection yesterday;
today a scanner regresses and finds 0; `generate` writes an empty
collection over the valid one; only then does it exit non-zero.

This is especially dangerous with multi-agent parallel work: any
transient regression produces a destructive write before the error.

## Why

- The atomic-write infrastructure (`writeFileAtomic`,
  `writeJsonAtomic`) is already in `core/helpers/atomic-write.helper.ts`.
- The fix is structural: re-order the pipeline to **validate first,
  build the artifact in memory, stage to a temp file, atomic rename,
  then validate the artifact after write but BEFORE any other side
  effects**.
- This makes the generation **idempotent under partial failure**: a
  scanner regression does not destroy yesterday's collection.

## Approach

### S1 — Re-order generate pipeline (no behaviour change in the happy path)

**Files**:

- `packages/cli/commands/generate.script.ts` — restructure the script:
  1. Run `runPipeline()` → in-memory result.
  2. Validate `result.metrics.routes > 0` (or `--allow-empty`).
  3. **Stage** the JSON to `${OUTPUT_PATH}.tmp.<pid>.<ts>` via
     `writeJsonAtomic()` (it already uses temp + rename).
  4. Compute the post-write checksum (`sha256(JSON.stringify(...))`)
     and verify it matches the in-memory copy (rejects partial writes).
  5. Only after step 4 succeeds, treat the write as final.
  6. **Then** run response inference and extra-format exports (these
     also use `writeJsonAtomic` so the same transaction model applies).
- `tests/cli/generate-atomic-transaction.spec.ts` (new) — 4 tests:
  1. 0 endpoints + no `--allow-empty` → exit 1, **OUTPUT_PATH does not
     exist** (file untouched from before).
  2. 0 endpoints + `--allow-empty` → exit 0, OUTPUT_PATH contains the
     empty collection.
  3. N>0 endpoints → exit 0, OUTPUT_PATH exists with the N requests.
  4. Simulated scanner regression (a deliberately-broken fixture):
     OUTPUT_PATH retains its previous content (no overwrite with
     empty).

**Gate**: `bun run test:cli` green; `bun run test:e2e` green.

### S2 — Wire response inference BEFORE the Postman write (closes the
ordering bug from audit 2026-09-06 §10)

The current order is:

```
build → write Postman → count → inferResponses → write extras
```

Postman sees no responses; extras do. Fix by moving the inference call
to the pipeline itself (between `buildCollection()` and the writers).
This is a structural change but it is exactly the same shape as the
existing inference for `bodiesInferred` / `queriesInferred`.

**Files**:

- `packages/core/discovery/generation.pipeline.ts` — add a
  `responsesInferred: number` to `IGenerationMetrics`. Run
  `inferResponses()` for each spec, attaching the result to
  `spec.responses` BEFORE returning from `buildForService()`. Use
  `spec.framework ?? route.framework ?? match.framework` as the
  dispatcher discriminator (closes the hybrid-project bug from audit
  2026-09-06 §10 — a NestJS+FastAPI repo no longer infers with the
  winner's framework).
- `packages/core/responses/infer-responses.ts` — accept an optional
  `frameworkOverride` parameter so the caller can pass
  `spec.framework ?? route.framework ?? match.framework`.
- `packages/cli/commands/generate.script.ts` — drop the post-write
  inference block entirely (it's now inside the pipeline).

**Gate**: `bun run test:core` green; `bun run test:cli` green;
`bun run test:e2e` green.

## Acceptance

- No write to `OUTPUT_PATH` happens when `requests === 0 && !--allow-empty`.
- No write to `OUTPUT_PATH` happens when a scanner throws (transactional).
- Postman collection includes `response[]` for every inferred status
  (closes audit 2026-09-06 §10 S4 Postman half when combined with
  `f00014`).
- Hybrid projects (multi-framework repo) use the per-spec framework for
  the inference dispatcher.

## Risks

- `spec.framework` is not yet on `EndpointSpec`. The cleanest path:
  derive it from the `ParsedRoute.framework` via the merge step (which
  already keys specs by `METHOD uri`). The map lives in the pipeline
  for the duration of the generation, not on the persistent `EndpointSpec`.
- Performance: response inference reads source files; this was already
  happening in `generate.script.ts`. Moving it into the pipeline does
  not change that cost. `bun run benchmark` should match ±5%.

## Out of scope

- Other CLI commands that may have the same write-before-validate bug
  (`init`, `open-postman`). Audited separately in `a00018` follow-ups.