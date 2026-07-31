---
id: p00003
title: "p00003 — internal testing plugin: `postman_exporter_test` tool"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-07-31
related:
    - p00001 # slice S3 vitest baseline
    - p00002 # slice S1 IRouterAdapter contract
    - plugins/postman-exporter/
---

# p00003 — internal testing plugin: `postman_exporter_test` tool

## Goal

Add a 4th tool to the `postman-exporter` MCP-vertex plugin:

`postman_exporter_test { host?: string, framework?: 'laravel'|'symfony'|'express'|'fastapi'|'django' }`

The tool:

1. Runs the project's own vitest suite (`bun run test`).
2. If `--framework` is given, runs a representative smoke test against
   a project of that framework (covered in p00002 fixtures).
3. Returns a structured pass/fail report with per-test timings.

It runs entirely inside the postman-exporter workspace; it never
touches a host project. This way an agent asking "is the package
healthy?" gets an answer without leaving the package.

## why

Today an agent that wants to verify the package has to know:

- `bun run typecheck` → 0 errors
- `bun run build` → produces a JSON
- `bun run check` → coverage + schema

Three commands, three different outputs, no roll-up. A single
`postman_exporter_test` tool unifies them and adds:

- A real vitest run (from p00001 S3).
- Per-framework smoke (from p00002 fixtures).
- A structured JSON the agent can pipe into `memory_save` or
  `proposals_auto-work` directly.

## non-goals

- Replacing `bun run test` from the CLI. The tool is just an
  MCP-exposed wrapper; humans keep using the CLI.
- Real-network tests. Smoke stays offline; CI gating stays as-is.

## slices

### S1 — `postman_exporter_test` tool implementation
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**:
  `plugins/postman-exporter/src/lib/tools/test.tool.ts` (new),
  `plugins/postman-exporter/src/lib/contract/postman-exporter.interface.ts`
  (add `TestInputSchema`, `ITestOutput`),
  `plugins/postman-exporter/src/index.ts` (register the tool).
- The tool runs (sequentially, with timeout):
  - `bun run typecheck` — exit code 0/1 + duration
  - `bun run build` — exit code 0/1 + JSON file size + duration
  - `bun run check` — exit code 0/1 + coverage delta + duration
  - `bun run test` — exit code 0/1 + passed/failed counts + duration
    (only when p00001 S3 lands)
- Returns `{ ok: boolean, steps: ReadonlyArray<{ name, ok, durationMs, detail? }>, durationMs: number }`.
- Uses the same `runner.helper.ts` already in the plugin (no new
  abstraction).
- **Acceptance**:
  - `bun test plugins/postman-exporter/tests/integration/test.tool.spec.ts`
    (new) asserts `ok: true` against the postman-exporter workspace
    itself, and `ok: false` when a step is forced to fail via env var.
  - Adding `bun run typecheck` to the gate takes <2 s and produces
    a structured failure detail that an agent can act on without
    re-running anything.

### S2 — per-framework smoke runner
- **Status**: ready
- **Files**: <see slice body below>
- **Gate**: test
  acceptance:

- **Files**:
  `plugins/postman-exporter/src/lib/tools/test.tool.ts` (extend),
  `plugins/postman-exporter/src/lib/helpers/smoke-runner.helper.ts`
  (new),
  `tests/fixtures/<framework>/routes.<ext>` (per-framework fixtures).
- When `framework` is given, the tool picks the matching fixture
  under `tests/fixtures/<framework>/`, runs the relevant router
  adapter against it, and returns the count of endpoints produced
  vs. the count expected by a sibling `*.expected.json` fixture.
- **Acceptance**:
  - One fixture per framework: laravel (routes/api.php),
    symfony (routes.yaml), express (app.ts), fastapi (main.py),
    django (urls.py).
  - Each fixture has a `*.expected.json` with the canonical
    endpoint list; the tool diffs and reports `ok: true` only when
    the diff is empty.
  - Spec: `bun test plugins/postman-exporter/tests/integration/smoke-runner.spec.ts`.

## Notes

- The plugin becomes the single source of truth for "is this package
  healthy?" — agents don't need to know which scripts exist.
- All steps run with a per-step timeout (default 30 s) so a hung
  subprocess can't block an agent's turn.

## acceptance

After both slices land:

- `bun run test` (plugin's own tests) is green.
- The MCP `postman_exporter_test` tool returns `ok: true` against a
  clean checkout of postman-exporter in <5 s.
- The MCP `postman_exporter_test --framework=laravel` tool returns
  `ok: true` with the canonical Laravel fixture.
