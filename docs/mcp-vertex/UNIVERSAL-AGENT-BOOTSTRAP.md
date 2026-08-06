# Universal agent bootstrap — vendored from `@mcp-vertex/core`

> **Provenance:** snapshot of
> `mcp-vertex/docs/mcp-vertex/AGENT-BOOTSTRAP.md` (upstream package
> `@mcp-vertex/core`), vendored into this repository so consumers do
> **not** need a sibling checkout of `mcp-vertex`.
>
> **Read order in this project:**
> 1. this file (universal contract), then
> 2. [`AGENT-BOOTSTRAP.md`](AGENT-BOOTSTRAP.md) (project overrides).
>
> Host instruction files (`AGENTS.md`, `CLAUDE.md`,
> `.github/copilot-instructions.md`, agent stubs) must point only at
> the **project** bootstrap. They must never link outside this repo.
>
> **Refresh policy:** when upstream mcp-vertex ships a meaningful
> bootstrap change, re-copy that file over this one and keep the
> provenance header. Do not invent divergent universal rules here —
> project-only rules belong in `AGENT-BOOTSTRAP.md`.

---

# Universal agent bootstrap — `@mcp-vertex/core`

> **This file is the only place universal agent rules live.** Every host
> instruction file (`.github/copilot-instructions.md`, `CLAUDE.md`,
> `AGENTS.md`, anything written for Cursor / Aider / Continue / Codex /
> generic LLM tooling) is a **pointer** to the project bootstrap, which
> extends this file. They contain zero narrative of their own.

The server (`mcp-vertex_overview`, `mcp-vertex_agent_catalog`,
`mcp-vertex_agent_bootstrap` prompt) is the **only** source of truth for
what is loaded. The agent must **always** ask the server instead of
guessing from a list, hardcoded id, or copy-pasted previous session.

---

## Table of contents

