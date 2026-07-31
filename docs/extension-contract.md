# Postman Exporter · Extension Contract

This document is the **single source of truth** for extending
`postman-exporter` without forking it. It is the contract that the
4 agents and 4 plugin tools obey. Read it once per session.

The contract covers four extension surfaces:

1. Adding a router adapter (per-framework).
2. Adding a tool to the MCP-vertex plugin.
3. Adding an agent to the orchestrator catalog.
4. Adding a field to `ProjectConfig`.

Conventions apply across all four surfaces.

---

## 1. Conventions (apply to every surface)

| What | Convention | Why |
| --- | --- | --- |
| File naming | `*.service.ts` / `*.helper.ts` / `*.interface.ts` / `*.constant.ts` / `*.tool.ts` | Discovery + tooling rely on this |
| Folder layout | `service/`, `helper/`, `contract/`, `examples/`, `plugins/`, `docs/`, `scripts/` | Stable; tools glob these roots |
| Plugin tool naming | `postman_exporter_<verb>` | One namespace prefix, kebab-case verb |
| Agent naming | `postman-exporter.<lane>` (e.g. `postman-exporter-builder`) | Matches the lane contract |
| Proposal naming | `p<NNNN>-<slug>.md` in `docs/mcp-vertex/proposals/ready/` | `p00001` … `p00999` |
| Hard rule: tools | **NEVER** `process.cwd()` / `process.env.X` / absolute paths | Tools are workspace-injected only |
| Hard rule: services | **NEVER** import a `plugin/` module | Services must remain runtime-safe |
| Hard rule: helpers | Pure functions only, no I/O | Cacheable, deterministic, unit-testable |
| Hard rule: agents | One lane per agent (read-only vs write) | No agent overlaps another's file paths |
| Hard rule: agents | Always return a discriminated output | Orchestrator pattern-matches |

---

## 2. Adding a router adapter

### Where the file lives

```
service/router-adapters/<framework>.parser.ts
```

### The shape

```ts
// contract/router.interface.ts
export interface IRouterAdapter {
  readonly framework:
    | "laravel" | "symfony" | "express" | "fastapi" | "django";
  readonly detect: (ctx: IProjectContext) => boolean;
  readonly discover: (ctx: IProjectContext) => Promise<IRouteParseResult>;
}

export interface IRouteParseResult {
  routes: ReadonlyArray<DiscoveredRoute>;
  formRequestByRoute: ReadonlyMap<string, string>;
  meta?: Readonly<Record<string, unknown>>;
}
```

### How to register it

```ts
// service/router-dispatcher.service.ts
const adapters = [
  new LaravelRouteParser(),
  new SymfonyRouteParser(),
  // append yours here
];
const adapter = adapters.find((a) => a.detect(projectContext));
if (!adapter) throw new Error(`no router adapter for ${projectRoot}`);
return adapter.discover(projectContext);
```

### Concrete example: a Next.js adapter

```ts
// service/router-adapters/nextjs.parser.ts
export class NextJsRouteParser implements IRouterAdapter {
  readonly framework = "express"; // reuses the express family

  detect(ctx: IProjectContext): boolean {
    return existsSync(join(ctx.projectRoot, "next.config.js"));
  }

  async discover(ctx: IProjectContext): Promise<IRouteParseResult> {
    // Walk pages/api/**/*.{ts,tsx}, parse HTTP method exports
    return { routes: [...], formRequestByRoute: new Map() };
  }
}
```

### Acceptance

- The new file ships with at least 4 cases in `tests/unit/router-adapters/<framework>.parser.spec.ts`.
- The dispatcher picks it for a fresh `<framework>` host (assert with a test fixture).
- No regression on the existing Laravel / Symfony / Express / FastAPI / Django hosts.

---

## 3. Adding a tool to the MCP-vertex plugin

### Where the file lives

```
plugins/postman-exporter/src/lib/tools/<verb>.tool.ts
```

### The shape

