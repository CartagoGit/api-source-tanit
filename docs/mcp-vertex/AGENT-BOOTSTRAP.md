# Project-specific agent bootstrap — `@export-to-postman/core`

> **This file is the project-specific extension of**
> [`UNIVERSAL-AGENT-BOOTSTRAP.md`](UNIVERSAL-AGENT-BOOTSTRAP.md)
> (the **universal bootstrap**, vendored from upstream `@mcp-vertex/core`
> so this repository is self-contained).
>
> **Read order**: read the universal bootstrap first, then this file.
> The universal bootstrap defines the agent contract; this file adds
> the export-to-postman-specific shapes, naming, and rules.
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
> bootstrap directly, and **never** to a path outside this repository.
>
> **Agnostic / portable rule:** do not require a sibling checkout of
> `mcp-vertex`. Local absolute paths under a developer's machine are
> forbidden in committed docs and configs. Pre-publish launch of the
> MCP host may temporarily use a relative sibling path in
> `.vscode/mcp.json`; that is documented as temporary and must switch
> to the published `@mcp-vertex/cli` form when available.

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
  (universal §6 invariant).
- No `process.cwd()` in engines (universal §6 invariant; mirrored
  by `scripts/gates/lint-tool-no-process.script.ts` per p00011).
- Conventional Commits; `bun run validate` is the DoD gate
  (universal §5).
- One atomic slice per turn; minimal validation; trust the MCP
  payload over local re-derivation (universal §4).
- Every public tool declares an `outputSchema` (universal §6).
- Code quality (SOLID, Clean Code, reusable, narrow interfaces,
  dependency injection) is the non-negotiable default
  (universal §6).
- Every agent must hold an `agent_lock` for the files it edits
  when lock tooling is loaded (universal §6).

If any of those rules ever feels wrong for this project, edit this
file (§3 below) and explicitly mark the change as a **project
override**. Do not edit them silently.

## 3. Project overrides and additions — export-to-postman

These rules apply **only** in this workspace. They extend or replace
the corresponding universal rule on purpose. Each override cites the
universal rule it replaces, so the divergence is auditable.

### 3.1 Plugin tool naming — **project override** of universal §6 "no hardcoded ids"

The 4 plugin tools in `packages/plugins/mcp-vertex_expostman/src/lib/tools/`
register themselves as `` `${ctx.namespacePrefix}_${TOOL_ID}` ``, where
`namespacePrefix` comes from the host and `TOOL_ID` is the short,
stable id declared at the top of each `*.tool.ts`:

| Tool id (short, in `id:`) | Qualified name on the MCP surface |
| --- | --- |
| `generate` | `mcp-vertex_expostman_generate` |
| `validate` | `mcp-vertex_expostman_validate` |
| `summary` | `mcp-vertex_expostman_summary` |
| `test` | `mcp-vertex_expostman_test` |

Hardcoding these four qualified names here is **permitted** because they
are the **public MCP surface** the host dispatches on. Other tool ids
must still come from the server (universal §6).

> **This section used to be wrong.** It described a `${NAMESPACE}_exporter_<verb>`
> shape built from a `NAMESPACE = "postman"` constant it called the
> single source of truth. No tool ever registered that way, the constant
> was imported by nobody, and following this section produced a name the
> host does not dispatch. Corrected in the 2026-08-08 audit (`a00001`,
> finding 4); the dead constant is gone.

### 3.2 Tool `registerTool` shape — **project-specific**

`server.registerTool(name, opts, handler)` requires:

- `name` — the **fully qualified** id (see §3.1), not the short `id`.
- `opts.inputSchema` — the zod object schema (`z.object({...})`), the
  same shape the host's own plugins pass.
- `opts.outputSchema` — **mandatory**, same shape. This is the universal
  §6 invariant; `bun run lint:mcp-surface` enforces it.
- `opts.description` — full description for the MCP client (markdown
  allowed; ≤ ~240 chars preferred).
- Neither schema may use `z.any()` or `z.unknown()` at the root. A
  schema that accepts anything is the absence of a contract with extra
  steps, and the gate rejects it.

The output schema describes the **success** payload and pins
`ok: z.literal(true)`. Failure has its own universal envelope —
`toolError` returns `{ ok: false, error: { reason, nextAction? } }` and
sets `isError` — so no tool repeats that shape. Keep `ok` for "the tool
ran" and add a separate field (`valid`, `passed`, …) for "the result was
good": conflating them made `validate` report a stale collection as a
tool failure.

Types are derived from the schemas with `z.infer`. A hand-written
interface next to a schema is two sources of truth, and they separate:
`summary` declared six fields while returning eighteen.

