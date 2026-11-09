---
id: x00083
title: "Canonical DelendAI:Tanit identity, portable MCP configuration and active rename residue cleanup"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 46571055-59ab-4497-b1f3-24213f131d6d
last-correlation-id: 46571055-59ab-4497-b1f3-24213f131d6d
last-transition-from: review
last-transition-at: 2026-11-09T15:42:30.686Z
shipped-in:
  - "e68c48cef4b942c50ef5b70eeafc22f92e21ea1c"
---

# x00083 — Canonical DelendAI:Tanit identity, portable MCP configuration and active rename residue cleanup

## goal

Registrar DelendAI:Tanit en la configuración canónica y sus agentes; arrancar mediante el CLI instalado; eliminar referencias activas obsoletas y recuperar la lectura del catálogo.

## why

El nombre MCP y los permisos divergían de la identidad solicitada; el validador omitía nombres con dos puntos. Diez propuestas archivadas tienen frontmatter incompleto y desaparecen del catálogo; el bootstrap y los imports generados conservan la marca anterior.

## non-goals

- Conservar estados, títulos y evidencia histórica de las propuestas archivadas.
- La estructura YAML corrupta se repara sin reabrir trabajo cerrado.

## slices

- global_gate: none

### S1 — Identidad, permisos y catálogo válidos
- **Status**: done
- **Files**: `.mcp.json`, `.github/agents/`, `scripts/gates/lint-mcp-server-key.script.ts`, `scripts/gates/sync-mcp-config.script.ts`, `tests/scripts-gates/lint-mcp-server-key.spec.ts`, `tests/scripts-gates/lint-mcp-config.spec.ts`, `CONTRIBUTING.md`, `docs/delendai/AGENT-BOOTSTRAP.md`, `scripts/build/api-reference.script.ts`, `docs/API.md`, `docs/delendai/proposals/`
- **Gate**: e2e
- shipped-in: `077077a01bfa`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at e68c48cef4b9, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 5/5: (1) Reviewed .mcp.json and MCP key/config gate tests for canonical identity and invalid colon-key rejection; fresh full governed validation passed. (2) Reviewed the portable PATH launcher and startup checks; initialize/tools/list behavior is covered by focused MCP evidence and current validation. (3) Reviewed catalog recovery and migration; proposal inventory reports 172 done and 4 retired, preserving states. (4) Reviewed active bootstrap and generated API docs for canonical repository naming and standalone setup. (5) Reviewed residue inventory/migration behavior and preservation checks; current full governed validation passed. — Independent source review of merged develop snapshot e68c48c; fresh validation in this review unit at 3e02acdb passed. Journal pass 2026-11-09T15:37:21.268Z. Counts 4917 Vitest + 15 SQLite + 41 transport; 2 platform skips.

## acceptance

- La configuración registra DelendAI:Tanit y los cinco grants usan su referencia de host delendai:tanit/*; un grant con dos puntos a otro proyecto falla.
- El MCP arranca por PATH y responde initialize/tools/list con Tanit cargado.
- El catálogo vuelve a incluir las 176 propuestas históricas, sin cambios de estado.
- La documentación activa usa api-source-tanit y no exige un checkout hermano.
- Los residuos locales quedan inventariados y migrados conservando datos.

## Validation evidence

- MCP stdio initialize/tools/list/overview: Tanit loaded; SIGTERM 143.
- Restart preserves canonical config and all five normalized grants.
- 22 focused MCP/frontmatter tests pass; output cleanup passes 109 focused tests.
- Historical proposal catalog recovered: 172 done + 4 retired.
- Full project gate runs before publication.
