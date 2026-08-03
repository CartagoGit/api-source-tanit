# `postman-exporter` — Agent bootstrap redirect

> **Source of truth:** this file is a **thin pointer**. The real agent
> contract lives in the upstream mcp-vertex monorepo:
>
> [`../../mcp-vertex/docs/mcp-vertex/AGENT-BOOTSTRAP.md`](../../mcp-vertex/docs/mcp-vertex/AGENT-BOOTSTRAP.md)
>
> All agent rules are there and apply **verbatim** to this workspace.
> This consumer never re-defines the rules itself.

## What `postman-exporter` contributes (consumer-specific)

The bootstrap above lets any agent orient via `mcp-vertex_overview` and
route work via `mcp-vertex_agent_catalog`. The unique tooling this
consumer ships is the `postman-exporter` plugin (declared in
[`mcp-vertex.config.json`](../../mcp-vertex.config.json) under
`plugins.postman-exporter`), which exposes three tools:

| MCP tool name | Purpose |
|---|---|
| `mcp-vertex_postman-exporter_generate` | Generate a Postman v2.1.0 collection from a Laravel host's routes. |
| `mcp-vertex_postman-exporter_validate` | Validate an existing collection against the schema + bidir coverage. |
| `mcp-vertex_postman-exporter_summary` | Inspect a Laravel host without writing artefacts. |

The plugin source lives at
[`plugins/postman-exporter/src/index.ts`](../../plugins/postman-exporter/src/index.ts).
It is **not published** — it is a local consumer plugin, edited in
place and consumed by mcp-vertex through the `./path` entry in the
config. Bun loads the `.ts` source directly at runtime (no `dist/`,
no `noEmit: false` flip, no `npm publish`).

## Local wiring (how mcp-vertex reaches this consumer)

`mcp-vertex.config.json` declares the plugin with a relative `path`:

```jsonc
"postman-exporter": {
  "path": "./plugins/postman-exporter/src/index.ts",
  "options": {
    "defaultProjectRoot": "${workspaceFolder}/..",
    "cliScript":         "${workspaceFolder}/scripts/cli.script.ts"
  }
}
```

The loader resolves the path against the workspace root, so the plugin
is found regardless of which directory the mcp-vertex server is
spawned from. The plugin then imports `@mcp-vertex/core` via the
symlink at `node_modules/@mcp-vertex/core` (a symlink to
`mcp-vertex/packages/core`).

## Quality gate

The `proposals` plugin reads `plugins.proposals.options.validationCommand`
from this config (currently `bun run check`). That script runs the
project's diff + JSON-validation scripts and is the canonical gate
the agent must pass before closing a slice.

## When in doubt

Ask the upstream bootstrap. Do not hardcode tool names, skill ids or
proposal ids in this consumer — they live in the live server catalog.
