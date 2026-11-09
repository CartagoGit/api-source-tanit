---
id: x00083
title: "Canonical DelendAI:Tanit identity, portable MCP configuration and active rename residue cleanup"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: e16ce739-ffa0-48cc-a150-06935e0aaae9
last-correlation-id: e16ce739-ffa0-48cc-a150-06935e0aaae9
last-transition-from: in-progress
last-transition-at: 2026-11-08T13:45:30.217Z
shipped-in:
  - "44a9237b01db93db8f15bc57e734c4ae2b9de684"
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
- review-log: approved by openai-gpt-6-luna — verified at 44a9237b01db, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 5/5: (1) Reviewed .mcp.json and lint-mcp-server-key/lint-mcp-config regression tests, including rejection of a colon key for another project. (2) Reviewed the PATH launcher and MCP startup evidence; initialize/tools/list returned the loaded Tanit project. (3) Reviewed proposal catalog recovery: 172 done plus 4 retired equals the 176 historical records; archived states are retained. (4) Reviewed CONTRIBUTING.md, active AGENT-BOOTSTRAP.md, and generated API documentation for canonical naming and standalone setup. (5) Reviewed active residue inventory/migration and preservation evidence; the historical catalogue remains intact. — Independent review at landed develop source 44a9237b01db93db8f15bc57e734c4ae2b9de684. Reused actual governed validation from the prior review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975, two platform skips; journal timestamp 2026-11-09T15:37:21.268Z at the prior unit path .cache/delendai/results/logs/validate.jsonl. It was not rerun in this unit. Tracked source diff from validated 3e02acdb to this snapshot is empty outside proposal metadata. Fresh lint:docs and lint:proposals both pass. Verdict: independent source review; no changes requested.

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
