---
id: p00005
title: "p00005 — orchestrator agents for the postman-exporter workflow"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-07-31
related:
    - d692f50 # plugins commit
    - p00001 # parser/builder maturity
    - p00003 # test plugin already wired
---

# p00005 — orchestrator agents for the postman-exporter workflow

## Goal

Add 4 Copilot-mode agents under `.github/agents/` so the
**mcp-vertex orchestrator** can drive work in this repo through the
existing plugin tools (`postman_exporter_generrate`, `postman_exporter_validate`,
`postman_exporter_summary`, `postman_exporter_test`).

Each agent:

- Is a **single-file** Copilot subagent (`.agent.md`).
- Calls **only** the postman-exporter MCP tools (and the host
  `mcp-vertex` ones; never shell).
- Has a clear lane (read-only vs write) and a clear ownership
  (no overlapping file paths).
- Returns a discriminated output the orchestrator can pipe into
  `proposals_close_slice` or `proposals_record_outcome`.

## why

Today the plugin is wired but nothing in the repo tells the
orchestrator **how** to use it. The agent catalog works off
`.agent.md` files in `.github/agents/`; without them, the
orchestrator falls back to raw `mcp-vertex_overview` and human
routing.

With these 4 agents, a fresh checkout can:

1. Drop into a Laravel project.
2. Bootstrap a config with `postman_exporter_init` (proposed below).
3. Run `postman_exporter_summary` to see what the host would produce.
4. Run `postman_exporter_generate` to produce the JSON.
5. Run `postman_exporter_validate` to confirm coverage.
6. Run `postman_exporter_test` to confirm the package is healthy.

…by having the orchestrator pick the right agent per step.

## non-goals

- A 5th agent that runs the network (real `axios` calls against a
  live Postman). Out of scope for v0.1; the toolchain is local.
- A Copilot-mode agent that does its own commits. All git work
  flows through the mcp-vertex `git` plugin tool, not bespoke shell.
- Per-agent name pools that overlap with the existing
  `proposals.namePool` (already `["falcon", "owl", "crow", "sparrow", "finch"]`).

## agents

### `.github/agents/postman-exporter.onboarding.agent.md`

Responsibility: when the orchestrator detects a new workspace
(no `examples/<proy>/config.constant.ts` + an `artisan` / `manage.py` /
`package.json` with `express` / `requirements.txt` with `fastapi`),
decide **which** framework adapter + which configuration to start
with.

Inputs:
- `mcp-vertex_analyze_project` (host)
- `postman_exporter_summary --host <unset>` (preferred)

Outputs (the orchestrator reads this):
- `{ framework: 'laravel'|'symfony'|'express'|'fastapi'|'django',
     configSuggested: 'inline'|'write-fs'|'abort',
     nextAgent: 'postman-exporter.builder' }`

### `.github/agents/postman-exporter.builder.agent.md`

Responsibility: produce the artefact. Calls
`postman_exporter_generate` with the right `projectRoot`/`outputDir`
and surfaces the result.

Inputs:
- `postman_exporter_generate` (the plugin tool)

Outputs:
- `{ outputPaths: { collection: string, envs: ReadonlyArray<string> },
     requests: number, folders: number, coverage: { source: number, collection: number } }`

### `.github/agents/postman-exporter.validator.agent.md`

Responsibility: confirm coverage + schema right before a slice
closes. Calls `postman_exporter_validate` and refuses to close if
any drift is reported.

Inputs:
- `postman_exporter_validate` (the plugin tool)

Outputs:
- `{ ok: boolean, drift: { sourceOnly: ReadonlyArray<string>, collectionOnly: ReadonlyArray<string> } }`

### `.github/agents/postman-exporter.tester.agent.md`

Responsibility: the "is the package healthy?" gate. Always runs
before any proposal close. Calls `postman_exporter_test`.

Inputs:
- `postman_exporter_test` (the plugin tool)

Outputs:
- `{ ok: boolean, steps: ReadonlyArray<{ name: string, ok: boolean, durationMs: number }> }`

## slices

### S1 — onboarding agent
- **Status**: ready
- **Files**: `.github/agents/postman-exporter.onboarding.agent.md` (new).
- **Gate**: orchestrator can pick this agent via `mcp-vertex_agent_catalog`.

- The agent uses `mcp-vertex_analyze_project` as the entry point,
  then `postman_exporter_summary` to gather DOM data, and returns
  the discriminated output above.
- **Acceptance**:
  - `mcp-vertex_agent_catalog` lists the agent.
  - Invoking `agent_message("postman-exporter.onboarding")` returns
    the structured proposal without writing any file.

### S2 — builder agent
- **Status**: ready
- **Files**: `.github/agents/postman-exporter.builder.agent.md` (new).
- **Gate**: agent can run end-to-end on a sample Laravel host.

- The agent calls `postman_exporter_generate` once and returns the
  structured output.
- **Acceptance**:
  - Agent writes nothing to disk except the JSONs the plugin
    already produces.
  - Idempotent: re-running produces the same hash.

### S3 — validator agent
- **Status**: ready
- **Files**: `.github/agents/postman-exporter.validator.agent.md` (new).
- **Gate**: agent refuses to close a slice when drift > 0.

- The agent calls `postman_exporter_validate`. On `ok: false`, it
  returns a proposal-stalling outcome.
- **Acceptance**:
  - Same host as S2; with no diff, `ok: true`. After deleting a
    route from `routes/api.php`, `ok: false` with a non-empty
    `drift.sourceOnly`.

### S4 — tester agent
- **Status**: ready
- **Files**: `.github/agents/postman-exporter.tester.agent.md` (new).
- **Gate**: agent exits with `ok: true` on the postman-exporter
  workspace.

- The agent calls `postman_exporter_test` and returns the structured
  output.
- **Acceptance**:
  - `bun run postman-exporter.test` (mocked orchestrator call) is
    green in CI.

## acceptance

All 4 agents are listed in `mcp-vertex_agent_catalog`. Running the
orchestrator end-to-end against a fresh Laravel host with a
`postman-exporter.builder` invocation produces the expected JSON
artefact + a green `postman-exporter.validator` + a green
`postman-exporter.tester` close-out.
