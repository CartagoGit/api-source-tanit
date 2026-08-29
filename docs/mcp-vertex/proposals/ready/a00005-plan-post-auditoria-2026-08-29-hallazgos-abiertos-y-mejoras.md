---
id: a00005
title: "Plan post-auditoría 2026-08-29: hallazgos abiertos y mejoras"
kind: audit
status: ready
type: proposal
track: export-to-postman
date: 2026-08-30
---

# a00005 — PLAN post-auditoría 2026-08-29/30: hallazgos abiertos y mejoras

> **Documento padre de las propuestas abiertas** nacidas de la auditoría
> vigente (`docs/mcp-vertex/AUDIT-2026-08-29.md`) y de su primera pasada
> de ejecución (commits `226d97a`…`91cc968`, 2026-08-29/30). Este repo no
> usa kind `plan` en el sistema de propuestas, así que el plan vive aquí,
> dentro del árbol de propuestas, y las propuestas hijas lo referencian
> por id.

## Snapshot base

- `TARGET_PROJECT_ROOT`: `/home/cartago/_projects/export-to-postman`
- Rama `develop`; la auditoría cerró sobre `4b84…→1b84ffc`; la primera
  ejecución de este plan dejó `develop` en `91cc968` con `validate` exit 0
  (128 ficheros / 2.584 tests, cobertura 83,1/72,0/87,8/84,8, bench plano
  ×0.78).

## Estado de los hallazgos F-xxx

| ID | Título | Estado | Evidencia |
|---|---|---|---|
| F-001 | Umbrales de cobertura sin ejecutar | **cerrado** | `b5d700b` (AUDIT-2026-08-29) |
| F-002 | Propuesta done con ficheros inexistentes | **cerrado** | `f967468` (AUDIT-2026-08-29) |
| F-003 | `bench:check` no vigilaba nada | **cerrado** | `f967468` + `t00003` |
| F-004 | Trabajo done viviendo en ready/ | **cerrado** | `901dfe8` (AUDIT-2026-08-29) |
| F-005 | Config MCP apunta a checkout hermano | abierto, **bloqueado** por `p00007` | AUDIT-2026-08-29 §3 |
| F-006 | Deuda: branches + reentrancia singleton | **parcialmente cerrado** | branches: `t00004` (64,2→72 %, suelo 70). Reentrancia: `r00008` (abierta) |
| F-007 | Duplicado huérfano de propuesta en ready/ | **cerrado** | residuo untracked borrado; `lint:proposals` verde |
| F-008 | Drift `.vscode/mcp.json` vs fuente única | **cerrado** | `226d97a` + `9d74ca0` (—watch pedido por el dueño, fijado en la fuente) |
| F-009 | Symfony registra el mismo endpoint dos veces (`resource:` + directorio) | **cerrado** | `f515645`; test del lote `t00004` |

## Propuestas hijas (orden de ejecución)

| Orden | ID | Título | Hallazgos | Dependencias |
|---|---|---|---|---|
| 1 | `x00007` | param-inferrer: sufijos camelCase muertos + `query: []` | F-006 (residuo t00004) | ninguna — lista |
| 2 | `r00008` | contexto explícito en los 3 lectores del singleton | F-006 | tras `x00007` (estructura, no ficheros) |
| 3 | `c00002` | release automatizada de npm desde CI | riesgo operativo #4 | ninguna (paralelizable con 1-2) |
| 4 | `a00004` | auditoría de la zona Rust de escritorio | riesgo #5 | independiente |
| 5 | (F-005) | borrar el path hermano de la config MCP | F-005 | **bloqueado** hasta desbloquear `p00007` |

## Criterios de éxito del plan

- Cada propuesta hija cerrada con su gate verde y evidencia en su fichero.
- `bun run validate` en exit 0 antes y después de cada integración.
- Ninguna propuesta hija mezcla dominios: fix de producto, refactor de
  arquitectura, infra de release y auditoría van por separado.
- F-005 solo se cierra junto a `p00007` (fuera de mano hasta entonces).

## Registro de ejecución

- 2026-08-30: `t00004` cerrada (91cc968) — branches 64,22→72,00 %, suelo 62→70.
- 2026-08-30: `f515645` cierra F-009; `9d74ca0` cierra F-008; `226d97a` y
  limpieza cierran F-007. Plan creado con las 4 propuestas hijas listadas.
