# VS Code workspace extras

## `mcp.json`

`servers.mcp-vertex` currently launches a **temporary pre-publish** host
script via a **relative sibling path**:

```text
../mcp-vertex/tools/scripts/host/host-server.script.ts
```

That path is only for local developers who also have an `mcp-vertex`
checkout next to this repo. It is **not** required to clone or use this
project elsewhere.

**Canonical form (when `@mcp-vertex/cli` is on npm):**

```json
{
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
```

See `docs/mcp-vertex/AGENT-BOOTSTRAP.md` §3.7. Never commit absolute
machine paths (`/home/...`).
