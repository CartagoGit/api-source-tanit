---
id: x00089
title: "Fijar el runtime DelendAI 0.3.0 sin depender del checkout develop"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: b557ceaa-57ba-4987-a519-fa2b92357003
last-correlation-id: b557ceaa-57ba-4987-a519-fa2b92357003
last-transition-from: in-progress
last-transition-at: 2026-11-09T07:28:29.065Z
---

# x00089 — Fijar el runtime DelendAI 0.3.0 sin depender del checkout develop

## goal

Arrancar el MCP y CLI desde el commit inmutable de v0.3.0, con configuración portable y verificación antes de ejecutar.

## why

El ejecutable global delendai usa un checkout móvil develop; server.version no demuestra qué código se ejecuta. El producto debe seguir siendo agnóstico.

## non-goals

- No actualizar el runtime a develop ni cambiar la instalación global de otros proyectos.
- No incorporar DelendAI al runtime del producto Tanit.

## slices

- global_gate: e2e

### S1 — Runtime fijado y configuración MCP derivada
- **Status**: done
- **Files**: `.mcp.json`, `.vscode/mcp.json`, `.codex/config.toml`, `scripts/gates/sync-mcp-config.script.ts`, `scripts/gates/lint-root-allowlist.script.ts`, `scripts/integrations/delendai-runtime.json`, `scripts/integrations/delendai-runtime.sh`, `scripts/integrations/bin/delendai`, `tests/scripts-gates/delendai-runtime.spec.ts`, `tests/scripts-gates/lint-mcp-config.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`, `integrations/delendai/README.md`, `integrations/delendai/package.json`
- **Gate**: e2e
- acceptance:
  - "El lanzador rechaza un checkout cuyo HEAD difiera del commit v0.3.0."
  - "El MCP no ejecuta un sibling develop ni descarga silenciosamente versiones distintas."
  - "Tanit funciona sin DelendAI; la integración es optativa."
- shipped-in: `ec9d1c9bf570`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- El lanzador rechaza un checkout cuyo HEAD difiera del commit v0.3.0.
- El MCP no ejecuta un sibling develop ni descarga silenciosamente versiones distintas.
- Tanit funciona sin DelendAI; la integración es optativa.

## validation evidence

- Ten targeted tests pass, including a real isolated Git installation, same-version commit drift, dirty code and dependency resolution rejection.
- Real MCP initialize handshake succeeds against the exact v0.3.0 commit; startup loads the Tanit plugin. The upstream tag still reports serverInfo/CLI version 0.1.0; the immutable SHA and core manifest are authoritative.
- Host git guard and ignored core dependency now resolve to the pinned installation, preserving enforcement.

- User-required command `delendai __serve ... --version=0.3.0` is identical across MCP clients, with host-specific path syntax generated from one source. Actual VS Code command completes initialize plus overview RPC successfully; Codex CLI resolves canonical server enabled and inherited generic server disabled.
