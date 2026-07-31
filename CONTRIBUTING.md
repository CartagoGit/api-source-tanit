# Contributing to `postman-exporter`

> **Source of truth**: this file + `docs/extension-contract.md` +
> `AGENTS.md`. Humans and LLMs committing to this repo are expected to
> follow this contract without exception.

---

## Commit style — Conventional Commits

Every commit message in this repo uses **Conventional Commits**,
lowercase, scoped, with a short imperative subject and a wrapped body.

### Prefix → kind

| Prefix | When to use |
| --- | --- |
| `feat:` | New user-facing capability (new tool, new CLI flag, new endpoint). |
| `fix:` | Bug fix that affects existing behaviour. |
| `refactor:` | Internal change with no user-facing behaviour delta. |
| `perf:` | Internal change that improves performance. |
| `test:` | Test-only change (new specs, vitest harness, fixture data). |
| `docs:` | Documentation-only change (README, extension-contract, agents, proposals). |
| `chore:` | Build / CI / deps / repo plumbing with no user-facing impact. |
| `style:` | Whitespace / formatting-only (no logic change). |
| `build:` | Build system / dep tree / packaging. |
| `ci:` | CI workflow change. |

### Subject rules

- Lowercase (`feat:`, never `Feat:` or `FEAT:`).
- Imperative mood (`add`, never `added` or `adds`).
- ≤ 72 characters after the prefix.
- No trailing period.
- Optional scope: `feat(plugin):`, `fix(parser):`, `docs(readme):`.

### Body rules

- Wrap at **72 columns**.
- Explain **why**, not what.
- Reference the proposal id (`p00001` / `p00004`) when the change
  closes a slice.
- Reference a host commit when the change unblocks a mcp-vertex
  upstream change.

### Good examples

```
feat: orchestrator agent routes requests to 4 bounded subagents

Implements p00005 S0 + p00012. The new agent at
.github/agents/postman-exporter-orchestrator.agent.md never
invokes postman_exporter_* tools directly — that lane belongs
to the bounded subagents. It owns the state machine and the
memory_save + proposals_close_slice close-out.
```

```
fix(agents): replace unsupported MCP glob with explicit tool names

VS Code silently ignores 'mcp-project-mcp-vertex/*' in the agents'
`tools:` permission list — confirmed by the prompt validator warning
"Unknown tool 'mcp-project-mcp-vertex/*' will be ignored." Each
agent was left with only `read, search` (or `read, search, execute`),
unable to invoke the MCP server at all.

Replace the glob with the **concrete tool names** the agent actually
needs …
```

### Bad examples

```
[FEAT] Plugin MCP-vertex postman-exporter + config local   ← wrong prefix style
Fix bug in parser                                          ← no prefix
feat: stuff.                                               ← trailing period
feat: add a new feature that does something useful          ← too vague
```

---

## File conventions

This repo follows the same TypeScript profile as `@mcp-vertex/core`.
Full table in `docs/extension-contract.md#conventions`; the executive
summary:

| Suffix | Folder | What it is |
| --- | --- | --- |
| `*.interface.ts` | `contract/` | Zod schemas + exported structural types. |
| `*.constant.ts` | `contract/` / `examples/` | Durable, frozen, shared constants. |
| `*.service.ts` | `service/` | Stateful business logic. |
| `*.helper.ts` | `helper/` | Pure utilities, no I/O. |
| `*.tool.ts` | `plugins/<name>/src/lib/tools/` | One MCP tool per file. |
| `*.agent.md` | `.github/agents/` | One Copilot subagent per file. |
| `*.script.ts` | `scripts/` | Entrypoints invocables por `bun run`. |

### Hard rules

- **Dot, never hyphen.** `foo.service.ts`, not `foo-service.ts`.
- **One tool per file.** No multi-tool `tools.ts`.
- **One agent per file.** No multi-agent `agents.ts`.
- **Plugins never import `service/`.** The plugin only invokes
  `scripts/cli.script.ts` via `bun run` from a workspace context.
- **Services never import `plugins/`.** Services stay runtime-safe.

---

## MCP tool reference format (agents)

VS Code's prompt validator accepts the slash form
`<server-name>/<tool-or-glob>` in the agent `tools:` permission list.
The legacy form (`mcp-vertex_overview`) is renamed on save with a
yellow squiggle. Use the slash form.

There is **one MCP server** in this workspace (`mcp-vertex`, registered
in `.vscode/mcp.json`). The plugin tools (`postman_exporter_generate`,
…) live **inside** that server under the namespace prefix. So every
MCP tool reference uses the `mcp-vertex/...` prefix; the plugin tools
are reachable as `mcp-vertex/postman_exporter_generate`, etc. The
`postman_exporter/*` form is **not** a valid MCP server here.

