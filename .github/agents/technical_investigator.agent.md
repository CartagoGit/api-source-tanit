---
name: technical_investigator
display-name: TechnicalInvestigator (delendai)
icon: $(tools)
model: MiniMax M3 (minimax)
description: |
    Bounded subagent for @export-to-postman/core. The real contract lives in the project bootstrap (docs/delendai/AGENT-BOOTSTRAP.md) and the delendai MCP server.
user-invocable: false
---

# technical_investigator

This file is a pointer. Authoritative rules: [`docs/delendai/AGENT-BOOTSTRAP.md`](../../docs/delendai/AGENT-BOOTSTRAP.md) (extends the vendored universal bootstrap at [`docs/delendai/UNIVERSAL-AGENT-BOOTSTRAP.md`](../../docs/delendai/UNIVERSAL-AGENT-BOOTSTRAP.md)).

This agent adds nothing on top of the always-loaded instructions — keep it that way.

Live catalogs: `delendai_overview` / `delendai_agent_catalog` (MCP server).