```ts
// plugins/postman-exporter/src/lib/tools/<verb>.tool.ts
import { z } from "zod";
import type { IToolRegistration } from "@mcp-vertex/core/public";

export const <Verb>InputSchema = z.object({
  // ...declare every input field via Zod
});

export type I<Verb>Input = z.infer<typeof <Verb>InputSchema>;

export function build<V>ToolRegistration(
  workspaceRoot: string,
): IToolRegistration {
  return {
    id: "postman_exporter_<verb>",          // ← mcp-vertex prefixes
    name: "postman_exporter_<verb>",
    description: "…",                       // ≤ 240 chars
    inputSchema: <Verb>InputSchema,         // Zod schema → MCP inputSchema
    outputSchema: <Verb>OutputSchema,       // Zod schema → MCP outputSchema
    tags: ["postman", "postman-exporter"],
    register(server, handler) {
      server.tool(name, description, inputSchema, async (args) => {
        const input = <Verb>InputSchema.parse(args);
        return handler(input);
      });
    },
  };
}
```

### How to register it

```ts
// plugins/postman-exporter/src/index.ts
return {
  tools: [
    buildGenerateToolRegistration(workspaceRoot),
    build<V>ToolRegistration(workspaceRoot),  // ← append yours here
  ],
};
```

### Hard rules

- The tool **MUST NOT** read `process.cwd()`. Use `ctx.workspace.toString()` from `IMcpPluginContext`.
- The tool **MUST NOT** read `process.env` directly. All env values come through the plugin's `optionsSchema` (a Zod schema) or the tool's `inputSchema`.
- The tool **MUST** declare `inputSchema` and `outputSchema` via Zod. No `any`. No `z.any()`.
- The tool **MUST** return a discriminated output (the orchestrator pattern-matches on it).
- One tool per file. `*.tool.ts`.

### Acceptance

- `bun test plugins/postman-exporter/tests/integration/<verb>.tool.spec.ts` (new) is green.
- The tool is listed in `mcp-vertex_agent_catalog` → `plugins.postman-exporter.tools`.
- The orchestrator can route `postman-exporter-builder` (or another subagent) into your tool.

---

## 4. Adding an agent to the orchestrator catalog

### Where the file lives

```
.github/agents/<package>-<lane>.agent.md
```

### The shape

```yaml
---
name: <package>-<lane>
display-name: <Display Name> · <Lane>
icon: "$(<icon>)"
model: GPT-5.4
description: |
    Bounded subagent for <package>. <One-line role>.
tools: [read, search, execute?, mcp-project-mcp-vertex/*]
user-invocable: true
---

# <package>.<lane>

This file is the Copilot adapter; the long contract lives in
`docs/extension-contract.md`.

## Compact lane

1. First call `mcp-vertex_overview` once per turn. …
2. …

## Hard rules

- Never <forbidden action>.
- Never <forbidden action>.

## Failure mode

- If <error>, return <outcome>.
```

### How to discover it

The agent catalog auto-discovers `.github/agents/*.agent.md`. No
registration step is required.

### Hard rules

- The agent **MUST** declare its `tools` permission list. No `*` — be explicit.
- The agent **MUST** declare a lane (read-only / write / gate-keeper). No two agents share a lane.
- The agent **MUST** return a discriminated output that the orchestrator can pipe into `proposals_close_slice`.
- The agent **MUST NOT** call git plugin tools. Git is the orchestrator's lane.

### Acceptance

- `mcp-vertex_agent_catalog` lists the agent.
- `agent_message("<package>.<lane>")` returns the discriminated output without writing files (when read-only) or with the documented side effects (when write).

---

## 5. Adding a field to `ProjectConfig`

### Where the file lives

```
contract/project-config.interface.ts
```

### The shape

```ts
export const <Package>OptionsSchema = z.object({
  <field>: z.<type>().default(<value>).describe("<doc>"),
});
```

### How it propagates

- The plugin reads it from `ctx.options` in `register(ctx)`.
- The runner passes it through `IMcpPluginContext`.
- The host (mcp-vertex) reads it from `mcp-vertex.config.json#plugins.<plugin-name>.options`.

### Hard rules

- The field **MUST** be optional (`.default(...)`) unless the plugin is broken without it.
- The field **MUST** be self-describing (`.describe("<doc>")`).
- The field **MUST NOT** be `z.any()`. Use a concrete schema.

### Acceptance

- The plugin's existing tools work with the field unset (default value).
- A new tool that needs the field documents it in its `inputSchema`.

---

## 6. Cross-references

- The orchestrator lives in `.github/agents/postman-exporter-orchestrator.agent.md`.
- The manifest lives in `.github/agents.md`.
- The hard rule "no `process.cwd()` in tools" is enforced by a Bun script
  in `scripts/lint-tool-no-process.ts` (see p00011).
- The CI gate is `bun run check` (see `package.json#scripts.check`).
