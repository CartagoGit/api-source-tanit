---
id: x00089
title: "Fijar el runtime DelendAI 0.3.0 sin depender del checkout develop"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-09
---

# x00089 — Fijar el runtime DelendAI 0.3.0 sin depender del checkout develop

## goal

Arrancar el MCP y CLI desde el commit inmutable de v0.3.0, con configuración portable y verificación antes de ejecutar.

## why

El ejecutable global delendai usa un checkout móvil develop; server.version no demuestra qué código se ejecuta. El producto debe seguir siendo agnóstico.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: e2e

### S1 — Runtime fijado y configuración MCP derivada
- **Status**: pending
- **Files**: `.mcp.json`, `.vscode/mcp.json`, `scripts/`, `tests/scripts-gates/`, `docs/delendai/AGENT-BOOTSTRAP.md`, `integrations/delendai/README.md`
- **Gate**: e2e
- acceptance:
  - "El lanzador rechaza un checkout cuyo HEAD difiera del commit v0.3.0."
  - "El MCP no ejecuta un sibling develop ni descarga silenciosamente versiones distintas."
  - "Tanit funciona sin DelendAI; la integración es optativa."

## acceptance

- El lanzador rechaza un checkout cuyo HEAD difiera del commit v0.3.0.
- El MCP no ejecuta un sibling develop ni descarga silenciosamente versiones distintas.
- Tanit funciona sin DelendAI; la integración es optativa.
