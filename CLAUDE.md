# CLAUDE.md — working in `@api-source-tanit/core`

> **Project bootstrap:** [`docs/delendai/AGENT-BOOTSTRAP.md`](docs/delendai/AGENT-BOOTSTRAP.md).
> Read that file once per session — it is the **only** place project
> rules live. It extends the **vendored universal bootstrap** at
> [`docs/delendai/UNIVERSAL-AGENT-BOOTSTRAP.md`](docs/delendai/UNIVERSAL-AGENT-BOOTSTRAP.md)
> (copied from upstream `@delendai/core`; no sibling checkout required).
> Read the universal first, then the project one. Project rules
> override universal rules only where explicitly marked.
>
> **Host appendix in effect:** §8.2 (Claude Code — keep the main thread cheap).

This file is a pointer. All content lives in the project bootstrap.

Live tool / skill / proposal catalogs come from the MCP server
(`delendai_overview`, `delendai_agent_catalog`) — not from files
outside this repository.
