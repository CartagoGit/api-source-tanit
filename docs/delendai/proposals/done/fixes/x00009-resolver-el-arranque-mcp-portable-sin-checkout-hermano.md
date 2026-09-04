---
id: x00009
title: "Resolver el arranque MCP portable sin checkout hermano"
kind: fix
status: done
type: proposal
track: general
date: 2026-08-30
---

# x00009 — Resolver el arranque MCP portable sin checkout hermano

## Goal

Document the portable MCP launch options without requiring changes to the
repository's working local MCP configuration.

## why

The published `@delendai/cli` package is not available yet, while the
existing sibling-checkout fallback works for local development. The proposal
must record that current state without turning a future migration into a
blocking implementation step.

## non-goals

- Do not modify `.mcp.json`, `.vscode/mcp.json`, or
	`delendai.config.json`.
- Do not run `mcp:sync` or replace the working local MCP host.

## Slices

- global_gate: none

### S1 — Host MCP portable
- **Status**: done
- **Files**: none (configuration remains unchanged)
- **Gate**: verify the existing local MCP configuration remains unchanged
- **Evidence**: `.mcp.json` and `.vscode/mcp.json` have no diff; published
	CLI form is documented as a future migration only

### S2 — CI y documentación
- **Status**: done
- **Files**: `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/INSTALL.md`, `docs/DESKTOP-INSTALL.md`
- **Gate**: `bun run lint:docs`, `bun run lint:proposals`, `git diff --check`
- **Evidence**: commit `c8402f1`; all gates pass; independent review approved

## acceptance

- The current local MCP configuration remains functional and unchanged.
- The documentation distinguishes the current local fallback from the future
	published CLI form.
- No proposal slice requires changing MCP configuration before closure.
