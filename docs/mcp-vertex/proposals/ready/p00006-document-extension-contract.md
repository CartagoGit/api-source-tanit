---
id: p00006
title: "p00006 — document the extension contract (third-party adapters + plugins)"
kind: feat
status: superseded
type: proposal
track: postman-exporter
date: 2026-07-31
superseded_by: docs/mcp-vertex/AGENT-BOOTSTRAP.md
superseded_at: 2026-08-01
related:
    - p00002 # framework routers
    - p00005 # agents
---

> **Superseded.** The contract this proposal described lives in
> `docs/mcp-vertex/AGENT-BOOTSTRAP.md` (§3.5 file naming, §3.6 plugin
> options, §3.8 router adapters, §3.2 tool shapes). The original plan
> for a single `docs/extension-contract.md` itself proclaimed "single
> source of truth" — which violates the universal bootstrap invariant
> that the SoT is the bootstrap. The contract is now a section of the
> project bootstrap, not a standalone doc. Kept here for historical
> reference; do not transition to `in-progress` or `done`.

---

# p00006 — document the extension contract

## Goal

Publish a single `docs/extension-contract.md` that any third-party
host (a Symfony shop, an Express team, a Next.js full-stack) can read
to:

1. Add a new router adapter to `postman-exporter` (per p00002).
2. Add a new tool to the MCP-vertex plugin (per `plugins/postman-exporter/`).
3. Add a new agent to the orchestrator catalog (per p00005).
4. Add a new env-var / config field to the `ProjectConfig` (per
   `contract/project-config.interface.ts`).

The contract is the single source of truth for "what does it look
like to extend postman-exporter without forking it?". Today this
info lives in 4 separate `README.md` files and 2 ADRs — fragmented.

## why

Without the contract doc, every third-party contribution re-derives
the conventions from reading source. That's:

- 70-80 minutes of orientation per contributor.
- 2-3 wrong PRs per quarter (e.g. plugins that read `process.cwd`,
  agents that shadow the orchestrator's name pool).
- A blocking dependency on the maintainer being available to answer.

The contract turns those 70 minutes into 10.

## non-goals

- Generating the contract from source via AST (a GenDoc script).
- TypeDoc-style per-symbol pages (we keep the human-readable single
  file).
- Translation to non-English.

## slices

### S1 — single `docs/extension-contract.md`
- **Status**: ready
- **Files**: `docs/extension-contract.md` (new).
- **Gate**: zero broken links; mentions all 4 extension surfaces.

- Sections:
  1. **Adding a router adapter** (`IRouterAdapter` shape, where to
     put the file, how to register it, example for a fresh
     "Next.js" adapter).
  2. **Adding a tool to the MCP-vertex plugin** (the `tool.ts` shape,
     `Zod` schemas, `register(ctx)` pattern, the
     `ctx.workspace.toString()` injection point, how to test it).
  3. **Adding an agent to the orchestrator catalog** (the
     `.github/agents/<name>.agent.md` shape, the `tools` permission
     list, the discriminated output contract).
  4. **Adding a field to `ProjectConfig`** (`contract/project-config.interface.ts`
     shape, `defaultProjectRoot`/`cliScript` propagation, how the
     buffer reads it).
  5. **Conventions** (file naming: `*.service.ts`, `*.tool.ts`,
     `*.helper.ts`, `*.interface.ts`, `*.constant.ts`; no `process.cwd`,
     no `process.env` direct in tools; one tool per file).
- **Acceptance**:
  - Doc opens in VS Code and renders headings + tables.
  - Mentions every `*.service.ts` and `*.tool.ts` in the repo (no
    drift).

### S2 — link from each consumer's README
- **Status**: ready
- **Files**: `plugins/postman-exporter/README.md`,
  `plugins/postman-exporter-testing/README.md`,
  `README.md`.
- **Gate**: every README links to the contract.

- Add an "Extending postman-exporter → contract" link in the
  bottom-level `README.md` and in each plugin's README.
- **Acceptance**:
  - `rg -L 'extension-contract.md' README.md plugins/**/README.md` is
    empty (every README has the link).

## acceptance

A new contributor that follows the contract can wire a
"NestJS" router adapter in <30 minutes without asking the
maintainer.
