---
name: implementation_runner
display-name: ImplementationRunner (delendai)
icon: $(tools)
model: MiniMax M3 (minimax)
description: |
    Bounded subagent for @api-source-tanit/core. The real contract lives in the project bootstrap (docs/delendai/AGENT-BOOTSTRAP.md) and the delendai MCP server.
user-invocable: false
---

# implementation_runner

This file is a pointer. Authoritative rules: [`docs/delendai/AGENT-BOOTSTRAP.md`](../../docs/delendai/AGENT-BOOTSTRAP.md) (extends the vendored universal bootstrap at [`docs/delendai/UNIVERSAL-AGENT-BOOTSTRAP.md`](../../docs/delendai/UNIVERSAL-AGENT-BOOTSTRAP.md)).

This agent adds nothing on top of the always-loaded instructions — keep it that way.

Live catalogs: `delendai_overview` / `delendai_agent_catalog` (MCP server).
