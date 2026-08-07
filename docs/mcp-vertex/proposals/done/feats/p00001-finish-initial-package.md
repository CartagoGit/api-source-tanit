---
id: p00001
title: "p00001 — finish postman-exporter v0.1: polish + harden the agnostic baseline"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-07-31
related:
    - 170672e # init commit (Limpiar residuos del host inicial)
    - e4569a0 # init commit (Plugin MCP-vertex `postman-exporter` + config local)
---

## Resolution (2026-08-03)

All three slices shipped:

- **S1** — `where()` constraints + `Route::resource` / `Route::apiResource`
  expansion in `services/scanners/laravel.scanner.ts`. Closed by
  PR `2c26624` (8 new unit tests in `tests/unit/laravel-scanner.spec.ts`).
- **S2** — replaced the `generate --inspect` parse-stdout hack with
  a dedicated `summarizeProject()` helper. Closed by PR `d7f1de2`
  (5 integration tests + 8 unit tests + a new CLI script
  `scripts/summary.script.ts`).
- **S3** — vitest baseline (renamed to bun:test, same API). Closed by
  PR `c2f17dc` (88 unit tests across 7 service modules in
  `tests/unit/`).

## Notes (post-merge)

- The `bun run check` gate pulled in S1 indirectly: the new
  `where()` constraint encoding diverges routes that used to
  normalize to the same shape, so the diff script now reports
  differences that previously got silently merged.
- The `summary` tool no longer spawns a subprocess. Its `effects`
  array is `[]` (was `['spawn']`).
- The scanner registry lived in three scripts and got extracted
  into `services/scanner-registry.ts` so the proposal-shared
  `summarizeProject()` can use the same `DiscoveryOrchestrator`
  instance as the CLI.
- 188/188 tests green across 18 files.


# p00001 — finish postman-exporter v0.1: polish + harden the agnostic baseline

## Goal

Take the current `postman-exporter/` from "works in three Laravel projects"
(host de prueba A, host de prueba B, host de prueba C) to a shippable v0.1 with:

- 100% bidir coverage on every host we test (the 11 routes-with-`where()`
  delta on the host que motivó este slice).
- A clean separation between the **router-agnostic core** and the
  framework-specific **router adapters** (this proposal only ships the
  core; per-framework routers live in p00002).
- Tooling tests (vitest) covering the discovery, parser, builder,
  enricher, environment-builder, runner helper, and the plugin tools
  themselves.

## why

The current code is functional but has three categories of debt:

- **Parser drift**: 11 routes on one of the host projects resolve to
  the same `(method, uri)` key because the `where()` constraints are
  ignored. `Route::resource/apiResource` expansion isn't supported.
- **Plugin immaturity**: the MCP-vertex plugin in
  `plugins/postman-exporter/` has 3 tools but no unit tests, no
  validation that the CLI exits with code 0, and the `summary` tool
  is a hack that runs `generate --check` to parse stdout.
- **No tests anywhere**: every change is validated by running it
  against real Laravel projects. That's an e2e test, not a unit test.

## non-goals

- Per-framework routers (Symfony/Express/FastAPI/Django). Those live in
  p00002.
- New Postman features (environments beyond Local/Dev/Staging/Producción,
  OpenAPI export, etc.).
- Publishing the package to npm. That comes after the plugin tests land.

## slices

### S1 — close the parser-drift gap (where() + resource + whereAlphaNumeric)
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `services/route-parser.service.ts`.
- Add a third "normalisation tier" that captures `where('foo', '\d+')`
  constraints and appends them to the route's "shape" key (`{foo:\d+}`).
  The current `normalizeForComparison` collapses `{foo}` and `{foo:[A-Z]+}`
  to the same `:p`; the upgrade keeps them distinct when the regex
  differs.
- Expand `Route::resource('users', UserController::class)` into the 7
  RESTful routes (index/show/create/store/edit/update/destroy).
- Expand `Route::apiResource('users', UserController::class)` into the 5
  JSON-only routes (index/show/store/update/destroy).
- **Acceptance**:
  - `bun test tests/unit/route-parser.spec.ts` adds 4 cases for `where()`,
    2 for `Route::resource`, 1 for `Route::apiResource`.
  - `bun run check` against that host's workspace reports
    `routesInSource === requestsInCollection` (closing the 11-route delta).

### S2 — harden the MCP-vertex plugin (real summary + tests)
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `plugins/postman-exporter/src/lib/tools/summary.tool.ts`,
  `plugins/postman-exporter/src/index.ts`,
  `plugins/postman-exporter/tests/integration/summary.tool.spec.ts` (new).
- Replace the `summary` tool's "run generate --check" hack with a
  dedicated `scripts/summary.script.ts` that returns the same data
  without writing any artefact.
- Wire `summary` into the plugin's `register()` return.
- Add a vitest spec that runs against the included
  `examples/example-app/` fixture: the spec asserts the tool returns
  `zeroConfig: true` (no host config), `routesInCode > 0`, and the
  correct projectName.
- **Acceptance**:
  - `bun test plugins/postman-exporter/tests/` (new) is green.
  - `bun run typecheck` is green.

### S3 — vitest baseline for the package core
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**: `package.json` (add `vitest` devDep + `test` script),
  `tests/unit/*.spec.ts` (new), `vitest.config.ts` (new),
  `tsconfig.json` (add `vitest/globals` types).
- One spec per service: `route-parser`, `endpoint-discovery`,
  `collection-builder`, `catalog-enricher`, `environment-builder`,
  `param-inferrer`, `uri.helper`. Total ~30 cases.
- Tests use in-repo fixtures under `tests/fixtures/` (Laravel routes
  blocks + FormRequest snippets) instead of running against real
  workspaces — keeps CI fast and hermetic.
- **Acceptance**:
  - `bun run test` exits 0 with all specs green.
  - `bun run typecheck && bun run check && bun run test` is the new
    pre-commit gate.

## Notes

- p00002 builds on this proposal: once the agnostic core has tests,
  the per-framework routers get a tested substrate.
- The `bun run check` gate (line ~1) is the existing `validate-json`
  script + `diff.script.ts`; it stays as the integration gate. The
  vitest suite is the unit-test layer.

## acceptance

Every slice lands with its acceptance bullets green, and the new
`bun run test` is wired into `package.json#scripts.test`. CI on a
clean checkout exits 0.
