---
id: x00010
title: "Evitar bloqueos y escrituras inseguras en desktop y init MCP"
kind: fix
status: ready
type: proposal
track: general
date: 2026-08-30
---

# x00010 — Evitar bloqueos y escrituras inseguras en desktop y init MCP

## Goal

TODO: describe the goal.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## Slices

- global_gate: none

### S1 — Timeout del sidecar
- **Status**: pending
- **Files**: `packages/desktop/src/main.rs`, `packages/desktop/tests`
- **Gate**: none

### S2 — Contención de init
- **Status**: pending
- **Files**: `packages/plugins/mcp-vertex_expostman/src/lib/tools/init.tool.ts`, `packages/plugins/mcp-vertex_expostman/src/lib/helpers/runner.helper.ts`, `packages/cli/commands/init.script.ts`, `tests/cli/output-containment.spec.ts`
- **Gate**: none

## acceptance

- TODO: observable acceptance criteria.
