---
id: x00077
title: "El MCP de delendai corre la rama main de delendai"
kind: fix
status: ready
type: proposal
track: infra
date: 2026-11-02
---

# x00077 — El MCP de delendai corre la rama main de delendai

## goal

El servidor MCP de este proyecto ejecuta la rama main de delendai con --branch=main, así que el trabajo en curso en el checkout de delendai no lo reinicia ni le cambia el código.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — S1
- **Status**: pending
- **Files**: `.mcp.json`, `.vscode/mcp.json`
- **Gate**: none

## acceptance

- TODO: observable acceptance criteria.
