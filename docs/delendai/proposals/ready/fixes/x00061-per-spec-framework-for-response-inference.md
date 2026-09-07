---
id: x00061
title: "Per-spec framework discriminator for response inference — closes the hybrid-project dispatcher bug"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - f00012
  - x00060
---

# x00061 — `inferResponses()` uses the spec's framework, not the global winner

## Goal

Today
[`generate.script.ts`](../../../packages/cli/commands/generate.script.ts#L440-L460)
runs:

```ts
const framework = pipeline.match?.framework ?? "";
…
for (const spec of discoveredSpecs) {
  …
  const entries = inferResponses(
    spec,
    { …, framework },      // ← GLOBAL framework
  );
}
```

The dispatcher in
[`packages/core/responses/infer-responses.ts`](../../../packages/core/responses/infer-responses.ts#L98-L122)
then loops over its registered inferrers and skips every inferrer
whose `framework !== source.framework`.

In a hybrid project (NestJS + FastAPI in the same repo), the global
match is one framework (the winner). The endpoints from the other
framework get **the wrong inferrer**: an inference call against a
FastAPI endpoint when the dispatcher thinks the project is NestJS,
or vice versa.

## Why (audit 2026-09-06 second pass §10 — P1)

- The product already documents "hybrid projects are first-class" via
  `discoverAll()` / multi-service support.
- The bug is silent: a hybrid repo produces inferences that look
  plausible (no exception) but are wrong (the inferrer ignores the
  spec because its framework doesn't match).
- F00012 S4 acceptance explicitly anticipated this case by storing
  `source.framework` per-inference-call.

## Approach

### S1 — Use per-spec framework (closes the immediate bug)

**Files**:

- `packages/cli/commands/generate.script.ts` — build a
  `Map<specKey, ParsedRoute>` keyed by `${method} ${uri}` and look up
  the framework per spec:

  ```ts
  const routeByKey = new Map<string, ParsedRoute>();
  for (const r of pipeline.routes) {
    routeByKey.set(`${r.method.toUpperCase()} ${r.uri}`, r);
  }
  for (const spec of discoveredSpecs) {
    const r = routeByKey.get(`${spec.method} ${spec.uri}`);
    const framework = r?.framework ?? pipeline.match?.framework ?? "";
    …
  }
  ```
- `packages/core/responses/infer-responses.ts` — accept an optional
  override: `inferResponses(spec, source, { frameworkHint?: string })`.
  When `frameworkHint` is provided, use it; else fall back to
  `source.framework`.

**Tests**:

- `tests/core/responses/infer-responses.spec.ts` — add 3 tests:
  1. Hybrid project: NestJS + FastAPI; endpoints from both keep their
     own framework discriminator.
  2. Unknown framework (`""`) → dispatcher returns `[]` (legacy).
  3. Hint overrides `source.framework` when explicitly passed.

**Gate**: `bun run test:core` green; `bun run test:cli` green.

### S2 — Pipeline-level dispatcher (closes the structural form)

This slice moves the inference dispatch into `buildForService()` (S2 of
`x00060`) so the CLI no longer orchestrates it. After S2:

- The CLI does not import `inferResponses` or
  `ensureResponseInferrersRegistered` directly.
- The pipeline exposes a `responsesInferred` count in `IGenerationMetrics`.
- The dispatcher sees the per-spec framework through the pipeline's
  internal route-by-key map.

**Files**:

- `packages/core/discovery/generation.pipeline.ts` — see `x00060 S2`.
- `packages/cli/commands/generate.script.ts` — drop the inference block.

## Acceptance

- A hybrid project (NestJS + FastAPI, or any two registered
  inferrers) produces inferences that match each endpoint's framework.
- No global "winner" framework leaks into the dispatcher.
- Inference count is reported in `IGenerationMetrics.responsesInferred`.

## Risks

- A scanner that emits a route without `framework` (legacy
  `IRouteScanner` paths) → fall back to `pipeline.match?.framework`.
  This is the same fallback used today.
- `responsesInferred` is a new metrics field. Existing tests that count
  metrics fields break. Mitigation: the test helper already does
  `expect.objectContaining({...})`; we add the new key, no replacement.

## Out of scope

- Storing `spec.framework` on `EndpointSpec` permanently. The map is
  pipeline-local; a future slice may add the field if it proves useful
  outside inference.