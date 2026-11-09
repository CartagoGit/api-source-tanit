---
id: x00089
title: "Fijar el runtime DelendAI 0.3.0 sin depender del checkout develop"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 6a2d337f-e72c-4f26-8512-006a1309ab71
last-correlation-id: 6a2d337f-e72c-4f26-8512-006a1309ab71
last-transition-from: in-progress
last-transition-at: 2026-11-09T07:38:08.785Z
shipped-in:
  - "bebadb7005b46141961d4924c96e8a97268ad2d5"
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
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at bebadb7005b4, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed the immutable runtime launcher and isolated-Git drift tests for rejecting an unexpected HEAD. (2) Reviewed runtime resolution and MCP startup checks for pinned v0.3.0 source, with no sibling-develop fallback. (3) Reviewed optional integration configuration and CLI/MCP startup paths; Tanit core remains usable without the DelendAI runtime. — Independent review at landed develop snapshot bebadb7005b46141961d4924c96e8a97268ad2d5. Reused the actual governed validation from the previous review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975, two platform skips; journal timestamp 2026-11-09T15:37:21.268Z at the prior unit path .cache/delendai/results/logs/validate.jsonl. It was not rerun in G4. Tracked source diff from validated 3e02acdb to this snapshot is empty outside proposal metadata. Fresh lint:docs and lint:proposals pass. Independent source review; no changes requested.

## acceptance

- El lanzador rechaza un checkout cuyo HEAD difiera del commit v0.3.0.
- El MCP no ejecuta un sibling develop ni descarga silenciosamente versiones distintas.
- Tanit funciona sin DelendAI; la integración es optativa.

## validation evidence

- Ten targeted tests pass, including a real isolated Git installation, same-version commit drift, dirty code and dependency resolution rejection.
- Real MCP initialize handshake succeeds against the exact v0.3.0 commit; startup loads the Tanit plugin. The upstream tag still reports serverInfo/CLI version 0.1.0; the immutable SHA and core manifest are authoritative.
- Host git guard and ignored core dependency now resolve to the pinned installation, preserving enforcement.

- User-required command `delendai __serve ... --version=0.3.0` is identical across MCP clients, with host-specific path syntax generated from one source. Actual VS Code command completes initialize plus overview RPC successfully; Codex CLI resolves canonical server enabled and inherited generic server disabled.
