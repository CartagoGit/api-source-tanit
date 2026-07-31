# Project-specific agent bootstrap — `@postman-exporter/core`

> **This file is the project-specific extension of**
> [`../../mcp-vertex/docs/mcp-vertex/AGENT-BOOTSTRAP.md`](../../mcp-vertex/docs/mcp-vertex/AGENT-BOOTSTRAP.md)
> (the **universal bootstrap** for every project that uses mcp-vertex).
>
> **Read order**: read the universal bootstrap first, then this file.
> The universal bootstrap defines the agent contract; this file adds
> the postman-exporter-specific shapes, naming, and rules.
>
> **Conflict policy**: where this file and the universal bootstrap
> disagree, **the universal bootstrap wins**, except for the rules
> explicitly marked "**project override**" in §3 below. Those override
> the corresponding universal rule on purpose — this project chose them
> deliberately.
>
> Every host file in this repo (`.github/copilot-instructions.md`,
> `.github/agents/*.agent.md`, `AGENTS.md`, `CLAUDE.md`,
> `.claude/agents/*.md`) points here, **not** to the universal
> bootstrap directly, so a contributor only edits one place to
> change a project rule.

---

## 1. Orient first — universal rules still apply

The mcp-vertex MCP server is the live source of truth for what is
loaded. The orientation calls in the universal bootstrap apply
unchanged:

```text
mcp-vertex_overview { compact: true }
mcp-vertex_agent_catalog { mode: "compact" }
mcp-vertex_proposals_auto_work          # when an implementation task
```

Do not crawl the filesystem to rediscover what the server already
returned.

## 2. Universal invariants — copied by reference

These are **NOT redefined here** because the universal bootstrap is
the single source of truth and re-stating them invites drift:

- Tool/skill/proposal IDs must come from the server, not from
  hardcoded lists (universal §6 invariant).
- Agents and tools invoke shell through `bash`, never `zsh` or `sh`
  (universal §6 invariant; p10k + dash/ash cross-platform rationale).
- No `process.cwd()` in engines (universal §6 invariant; mirrored
  by `scripts/lint-tool-no-process.ts` per p00011).
- Conventional Commits; `bun run validate` is the DoD gate
  (universal §5).
- One atomic slice per turn; minimal validation; trust the MCP
  payload over local re-derivation (universal §4).
- Every public tool declares an `outputSchema` (universal §6).
- Code quality (SOLID, Clean Code, reusable, narrow interfaces,
  dependency injection) is the non-negotiable default
  (universal §6).
- Every agent must hold an `agent_lock` for the files it edits
  (universal §6; enforced by `lint:agent-claims` + lefthook).

If any of those rules ever feels wrong for this project, edit this
file (§3 below) and explicitly mark the change as a **project
override**. Do not edit them silently.

## 3. Project overrides and additions — postman-exporter

These rules apply **only** in this workspace. They extend or replace
the corresponding universal rule on purpose. Each override cites the
universal rule it replaces, so the divergence is auditable.

### 3.1 Plugin tool naming — **project override** of universal §6 "no hardcoded ids"

The 4 plugin tools in `plugins/postman-exporter/src/lib/tools/` and
`plugins/postman-exporter-testing/src/lib/tools/` follow a **fixed**
qualified-name contract:

| Tool id (short, in `id:`) | Qualified name (in `registerTool`) |
| --- | --- |
| `generate` | `${NAMESPACE}_exporter_generate` → on the MCP surface: `mcp-vertex_postman-exporter_generate` |
| `validate` | `${NAMESPACE}_exporter_validate` |
| `summary` | `${NAMESPACE}_exporter_summary` |
| `test` (in `postman-exporter-testing`) | `${NAMESPACE}_exporter_test` |

Where `NAMESPACE = "postman"` (constant exported from
`plugins/postman-exporter/src/lib/contract/namespace.ts`).

