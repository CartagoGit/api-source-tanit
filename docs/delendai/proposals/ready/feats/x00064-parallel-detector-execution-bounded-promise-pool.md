---
id: x00064
title: "Parallel detector execution with bounded Promise pool"
kind: feat
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - a00018
---

# x00064 — DiscoveryOrchestrator detects in parallel (concurrency = 8)

## Goal

Today
[`DiscoveryOrchestrator.detectAll()`](../../packages/core/discovery/discovery.orchestrator.ts#L92-L142)
runs every detector **sequentially**:

```ts
for (const detector of this.registry.detectors) {
  let result: { score, evidence };
  try {
    result = await detector.detect(projectRoot);
  } catch (error) {
    result = { score: 0, evidence: [] };
  }
  …
}
```

For 25 frameworks this is fine; for 60+ (the audit's roadmap target)
it becomes the dominant cost of every project analysis, because each
detector does at least one filesystem walk + manifest read + heuristic
pass.

## Why (audit 2026-09-06 §15 — P2)

- The detectors are independent: a Laravel detector does not need
  Express's manifest to run, etc.
- Concurrency 8 is the sweet spot for `readFilesInOrder`'s measured
  16x speedup; going higher saturates disk I/O on SSDs.
- The pattern is already implemented in `core/helpers/read-files-in-
  order.helper.ts`; this slice reuses its pool.

## Approach

### S1 — Bounded pool for `detect()`

**Files**:

- `packages/core/discovery/discovery.orchestrator.ts` — replace the
  sequential `for` loop with a bounded pool of 8. Use the existing
  `runWithConcurrency()` (added by `p00033`):

```ts
const items = this.registry.detectors.map((detector) => async () => {
  try { return { detector, ...await detector.detect(projectRoot) }; }
  catch (error) { return { detector, score: 0, evidence: [] }; }
});
const detected = await runWithConcurrency(items, 8);
```

- `packages/core/helpers/read-files-in-order.helper.ts` — confirm
  `runWithConcurrency()` is exported; export it from
  `packages/core/helpers/index.ts` if not.

**Gate**: `bun run test:core` green; `bun run benchmark` shows the
expected ~6-7x speedup on the 25-detector case (worst case: ~2x if
detection is dominated by a single heavy detector).

### S2 — Same pool for `resolve()`

The `resolve()` loop is also sequential. Apply the same pool.

**Gate**: `bun run test:core` green.

### S3 — Combined with `x00065` (failedDetectors)

When `x00065` lands, the catch in `detect()` and `resolve()` populates
the new `failedDetectors` array instead of returning `score: 0`. This
slice is forward-compatible with that change.

**Gate**: `bun run test:core` green; combined S1+S2+S3 (`x00065`) tests
pass.

## Acceptance

- A 25-detector project analysis takes ~1/6 of the serial time on a
  cold cache.
- All existing detection tests pass.
- The score-sort tie-breaker (list order) is preserved: parallel
  execution may produce items in any order, so the slice sorts after
  the pool completes.

## Risks

- **Determinism**: the score sort already handles reordering; the only
  risk is `evidence` order inside the result. Mitigation: keep
  evidence list ordering intact by sorting by `(score desc, index asc)`.
- **Backpressure**: if all 25 detectors try to read the same manifest
  file at once, the FS gets hammered. Mitigation: each detector reads
  different files; only `package.json`/`composer.json`/`Cargo.toml` is
  shared. The pool is sized so the total concurrent reads stay below
  the SSD queue depth.
- **Errors**: a throwing detector used to halt the loop in non-caught
  modes. With the pool, it just produces a `score: 0` entry. Tests
  for "broken detector" already exist; they pass.

## Out of scope

- A configurable pool size (`--concurrency N`). The current default
  (8) is a measured sweet spot; making it configurable adds complexity
  for marginal value.