> **This section used to require `.shape`** ("the raw shape, not the
> wrapped `z.object({...})`"). The host's own plugins pass the wrapped
> object and so does this one. Corrected in the 2026-08-08 audit.

### 3.3 Zod version

Both plugins pin `zod: ^4.4.3`, aligned with `@mcp-vertex/core`.
The `^3.x` standard API (`~standard`, `~validate`) is required by
`ZodRawShapeCompat`. Downgrading to 3.x breaks S2 of p00013.

### 3.4 Agents — no bespoke agents, **project override** of universal §6

**Do not add bespoke agents** (e.g. `export-to-postman-builder`)
under `.github/agents/` or `.claude/agents/`. The 5 canonical agents
(orchestrator + proposal_guardian + implementation_runner +
delivery_verifier + technical_investigator) are the only ones this
workspace registers.

Adding a bespoke 6th agent is **unreachable from `auto_work`**,
because the host runtime only knows the 5 canonical slots. Bespoke
agents also duplicate the SoT (universal §6: "every agent is a
pointer; the contract lives in the MCP server").

If you think you need a 6th, open a proposal in
`docs/mcp-vertex/proposals/ready/` explaining the dispatch path. If
accepted, the scaffolder regenerates the 5 + 1 set; the body remains
a pointer.

### 3.5 File naming and folder layout

| Folder | Suffix | Example |
| --- | --- | --- |
| `packages/contracts/interfaces/` | `*.interface.ts` | `packages/contracts/interfaces/core/scanner.interface.ts` |
| `packages/contracts/constants/` | `*.constant.ts` | `packages/contracts/constants/core/postman.constant.ts` |
| `packages/core/helpers/` | `*.helper.ts` | `packages/core/helpers/uri.helper.ts` |
| `packages/core/` | `*.service.ts` / `*.pipeline.ts` / `*.orchestrator.ts` / `*.adapter.ts` | `packages/core/discovery/generation.pipeline.ts` |
| `packages/core/exporters/` | `*.exporter.ts` | `packages/core/exporters/openapi.exporter.ts` |
| `packages/frameworks/` | `*.scanner.ts` / `*.registry.ts` | `packages/frameworks/scanners/express.scanner.ts` |
| `packages/cli/commands/` | `*.script.ts` | `packages/cli/commands/generate.script.ts` |
| `packages/plugins/*/src/lib/tools/` | `*.tool.ts` | `packages/plugins/mcp-vertex_expostman/src/lib/tools/generate.tool.ts` |
| `docs/mcp-vertex/proposals/ready/` | `<kind><NNNNN>-<slug>.md` directamente en `ready/` | `x00001-contratos-de-la-superficie-mcp.md` |

The full table, derived from what `lint:naming` enforces, lives in
[`docs/NAMING.md`](../NAMING.md#sufijos-por-carpeta). New proposal ids
take a **kind prefix** (`a`, `x`, `r`, `d`, `f`, `t`…); the old `p`
prefix is a read-only alias the server no longer allocates.

Service → runtime-safe (no `plugin/` imports). Helper → pure
functions only, no I/O. Tool → one tool per file.

**Types and constants live in `packages/contracts/`, nowhere else.**
Not a style preference — a measured one. With the type next to the
function that introduced it, using the type drags in the implementation:
the web UI imported `IProjectSummary` from `core/discovery/summary.service`,
so *typing* a summary pulled the whole pipeline; the MCP plugin imported
the framework catalog from `frameworks/index`, dragging all 21 scanners,
to declare a `z.enum` of 21 strings.

Worse, nothing stops duplication: `SummaryOutputSchema` re-declared
`IProjectSummary` with zod, the two drifted, and the schema claimed 6
fields while the handler returned 18.

`bun run lint:contracts` enforces it. Two things are **not** contracts
even though they use `const` — an asset the program serves verbatim
(`UI_HTML`) and a composition root of instantiated objects
(`DEFAULT_REGISTRY`). Both are declared in the gate's `EXCEPTIONS`
**with a written reason**; the gate also fails when an exception stops
being needed. See [`packages/contracts/README.md`](../../packages/contracts/README.md).

### 3.6 Plugin options

Plugin options live at
`mcp-vertex.config.json#plugins.export-to-postman.options` and are
parsed by `ExportToPostmanOptionsSchema` in
`packages/plugins/mcp-vertex_expostman/src/lib/contracts/plugin.interface.ts`.

A new field:

- Must be optional (`.default(...)`) unless the plugin is broken
  without it.
- Must be self-describing (`.describe("<doc>")`).
- Must not be `z.any()`.

### 3.7 MCP server launch — portable first

**Canonical (published) form** — preferred as soon as `@mcp-vertex/cli`
is on npm:

```json
{
  "servers": {
    "mcp-vertex": {
      "type": "stdio",
      "command": "bunx",
      "args": [
        "--package",
        "@mcp-vertex/cli",
        "mcpv",
        "__serve",
        "--workspace=${workspaceFolder}",
        "--config=${workspaceFolder}/mcp-vertex.config.json"
      ]
    }
  }
}
```

**Temporary pre-publish fallback** (local developers who also have a
sibling `mcp-vertex` checkout): `.vscode/mcp.json` may point at a
relative sibling host script.

> The path is `../mcp-vertex/tools/scripts/host/host-server.script.ts`.
> It lives in a quote because it is **outside this repository** — the
> only place `lint:bootstrap-drift` allows naming something that does
> not exist here. That is exactly the point: the path is not required
> for cloning or using this repository elsewhere.
>
> A container build caught this. On a machine that happens to have the
> sibling checked out, the gate passed; in a clean one it did not. Same
> shape as the `exit-codes` test that only passed where nobody had run
> the CLI before.

Never commit absolute machine paths (e.g. `/home/<user>/_packages/...`).

When the CLI ships, replace the fallback with the canonical form and
delete any remaining sibling-path notes from this section.

Schema reference for `mcp-vertex.config.json`: use the schema shipped
with the installed `@mcp-vertex/core` package (or omit `$schema` until
publish). Do not hard-require
`../mcp-vertex/packages/core/schema/...` for third-party clones.

### 3.8 Framework scanners — the discovery contract

Discovery goes through **three** interfaces declared in
[`packages/contracts/interfaces/core/scanner.interface.ts`](../../packages/contracts/interfaces/core/scanner.interface.ts):

```ts
IProjectScanner        // ¿es este proyecto mío?  detect() → 0..1, resolve()
IRouteScanner          // las rutas, en formato neutro: scan() → ParsedRoute[]
IValidationSpecProvider // las reglas de cada ruta, si el framework las declara
```

A framework ships them as a bundle registered in
[`packages/frameworks/framework.registry.ts`](../../packages/frameworks/framework.registry.ts).
`discoverProject()` runs every registered `IProjectScanner`, scores them,
and keeps the winner — several can match at once, and that is what makes
a hybrid project work.

A new scanner ships with at least 4 cases in
`tests/frameworks/<framework>-scanner.spec.ts`, a mini fixture in
`tests/smoke-fixtures/<framework>-mini/`, and a full example project in
`examples/example-<framework>/` that `bun run validate:examples` checks.

**The core must never import from `frameworks/`.** That is the one line
separating "we are framework-agnostic" from "we say we are", and
`bun run lint:boundaries` enforces it.

> **This section used to describe an `IRouterAdapter`** with a
> `services/router-dispatcher.service.ts` and a
> `services/router-adapters/<framework>.parser.ts` layout. None of it
> exists: that architecture was replaced by the trio above. Corrected in
> the 2026-08-08 audit (`a00001`, finding 4).

### 3.9 Bootstrap files must stay in-repo — **project-specific**

| File | Role |
| --- | --- |
| `docs/mcp-vertex/UNIVERSAL-AGENT-BOOTSTRAP.md` | Vendored universal contract from `@mcp-vertex/core` |
| `docs/mcp-vertex/AGENT-BOOTSTRAP.md` | This file — project overrides only |

Host pointers (`AGENTS.md`, `CLAUDE.md`,
`.github/copilot-instructions.md`, `.github/agents/*`,
`.claude/agents/*`) must reference **only** this project bootstrap
path. Live tool/skill/proposal catalogs come from the MCP server
(`mcp-vertex_overview` / `mcp-vertex_agent_catalog`), never from a
sibling-repo generated markdown file.

## 4. Project invariants — local additions

These are not overrides; they are **local additions** that the
universal bootstrap does not mention because they are
export-to-postman-specific:

- **Workspace root comes from `ctx.workspace.toString()`**, not
  `process.cwd()`. Every tool receives it through the plugin's
  `register(ctx)` and passes it into the `build<V>ToolRegistration`
  builder. No tool reads the cwd.
- **`scripts/gates/lint-tool-no-process.script.ts`** enforces "no process.cwd /
  process.env in tools" (per p00011). It runs as part of
  `bun run validate` / lint.
- **Proposal workflow** is under `docs/mcp-vertex/proposals/`. Open
  new ones directly in `ready/` as `<kind><NNNNN>-<slug>.md` with
  `status: ready`; the orchestrator transitions them via the proposals
  plugin tools. Closed proposals are archived in `done/<kind>/`.

## 5. Definition of done — local deltas

The universal bootstrap §5 DoD applies. Project-specific additions:

- Touched a tool? Bumped the matching `package.json#version` only
  when the tool surface changes (input/output schema, qualified
  name). Otherwise `0.1.x` semantic patch.
- Added a proposal? Linked it from the relevant section of this
  file (`§3.x`) so the rule index is current.
- Plugin boot is green via the portable launch form in §3.7 (published
  CLI preferred; temporary sibling host only for local pre-publish).
  Process must stay up under SIGTERM, exit 143, no `ReferenceError`
  or `Cannot find module` in stdout/stderr.
- No new committed references to paths outside this repository
  (sibling `../mcp-vertex/...` absolute machine paths, external
  host-hint markdown). Historical notes inside `proposals/done|blocked|retired`
  may retain past paths as archaeology only.

## 6. Where to next

- Universal bootstrap (vendored):
  [`UNIVERSAL-AGENT-BOOTSTRAP.md`](UNIVERSAL-AGENT-BOOTSTRAP.md).
- Plugin source: [`../../packages/plugins/mcp-vertex_expostman/`](../../packages/plugins/mcp-vertex_expostman/).
- Proposals queue: [`proposals/`](proposals/).
- Live catalog: call `mcp-vertex_overview` / `mcp-vertex_agent_catalog`
  — do not link generated host-hint files from another repo.
