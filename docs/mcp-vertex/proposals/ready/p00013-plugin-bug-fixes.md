---
id: p00013
title: "p00013 — fix plugin boot, type errors, and orchestrator wiring"
kind: fix
status: ready
type: proposal
track: postman-exporter
date: 2026-08-01
related:
    - 88e892a # host contract alignment
    - p00005 # orchestrator agents
    - p00009 # vitest suite
    - p00011 # no-process-cwd lint
---

# p00013 — fix plugin boot, type errors, and orchestrator wiring

## Goal

Make `bun /home/cartago/_projects/mcp-vertex/tools/scripts/host/host-server.script.ts
--workspace . --config ./mcp-vertex.config.json` boot cleanly with the
`postman-exporter` and `postman-exporter-testing` plugins loaded, the
4 tool ids exposed, and `bun run build` typecheck green inside both
plugins. Confirm the orchestrator's `auto_work` can dispatch to
`postman_exporter_*` tools end-to-end.

## Why

After commit `88e892a` aligned the host contract (pointers, agents,
mcp.json), the next step is to **make the server actually boot**.
The smoke test in the previous session hit `ReferenceError: NAMESPACE
is not defined` and exited 1; the plugin therefore never registered
its tools, so the orchestrator could never call them.

Once the boot is fixed, three latent typecheck errors surface and need
to be addressed before the plugin can be trusted by a CI gate.

## Symptom surface (verified)

```
$ bun /home/cartago/_projects/mcp-vertex/tools/scripts/host/host-server.script.ts \
    --workspace . --config ./mcp-vertex.config.json
[mcp-vertex] boot failed: ReferenceError: NAMESPACE is not defined
    at register (.../postman-exporter/src/lib/tools/generate.tool.ts:47:10)
    at createMcpProject (.../mcp-vertex/packages/core/src/lib/project/create-mcp-project.ts:310:22)
    ...
```

```
$ cd plugins/postman-exporter && bun run build
src/lib/helpers/runner.helper.ts(29,10): error TS2591:
    Cannot find name 'process'. Do you need to install type definitions for node?
src/lib/tools/generate.tool.ts(55,9): error TS2322:
    'ZodObject<...>' is not assignable to 'AnySchema | ZodRawShapeCompat | undefined'.
src/lib/tools/generate.tool.ts(56,9): error TS2322: (output schema, same root cause)
src/lib/tools/summary.tool.ts(51,9): error TS2322: (input schema)
src/lib/tools/summary.tool.ts(52,9): error TS2322: (output schema)
src/lib/tools/validate.tool.ts(55,9): error TS2322: (input schema)
src/lib/tools/validate.tool.ts(56,9): error TS2322: (output schema)
src/lib/tools/validate.tool.ts(69,18): error TS2339:
    Property 'push' does not exist on type 'readonly { ... }[]'.
```

## Slices

### S1 — NAMESPACE missing in 3 tools (`postman-exporter` plugin)

The plugin's `index.ts` calls `buildGenerateToolRegistration(workspaceRoot, ...)`.
Inside `generate.tool.ts`, `server.registerTool` is invoked with
`${NAMESPACE}_exporter_generate`, but `NAMESPACE` is not imported
anywhere. Same defect in `summary.tool.ts` and `validate.tool.ts`.
The fourth tool (`test.tool.ts` in the `postman-exporter-testing`
plugin) declares `const NAMESPACE = "postman"` locally and works.

Fix:

- Add `plugins/postman-exporter/src/lib/contract/namespace.ts`
  exporting `NAMESPACE = "postman" as const` (single source of
  truth).
- Import it in the 3 tools.
- Replace the misleading comment block (the previous version said
  "the server's qualifiedId rule adds the prefix automatically" —
  that is the inverse of the actual contract; the MCP SDK exposes
  the tool under the literal name passed to `registerTool`).
- Leave `test.tool.ts` as-is (local `const NAMESPACE = "postman"`)
  but emit a follow-up to align both plugins on the same shared
  contract file.