1. [Orient first — one cheap call](#1-orient-first--one-cheap-call)
2. [Route work — ask the server](#2-route-work--ask-the-server)
3. [Bootstrap prompt — insert when the host supports it](#3-bootstrap-prompt--insert-when-the-host-supports-it)
4. [Workflow loop](#4-workflow-loop)
5. [Definition of done](#5-definition-of-done)
6. [Invariants you must not break](#6-invariants-you-must-not-break)
7. [Repo-level rules (only when the host reads `AGENTS.md`)](#7-repo-level-rules-only-when-the-host-reads-agentsmd)
8. [Host appendices](#8-host-appendices)
   - 8.1 [Copilot Chat — close-marker contract](#81-copilot-chat--close-marker-contract)
   - 8.2 [Claude Code — keep the main thread cheap](#82-claude-code--keep-the-main-thread-cheap)
   - 8.3 [Codex CLI — custom subagents + workspace AGENTS.md](#83-codex-cli--custom-subagents--workspace-agentsmd)
   - 8.4 [Cursor / Aider / Continue — generic LLM hosts](#84-cursor--aider--continue--generic-llm-hosts)

---

## 1. Orient first — one cheap call

When the `mcp-vertex` server is connected, call:

````text
mcp-vertex_overview { compact: true }
````

That single call returns the full picture of what is loaded (plugins,
tools, host info, recommended next action). **Do not** crawl the
filesystem, list the repo root, or enumerate `packages/`, `plugins/`,
or `extensions/` to rediscover what the server already told you.

## 2. Route work — ask the server

Whenever a task involves routing to a tool, a skill, or an actionable
proposal, call:

````text
mcp-vertex_agent_catalog { mode: "compact" }
````

- `mode: "compact"` (default) returns the actionable proposal list plus
  counts per status, plus lean skill ids. Tool names are NOT repeated
  here — `mcp-vertex_overview { compact: true }` already lists them all,
  grouped by plugin.
- `mode: "full"` returns the whole catalog.
- `section: "tools" | "skills" | "proposals"` narrows to one slice.
- `query: "..."` filters by id / name / tag / title.

Do **not** hardcode tool names, skill names, or proposal ids in your
answers. Ask the server every time. Skills/tools/proposals are added
and removed every week; any hardcoded list will be wrong within days.

### Execution path — one call first

For an implementation task, call `mcp-vertex_proposals_auto_work` once. When
its work response includes `claimReady`, claim exactly the returned files with
the supplied lock arguments, implement that atomic slice, validate it, then
close it. The payload is the canonical next action; do not spend extra calls
reconstructing the proposal or slice plan.

### Advanced / compatibility path

Older hosts that do not expose `claimReady`, or a debugging session that needs
to inspect dependencies or contention, can use the existing plan/claim tools
after `auto_work`. This fallback is compatible by design, but it is not the
normal bootstrap path.

## 3. Bootstrap prompt — insert when the host supports it

The server exposes a bootstrap prompt (`mcp-vertex_agent_bootstrap`) that
composes the canonical starter invocation. If your host surfaces MCP
prompts (Copilot slash, Claude slash, Cursor at-suggestion, etc.),
**use it**. It always reflects the live server state.

If your host does not surface prompts, the first two calls above are
the equivalent and equally cheap.

## 4. Workflow loop

- **Delegate non-trivial work.** For any real multi-file change, use the
  host's `orchestrator` subagent (or the agent the host registers as
  orchestrator). The orchestrator owns the proposal state machine,
  locks, drift guards, and recovery from `stop: true`.
- **Don't poll.** When you need a lock another agent holds, wait for
  the `lock-released` notification (notification plugin). When
  `auto_work` returns `stop: true`, recover by calling
  `proposals_continue_proposal { mode: "auto" }` or by reading
  `proposals_compact_status` — do NOT re-call `auto_work` until you
  have made progress (a slice closed, a lock released, a file edited).
- **Re-read discipline.** Do not re-read a file whose digest hasn't
  changed. `round_context` and the docs tools expose digests for exactly
  this. Re-reading unchanged content is the #1 token waste.

- **Archived proposals are frozen.** Reaped / archived proposals stay
  indexed (with `archived: true` when the registry supports it), keep
  their `status: done`, and **must not** be transitioned, edited, or
  have their slice statuses changed.

### 4.c Session hygiene — keep host usage intentional

`mcp-vertex` can measure its own payloads and tool activity, but it cannot
inspect a host's private context meter or subscription quota. Treat host
warnings as authoritative and use this portable policy in every project:

- One session is one coherent task. At a completed slice, write the smallest
  handoff/digest needed next; never leave an idle or polling session running.
- With `memory`, check after roughly 25 turns or 8k raw-tail tokens. If it
  triggers, compact and recall the digest instead of carrying raw output.
- At a host warning — or before roughly 100k tokens when it exposes a meter —
  checkpoint and start fresh. Compact related work; clear unrelated work, then
  re-orient and recall only the needed digest.
- If a host pre-compaction advisory says the explicit digest is missing or
  stale, create a semantic checkpoint from the actual work state; never ask a
  hook to invent one from a transcript.
- After two continuous hours, deliberately checkpoint and compact. End
  unattended or idle sessions; use notifications/events instead of waiting.
- Start ordinary single-agent work lean; elevate to collaboration only for
  coordination, locks, notifications, or proposals, avoiding static schemas
  until they are useful.

### 4.b Coexistence with parallel work

This workspace may be shared. Other agents, CI bots, and humans commit
constantly. When you observe a change in the working tree, the index, or
the active branch that **is not yours**, apply the five-point rule:

1. **Do not panic.** The change is not necessarily directed at your slice.
2. **Do not redo the work.** Read what is there *now*.
3. **Read the commit.** `git log -1` / `git diff HEAD~1 -- <path>`. Accept
   or do a surgical follow-up — never a full re-plan.
4. **Do not widen scope.** Wait, take a different disjoint slice, or close
   with "blocked by external change".
5. **Trust `git diff` over memory.** The working tree is the source of truth.

```text
git log -1 -- <path>
git diff HEAD~1 -- <path>
# accept and proceed, OR surgical follow-up. NEVER re-plan.
```

## 5. Definition of done

- `bun run validate` is green (typecheck + lint + tests + drift guards).
- Conventional Commits (`fix:` / `feat:` / `feat!:`) — versioning is
  automatic on the default branch when CI is configured. No manual bumps
  unless the project says otherwise.
- Touched a tool? Kept its `outputSchema`. Added a tool? Added its
  output to the catalog generator (if it isn't picked up automatically).
- Persisted state? Routed through `withFileMutex` + `writeFileAtomic`
  (or the project's equivalent atomic write helpers).
- Wrote a secret through a durable store? Ran it through `redactSecrets`.

## 6. Invariants you must not break

- Core stays agnostic. No project vocabulary inside `@mcp-vertex/core`.
  Plugins receive everything resolved through `IMcpPluginContext`.
- No `process.cwd()` in engines. Paths come from `ctx.workspace` /
  `corePaths` / injected options.
- Async I/O only in hot paths. `*Sync` is boot-time only.
- Workspace-scoped path inputs are contained via
  `resolveWorkspaceContained` (or equivalent).
- Token budget is a protected invariant. `overview` (compact) +
  `auto_work` stay under their measured budgets.
- **Every agent MUST hold an active lock claim (`agent_lock`) for the
  files it edits** when the proposals / lock plugins are loaded.
- Every public tool declares an `outputSchema`. `catchall` is documented,
  not default.
- **No hardcoded lists of skills / tools / proposal ids in any host
  file, agent answer, or generated fragment.** The server is the only
  source. If you find yourself wanting to list them, **stop** and call
  `mcp-vertex_agent_catalog` instead.
- **Code quality is a non-negotiable default.** SOLID, Clean Code,
  reusable narrow interfaces, dependency injection, tests for
  non-trivial logic, validation at I/O edges, strict types. Escapes only
  when the user explicitly asks or a binding project rule forces it —
  state the escape in the response.
- **Agents and tools invoke shell through `bash`, never `zsh` or
  `sh`.** Prefer `/bin/bash -c '<cmd>'` or
  `bash --noprofile --norc -c '<cmd>'`. Reasons: interactive zsh themes
  (e.g. p10k) can open the alternate screen buffer and break sync tool
  wrappers; `sh` is not a stable dialect across Debian/Alpine/macOS.
  If the shell still gets stuck on an alternate-buffer symptom, do not
  retry the same `mode: "sync"` call — re-issue as `mode: "async"` and
  poll, or fall back to file tools (`withShellFallback` from
  `@mcp-vertex/core/public` when available).

## 7. Repo-level rules (only when the host reads `AGENTS.md`)

In **this** repository, project-level layout, commands, and naming live
in [`AGENT-BOOTSTRAP.md`](AGENT-BOOTSTRAP.md) (project overrides §3–§5).
Do **not** look for a sibling `mcp-vertex` checkout or an external
`REPO-RULES.md`.

Hosts that do **not** read a workspace-root `AGENTS.md` can skip this
section entirely.

## 8. Host appendices

These are the only places host-specific rules live. **All host
instruction files just point at the project bootstrap and pick the
appendix that applies.**

### 8.1 Copilot Chat — close-marker contract

When the `@mcp-vertex/status-marker` plugin is loaded (`mcp-vertex_overview`
reports it), the model is responsible for closing every response with
exactly one line from the canonical 8-state table.

**Mandatory behaviour for every response, with no exceptions:**

1. Pick the state that best describes the turn's outcome (`HECHO` when
   work is complete and nothing pending; `CAP` when handing off
   mid-turn; `RE-PIVOT` when the cascade changed direction;
   `CHECKPOINT-REQUIRED` when handing off to the orchestrator;
   `REPAIR-NEEDED` when the verifier asked for repair; `BLOQUEADO` on a
   hard blocker; `SIN PROPUESTAS LIBRES` when the catalog only has
   claimed work; `SIN PROPUESTA DE NINGUN TIPO` when nothing is
   executable at all).
2. Call `<prefix>_close { state, reason? }` (prefix is `status-marker` —
   confirm via `mcp-vertex_overview`). Never hand-format the line.
3. Paste the returned `line` as the **literal last line** of the
   response. No prose after it — not even whitespace-then-text. The
   line must be ≤ 120 chars (the helper truncates with `…` if needed).
4. Five states require a `reason`: `CAP`, `RE-PIVOT`,
   `CHECKPOINT-REQUIRED`, `REPAIR-NEEDED`, `BLOQUEADO`. Omitting it
   makes the helper insert the literal `<reason-missing>` token — that
   is **not** a valid response.
5. If unsure whether a draft response is compliant, run
   `<prefix>_validate { text: <full draft> }` first and check `ok`.

**Bilingual rendering toggle.** The close marker supports two
bracket-text locales: `'es'` (default) and `'en'`. Pass `locale: "en"`
to `<prefix>_close` to switch. Semantics are unchanged — only the
bracket text differs.

### 8.2 Claude Code — keep the main thread cheap

Tool *results* stay in context for the rest of the session, so how you
call tools matters:

- **Delegate non-trivial work.** Threshold: more than 3 tool calls,
  multiple files, or repeated MCP reads → use the orchestrator subagent.
- **Prefer compact tools when orienting.** `overview { compact: true }`,
  `proposals_auto_work`, `proposals_compact_status`.
- **Prefer distilled recall over re-reading.**
- **`/compact` between unrelated tasks.**
- **Rotate before the danger zone.** At the host's context warning (or
  about 100k tokens when exposed), checkpoint and start a fresh session.

### 8.3 Codex CLI — custom subagents + workspace AGENTS.md

Codex CLI reads the workspace-root `AGENTS.md` and recognises custom
subagents under `.codex/agents/<name>.md`. Keep the five canonical roles
(`orchestrator`, `proposal-guardian`, `implementation-runner`,
`delivery-verifier`, `technical-investigator`) as **pointers** to the
project bootstrap. Do not embed narrative rules in those stubs.

MCP server config (`.codex/config.toml` or the host equivalent) should
launch mcp-vertex via the **published** CLI when available
(`bunx --package @mcp-vertex/cli mcpv __serve ...`). A local host script
path is only a temporary pre-publish fallback and must not be required
by contributors who clone only this repository.

### 8.4 Cursor / Aider / Continue — generic LLM hosts

Use the same single-pointer pattern at the workspace root:

````text
# Agent instructions

Follow [`docs/mcp-vertex/AGENT-BOOTSTRAP.md`](docs/mcp-vertex/AGENT-BOOTSTRAP.md)
— that file is the only source of project agent rules. It extends the
vendored universal bootstrap in the same folder. The server
(`mcp-vertex_overview`, `mcp-vertex_agent_catalog`) is the only source
of truth for what is loaded. Do not enumerate tools, skills, or
proposal ids in your answers.
````

That's it. No other content. When the bootstrap changes, the host
picks it up on the next session.