Hardcoding these names in this file is **permitted** for these 4
tools specifically because the qualified name is the **public MCP
surface** that the host dispatches on. Other tool IDs must still
come from the server (universal §6).

### 3.2 Tool `registerTool` shape — **project-specific**

`server.registerTool(name, opts, handler)` requires:

- `name` — the **fully qualified** id (`${NAMESPACE}_exporter_<verb>`),
  not the short `id`.
- `opts.inputSchema` — the **raw shape** (`<Z>.shape`), not the
  wrapped `z.object({...})`. Passing the wrapped object triggers
  TS `TS2322: ZodObject<...> is not assignable to AnySchema |
  ZodRawShapeCompat | undefined` because the SDK needs the flat
  record.
- `opts.outputSchema` — same rule; `.shape`.
- `opts.description` — full description for the MCP client
  (markdown allowed; ≤ ~240 chars preferred).
- `opts.inputSchema` and `opts.outputSchema` must be Zod schemas.
  No `any`, no `z.any()`.

Each `*.tool.ts` builder:

- Declares `id: "<short-name>"` (bookkeeping only; the host uses
  this for sequence ordering).
- Imports `NAMESPACE` from `../contract/namespace`, not from a
  local `const`. The single source of truth lives in
  `plugins/postman-exporter/src/lib/contract/namespace.ts`.

Bug history (do not regress): see proposal
[`proposals/ready/p00013-plugin-bug-fixes.md`](proposals/ready/p00013-plugin-bug-fixes.md)
— the original tools referenced `NAMESPACE` without importing it
(ReferenceError on server boot), used the wrapped z.object as
schema (TS2322), and pinned zod 3.23.8 while the host uses 4.x.

### 3.3 Zod version

Both plugins pin `zod: ^4.4.3`, aligned with `@mcp-vertex/core`.
The `^3.x` standard API (`~standard`, `~validate`) is required by
`ZodRawShapeCompat`. Downgrading to 3.x breaks S2 of p00013.

### 3.4 Agents — no bespoke agents, **project override** of universal §6

**Do not add bespoke agents** (e.g. `postman-exporter-builder`)
under `.github/agents/` or `.claude/agents/`. The 5 canonical agents
(orchestrator + proposal_guardian + implementation_runner +
delivery_verifier + technical_investigator) are the only ones this
workspace registers. They were installed by the mcp-vertex
scaffolder and re-aligned to the universal bootstrap in commit
`88e892a`.