Acceptance:

- `bun /home/cartago/_projects/mcp-vertex/tools/scripts/host/host-server.script.ts --workspace . --config ./mcp-vertex.config.json`
  no longer crashes with `ReferenceError`. Process is killed by
  SIGTERM after the 5s smoke-test window; exit code is 143.
- `mcp-vertex_overview { compact: true }` lists the 4 plugin tools
  with their qualified ids (`postman_exporter_generate`,
  `postman_exporter_validate`, `postman_exporter_summary`,
  `postman_exporter_test`).

### S2 — ZodObject vs ZodRawShapeCompat (6 errors across 3 tools)

The MCP SDK signature for `registerTool` accepts
`AnySchema | ZodRawShapeCompat | undefined`. `ZodRawShapeCompat`
is a flat record (`{ [k: string]: ZodTypeAny }`), not a
`z.object({...})`. Today each tool passes the wrapped `z.object(...)`
directly.

Fix:

- Change every `inputSchema: <WrappedObject>` to
  `inputSchema: <WrappedObject>.shape`.
- Same for `outputSchema`.

Acceptance:

- `cd plugins/postman-exporter && bun run build` no longer reports
  the 6 `TS2322` errors.

### S3 — readonly issues.push in `validate.tool.ts:69`

`issues` is declared `z.array(z.object({...}))` which produces a
readonly tuple. The handler appends via `issues.push(...)` which
TS rejects with `TS2339`.

Fix:

- Build `issues` as a local `let out: Array<...> = []` and assign
  the property at the end, instead of mutating the parsed input.

Acceptance:

- `cd plugins/postman-exporter && bun run build` no longer reports
  `TS2339`.

### S4 — missing `@types/node` in `runner.helper.ts:29`

`runner.helper.ts` references `process.cwd()` (or similar node
global) but the plugin's `tsconfig.json` does not include `node`
in `types`. Either:

- Add `"types": ["node"]` to `plugins/postman-exporter/tsconfig.json`
  (requires `@types/node` as a devDependency).
- Or remove the `process.*` usage entirely if it is reachable from
  `ctx.workspace`.

Acceptance:

- `cd plugins/postman-exporter && bun run build` no longer reports
  `TS2591`.

### S5 — confirm orchestrator dispatch

With S1–S4 done, run the full smoke test:

1. Boot the server (`mcp-server.log` empty; SIGTERM on shutdown).
2. Call `mcp-vertex_overview { compact: true }` and assert that
   the 4 `postman_exporter_*` tools are listed under the
   `postman-exporter` and `postman-exporter-testing` plugins.
3. Call `mcp-vertex_proposals_proposal_board` and assert the
   12 proposals from `ready/` are listed.
4. Call `mcp-vertex_proposals_proposals_auto_work` once and
   assert the payload names `p00013-S1` (or whichever ready
   slice is next) and a `claimReady` block.
5. Update `.github/agents/orchestrator.agent.md` if the agent
   needs any explicit `description` update to mention the
   domain tools.

Acceptance:

- All 5 assertions pass.
- No `lock-conflict`, no `external-gate-blocker`, no unhandled
  rejection.

## Non-goals

- Adding new tools beyond the 4 already in the two plugins.
- Repackaging `mcp-vertex` to npm (covered by p00007 / p00008).
- Switching the plugin loader from `mcp-vertex.config.json` to
  the scaffolder's `libs/mcp-project/` infra — that infra is
  out of scope here, the canonical launch path stays at the
  host script as per CROSS-PROJECT-SETUP.md.
- Moving plugins to `plugins/mcp-vertex/{}` (decided out: the
  flat `plugins/<name>/` layout is the host convention and
  wrapping adds no value).

## Rollout

Each slice is one atomic commit on `develop`, opened as a
`fix(p00013):` Conventional Commits line and pushed to
`origin/develop`. The proposal transitions
`ready -> in-progress -> done` after S5 green.