Pick the narrowest pattern that covers the lane — **least privilege**:

| Pattern | When |
| --- | --- |
| `mcp-vertex/<server>_<plugin>_<tool>` (slash-qualified) | **Always preferred.** The `<server>` prefix is the namespace, the second `<server>_<plugin>_<tool>` is the actual tool ID. e.g. `mcp-vertex/mcp-vertex_proposals_proposal_board`, `mcp-vertex/postman_exporter_generate`. |
| `mcp-vertex/*` | Avoid. Grants ~190 tools. Use only if the agent legitimately needs every one. |

The double `<server>` prefix (`mcp-vertex/mcp-vertex_*`) is intentional:
the **slash-form** names the MCP server (the first `mcp-vertex`); the
**tool ID** keeps the original `<server>_<plugin>_<tool>` triple that
the server itself emits (e.g. `mcp-vertex_proposals_proposal_board`).
The prompt validator renames `mcp-vertex_proposals_proposal_board`
→ `mcp-vertex/mcp-vertex_proposals_proposal_board` on save; if you
forget the slash you'll see the same yellow squiggle.

---

## TypeScript + lint gates

| Gate | Command | Catches |
| --- | --- | --- |
| Typecheck | `bun run typecheck` | Bad types, missing imports, wrong plugin contract. |
| Build | `bun run build` | Broken CLI on a Laravel host. |
| Check | `bun run check` | Bidir coverage drift + Postman v2.1.0 schema violations. |
| Lint (post p00011) | `bun run lint:tools` | `process.cwd()` / `process.env.X` / absolute paths in `plugins/**/src/lib/tools/`. |
| Tests (post p00009) | `bun run test` | Vitest suite of ~80 cases. |

The pre-commit gate is `bun run typecheck && bun run check`. CI adds
`bun run lint:tools` + `bun run test` once those land.

---

## Agent tool matrix (canonical)

The 5 agents in `.github/agents/` each declare **only the tools they
need** in the `tools:` permission list. The list is exhaustive — the
agent does **not** pick up additional permissions at runtime.

| Agent | File | Tools |
| --- | --- | --- |
| `postman-exporter-orchestrator` | `.github/agents/postman-exporter-orchestrator.agent.md` | `read, search, todo, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_agent_catalog, mcp-vertex/mcp-vertex_proposals_proposal_board, mcp-vertex/mcp-vertex_proposals_close_slice, mcp-vertex/mcp-vertex_memory_save` |
| `postman-exporter.onboarding` | `.github/agents/postman-exporter.onboarding.agent.md` | `read, search, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_analyze_project, mcp-vertex/mcp-vertex_postman-exporter_summary` |
| `postman-exporter.builder` | `.github/agents/postman-exporter.builder.agent.md` | `read, search, execute, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_postman-exporter_generate, mcp-vertex/mcp-vertex_postman-exporter_summary` |
| `postman-exporter.validator` | `.github/agents/postman-exporter.validator.agent.md` | `read, search, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_postman-exporter_validate` |
| `postman-exporter.tester` | `.github/agents/postman-exporter.tester.agent.md` | `read, search, execute, mcp-vertex/mcp-vertex_overview, mcp-vertex/mcp-vertex_postman-exporter_test` |

When adding a new tool a lane needs, **add it to that agent's `tools:`
list** — do **not** widen to `mcp-vertex/*`.

---

## Proposal workflow

Every non-trivial change starts as a proposal in
`docs/mcp-vertex/proposals/ready/`:

```yaml
---
id: p<NNNN>
title: "<short title>"
kind: feat | fix | refactor | perf | test | docs | chore
status: ready | in-progress | blocked | done | retired
type: proposal
track: postman-exporter
date: <YYYY-MM-DD>
related:
    - <sha or proposal id>
---
```

The 12 proposals already in `ready/` are the implementation roadmap.
Each proposal owns its slices; each slice has its own gate. The
orchestrator agent (`postman-exporter-orchestrator`) drives the
state machine.

---

## What is NOT negotiable

- Clean code, SOLID principles, no duplication.
- One file per tool, one file per agent, one file per slice helper.
- `process.cwd()` / `process.env.X` / absolute paths in tools.
- A Conventional Commit subject (the body can be free-form).
- A test or a slice note for every non-trivial change.

Everything else (naming, structure, ordering) is open for discussion
in the proposal that wants to change it.
