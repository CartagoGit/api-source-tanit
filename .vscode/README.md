# VS Code workspace extras

## `mcp.json`

`servers.delendai` currently launches a **temporary pre-publish** host
script via a **relative sibling path**:

```text
../delendai/tools/scripts/host/host-server.script.ts
```

That path is only for local developers who also have an `delendai`
checkout next to this repo. It is **not** required to clone or use this
project elsewhere.

**Canonical form (when `@delendai/cli` is on npm):**

```json
{
  "type": "stdio",
  "command": "bunx",
  "args": [
    "--package",
    "@delendai/cli",
    "mcpv",
    "__serve",
    "--workspace=${workspaceFolder}",
    "--config=${workspaceFolder}/delendai.config.json"
  ]
}
```

See `docs/delendai/AGENT-BOOTSTRAP.md` §3.7. Never commit absolute
machine paths (`/home/...`).