Adding a bespoke 6th agent is **unreachable from `auto_work`**,
because the host runtime only knows the 5 canonical slots. Bespoke
agents also duplicate the SoT (universal §6: "every agent is a
pointer; the contract lives in the MCP server").

If you think you need a 6th, open a proposal in
`proposals/ready/` explaining the dispatch path. If accepted, the
scaffolder regenerates the 5 + 1 set; the body remains a pointer.

### 3.5 File naming and folder layout

| Folder | Suffix | Example |
| --- | --- | --- |
| `service/` | `*.service.ts` | `service/router-adapters/laravel.parser.ts` |
| `helper/` | `*.helper.ts` | `helper/uri.helper.ts` |
| `contract/` | `*.interface.ts` / `*.constant.ts` | `contract/postman-exporter.interface.ts` |
| `plugins/` | `*.tool.ts` | `plugins/postman-exporter/src/lib/tools/generate.tool.ts` |
| `docs/mcp-vertex/proposals/ready/` | `p<NNNN>-<slug>.md` | `p00013-plugin-bug-fixes.md` |

Service → runtime-safe (no `plugin/` imports). Helper → pure
functions only, no I/O. Tool → one tool per file.

### 3.6 Plugin options

Plugin options live at
`mcp-vertex.config.json#plugins.postman-exporter.options` and are
parsed by `PostmanExporterOptionsSchema` in
`plugins/postman-exporter/src/lib/contract/postman-exporter.interface.ts`.

A new field:

- Must be optional (`.default(...)`) unless the plugin is broken
  without it.
- Must be self-describing (`.describe("<doc>")`).
- Must not be `z.any()`.

### 3.7 MCP server launch — local dev only

`.vscode/mcp.json` points at the local host script
(`${userHome}/_projects/mcp-vertex/tools/scripts/host/host-server.script.ts`)
because `@mcp-vertex/cli` is not yet on npm. The
canonical-publish form (`bunx --package @mcp-vertex/cli mcpv __serve ...`)
is deferred until the CLI is published (see
`mcp-vertex/docs/mcp-vertex/NPM_PUBLISH.md` and
`mcp-vertex/docs/mcp-vertex/CROSS-PROJECT-SETUP.md`).

When the CLI ships, replace `.vscode/mcp.json#servers.mcp-vertex.args`
with the canonical form and delete this section.

### 3.8 Router adapters

`service/router-adapters/<framework>.parser.ts` exports a class
implementing `IRouterAdapter`:

```ts
export interface IRouterAdapter {
  readonly framework:
    | "laravel" | "symfony" | "express" | "fastapi" | "django";
  readonly detect: (ctx: IProjectContext) => boolean;
  readonly discover: (ctx: IProjectContext) => Promise<IRouteParseResult>;
}
```

Adapters register themselves in
`service/router-dispatcher.service.ts` by being appended to the
`adapters` array. A new adapter ships with at least 4 cases in
`tests/unit/router-adapters/<framework>.parser.spec.ts`.

## 4. Project invariants — local additions

These are not overrides; they are **local additions** that the
universal bootstrap does not mention because they are
postman-exporter-specific:

- **Workspace root comes from `ctx.workspace.toString()`**, not
  `process.cwd()`. Every tool receives it through the plugin's
  `register(ctx)` and passes it into the `build<V>ToolRegistration`
  builder. No tool reads the cwd.
- **`scripts/lint-tool-no-process.ts`** enforces "no process.cwd /
  process.env in tools" (per p00011). It runs as part of
  `bun run check`.
- **Proposal workflow is gated by `mcp-vertex_proposals_proposal_board`**.
  The 12+1 proposals in `docs/mcp-vertex/proposals/ready/` are
  the active backlog. Open new ones as `p<NNNN>-<slug>.md` with
  `status: ready`. The orchestrator transitions `ready → in-progress
  → done` via `mcp-vertex_proposals_proposals_close_slice`.

## 5. Definition of done — local deltas

The universal bootstrap §5 DoD applies. Project-specific additions:

- Touched a tool? Bumped the matching `package.json#version` only
  when the tool surface changes (input/output schema, qualified
  name). Otherwise `0.1.x` semantic patch.
- Added a proposal? Linked it from the relevant section of this
  file (`§3.x`) so the rule index is current.
- Plugin boot is green:
  ```sh
  bun /home/cartago/_projects/mcp-vertex/tools/scripts/host/host-server.script.ts \
      --workspace . --config ./mcp-vertex.config.json
  ```
  Process must stay up under SIGTERM, exit 143, no `ReferenceError`
  or `Cannot find module` in stdout/stderr.

## 6. Where to next

- Universal bootstrap:
  [`../../mcp-vertex/docs/mcp-vertex/AGENT-BOOTSTRAP.md`](../../mcp-vertex/docs/mcp-vertex/AGENT-BOOTSTRAP.md).
- Plugin source: [`../plugins/postman-exporter/`](../plugins/postman-exporter/).
- Plugin tests: WIP under p00009.
- Proposals queue: [`proposals/ready/`](proposals/ready/).
- Cross-project setup reference:
  [`../../mcp-vertex/docs/mcp-vertex/CROSS-PROJECT-SETUP.md`](../../mcp-vertex/docs/mcp-vertex/CROSS-PROJECT-SETUP.md).
- Cross-IDE reference:
  [`../../mcp-vertex/docs/mcp-vertex/CROSS-IDE.md`](../../mcp-vertex/docs/mcp-vertex/CROSS-IDE.md).
