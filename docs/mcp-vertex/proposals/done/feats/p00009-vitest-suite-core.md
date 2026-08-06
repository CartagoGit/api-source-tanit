---
id: p00009
title: "p00009 — exhaustive vitest suite for the package core (per service)"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-07-31
related:
    - p00001 # slice S3 is the minimum baseline; this is the full suite
    - p00008 # tests before publish
    - p00007 # the plugin tests are tracked separately
---

> **Cerrada 2026-08-06.** 38/38 módulos de `services/` y `helpers/` con tests
> directos, 977 en total. La suite corre con `bun test` en lugar de vitest, que
> es lo que el proyecto ya usaba; el objetivo de la propuesta (cobertura por
> módulo con casos felices, límite y regresión) se cumple igual.

# p00009 — exhaustive vitest suite for the package core

## Goal

Ship a hermetic vitest suite that covers every public surface of the
package core. Each service in `services/*.service.ts` and each helper
in `helpers/*.helper.ts` gets at least 6 cases:

- 2 happy paths.
- 2 edge cases (empty input, malformed input, mixed casing).
- 2 regression cases (a real bug from the git history that the test
  would have caught).

Helper functions in `helpers/*.helper.ts` get at least 4 cases. The
collection builder's pure projection (no I/O) gets at least 6.

Total target: ~80 cases across 9 spec files.

## why

The current `tests/` directory is empty. Every change is validated by
running the package against a real Laravel host. That's an
integration test, not a unit test, and it's slow + flaky.

Hermetic unit tests let:

- New contributors run the suite in <2 s.
- CI gate against unintentional regressions in the parser/builder.
- p00003 (the test plugin) wire its `bun run test` step.

## non-goals

- Plugin tests (p00007 covers those).
- E2E tests against external hosts. Covered by the `bun run check`
  script flowed by the user's own host.
- Performance benchmarks. Tracked in a future proposal.

## spec files

| Spec file | Service / helper | Cases |
| --- | --- | --- |
| `tests/unit/route-parser.service.spec.ts` | `services/route-parser.service.ts` | 8 |
| `tests/unit/uri.helper.spec.ts` | `helpers/uri.helper.ts` | 4 |
| `tests/unit/endpoint-discovery.service.spec.ts` | `services/endpoint-discovery.service.ts` | 10 |
| `tests/unit/param-inferrer.service.spec.ts` | `services/param-inferrer.service.ts` | 6 |
| `tests/unit/form-request-parser.service.spec.ts` | `services/form-request-parser.service.ts` | 10 |
| `tests/unit/collection-builder.service.spec.ts` | `services/collection-builder.service.ts` | 8 |
| `tests/unit/catalog-enricher.service.spec.ts` | `services/catalog-enricher.service.ts` | 8 |
| `tests/unit/environment-builder.service.spec.ts` | `services/environment-builder.service.ts` | 6 |
| `tests/unit/project-loader.service.spec.ts` | `services/project-loader.service.ts` | 6 |

## slices

### S1 — vitest harness + first 4 spec files
- **Status**: ready
- **Files**: `package.json` (add `vitest` + `test` script),
  `tests/setup.ts` (new), `vitest.config.ts` (new),
  `tests/fixtures/laravel-routes-basic.ts` (new),
  `tests/unit/route-parser.service.spec.ts` (new),
  `tests/unit/uri.helper.spec.ts` (new),
  `tests/unit/endpoint-discovery.service.spec.ts` (new),
  `tests/unit/param-inferrer.service.spec.ts` (new).
- **Gate**: `bun run test` exits 0 with 28+ cases.

- `vitest.config.ts` extend-config: `globals: true`, `environment: 'node'`,
  `include: ['tests/unit/**']`, `exclude: ['node_modules']`.
- `tests/setup.ts` provides a tiny `makeProjectRoot()` helper that
  builds a temp dir with fixture files (routes + FormRequest stubs).
- Each spec file uses the fixture, not a real host. Assertions are
  on the return shape of the service (no `bun run scripts/*`).
- **Acceptance**:
  - `bun run test` runs in <2 s.
  - All 28+ cases pass.

### S2 — second batch (form-request-parser + collection-builder)
- **Status**: ready
- **Files**: `tests/fixtures/laravel-formrequests.ts` (new),
  `tests/unit/form-request-parser.service.spec.ts` (new),
  `tests/unit/collection-builder.service.spec.ts` (new).
- **Gate**: `bun run test` shows 46+ cases.

- `form-request-parser.service.spec.ts` exercises the regex block
  extractor with malformed `rules()` bodies (e.g. trailing comma,
  comment-only).
- `collection-builder.service.spec.ts` exercises the folder
  grouping + the env-merging logic.
- **Acceptance**:
  - 46+ cases pass.

### S3 — third batch (catalog-enricher + environment-builder + project-loader)
- **Status**: ready
- **Files**: `tests/unit/catalog-enricher.service.spec.ts` (new),
  `tests/unit/environment-builder.service.spec.ts` (new),
  `tests/unit/project-loader.service.spec.ts` (new).
- **Gate**: `bun run test` shows 66+ cases.

- `catalog-enricher.service.spec.ts` exercises the variant generation
  + the JSON merging.
- `environment-builder.service.spec.ts` exercises the merge + the
  heuristic prefix per Variable.
- `project-loader.service.spec.ts` exercises the `findHostConfig`
  search + the `buildZeroConfig` fallback.
- **Acceptance**:
  - 66+ cases pass.
  - `bun run test && bun run typecheck && bun run check` is green.

### S4 — wire the suite into the `postman_exporter_test` tool
- **Status**: ready
- **Files**: `plugins/postman-exporter-testing/src/lib/tools/test.tool.ts`,
  `plugins/postman-exporter/testing/src/lib/helpers/steps.helper.ts`.
- **Gate**: `bun run postman-exporter.test` shows the
  `bun run test` step.

- Add a `bun run test` step to the test plugin's `steps` array, with
  the same `ITestOutput` shape as the existing steps.
- **Acceptance**:
  - The test plugin's output includes a `name: 'vitest'` step with
    `ok: boolean` and `detail: string` containing the case count.

## acceptance

- `bun run test` shows 66+ cases.
- Coverage of pure services (route-parser, collection-builder,
  environment-builder, param-inferrer, uri.helper) is ≥80%.
- The test plugin (p00003) sees the `vitest` step.
- CI runs `bun run test && bun run typecheck && bun run check` on
  every push to `develop`.
