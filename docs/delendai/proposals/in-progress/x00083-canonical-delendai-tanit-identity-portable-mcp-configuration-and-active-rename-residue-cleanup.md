---
id: x00083
title: "Canonical DelendAI:Tanit identity, portable MCP configuration and active rename residue cleanup"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 0d4f679e-71a2-41b4-90de-eaef95fe8779
last-correlation-id: 0d4f679e-71a2-41b4-90de-eaef95fe8779
last-transition-from: ready
last-transition-at: 2026-11-08T03:38:25.851Z
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
