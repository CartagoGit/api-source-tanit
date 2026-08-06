---
name: implementation-runner
description: Bounded subagent for @postman-exporter/core. The real contract lives in the project bootstrap (docs/mcp-vertex/AGENT-BOOTSTRAP.md) and the mcp-vertex MCP server — use for any non-trivial change (more than 3 tool calls, multiple files, or repeated MCP reads).
---

# Implementation Runner (mcp-vertex)

This file is a pointer. Authoritative rules: [`docs/mcp-vertex/AGENT-BOOTSTRAP.md`](../../docs/mcp-vertex/AGENT-BOOTSTRAP.md) (extends the vendored universal bootstrap at [`docs/mcp-vertex/UNIVERSAL-AGENT-BOOTSTRAP.md`](../../docs/mcp-vertex/UNIVERSAL-AGENT-BOOTSTRAP.md)).

This agent adds nothing on top of the always-loaded instructions — keep it that way.

Live catalogs: `mcp-vertex_overview` / `mcp-vertex_agent_catalog` (MCP server).
