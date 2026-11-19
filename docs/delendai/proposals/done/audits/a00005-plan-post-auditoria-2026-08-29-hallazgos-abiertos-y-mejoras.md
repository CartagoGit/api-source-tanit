---
id: a00005
title: "Plan post-auditoría 2026-08-29: hallazgos abiertos y mejoras"
kind: audit
status: done
type: proposal
track: export-to-postman
date: 2026-08-30
---

# a00005 — Plan post-auditoría 2026-08-29/30: hallazgos abiertos y mejoras

> **Documento padre de las propuestas abiertas** nacidas de la auditoría
> vigente (`a00005`) y de su primera pasada
> de ejecución (commits `226d97a`…`91cc968`, 2026-08-29/30). Este repo no
> usa kind `plan` en el sistema de propuestas, así que el plan vive aquí,
> dentro del árbol de propuestas, y las propuestas hijas lo referencian
> por id.

## Snapshot base

- `TARGET_PROJECT_ROOT`: `/home/cartago/_projects/export-to-postman`
- Rama `develop`; este snapshot se actualiza el 2026-08-30 sobre el trabajo
  local de contexto explícito. Las pruebas estáticas de los slices tocados
  no reportan errores en el editor; la salida de Vitest/Bun sigue sin ser
  observable en este host y no se declara verde por ese motivo.

## Estado de los hallazgos F-xxx

| ID | Título | Estado | Evidencia |
|---|---|---|---|
| F-001 | Umbrales de cobertura sin ejecutar | **cerrado** | `b5d700b` (`a00005`) |
| F-002 | Propuesta done con ficheros inexistentes | **cerrado** | `f967468` (`a00005`) |
| F-003 | `bench:check` no vigilaba nada | **cerrado** | `f967468` + `t00003` |
| F-004 | Trabajo done viviendo en ready/ | **cerrado** | `901dfe8` (`a00005`) |
| F-005 | Config MCP apunta a checkout hermano | abierto, **bloqueado** por `p00007` | `a00005` §3 |
| F-006 | Deuda: branches + reentrancia singleton | **parcialmente cerrado** | branches: `t00004` (64,2→72 %, suelo 70). Reentrancia: `r00008` (código y callers migrados a contexto explícito; cierre formal pendiente) |
| F-007 | Duplicado huérfano de propuesta en ready/ | **cerrado** | residuo untracked borrado; `lint:proposals` verde |
| F-008 | Drift `.vscode/mcp.json` vs fuente única | **cerrado** | `226d97a` + `9d74ca0` (—watch pedido por el dueño, fijado en la fuente) |
| F-009 | Symfony registra el mismo endpoint dos veces (`resource:` + directorio) | **cerrado** | `f515645`; test del lote `t00004` |

## Slices

- global_gate: lint

### S1 — Mantener el mapa de hallazgos y dependencias
- **Status**: done
- **Files**: `docs/delendai/audits/`, `docs/delendai/proposals/INDEX.md`
- **Gate**: lint
- acceptance:
  - "Los hallazgos abiertos y cerrados tienen evidencia y propuesta de destino."
  - "Las propuestas hijas se referencian por id, nunca por una ruta mutable."

### S2 — Coordinar el cierre de las propuestas hijas
- **Status**: done
- **Files**: `docs/delendai/proposals/ready/*.md`, `docs/delendai/proposals/in-progress/*.md`
- **Gate**: none
- acceptance:
  - "Cada propuesta hija conserva su propio kind, estado, slices y gate."
  - "El plan no duplica trabajo de fixes, refactors, chores o auditorías hijas."

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

- 2026-08-30: `x00007` cerrada (be5d67d) — fixes de param-inferrer; el
  subagente entregó también un fix de rutas relativas en `summary.tool.ts`
  (fuera de sello, aceptado con su test de regresión Suite plugin 118.
- 2026-08-30: `t00004` cerrada (91cc968) — branches 64,22→72,00 %, suelo 62→70.
- 2026-08-30: `f515645` cierra F-009; `9d74ca0` cierra F-008; `226d97a` y
  limpieza cierran F-007. Plan creado con las 4 propuestas hijas listadas.
- 2026-08-30: `r00008` — migrados loader, generación, UI, push, Laravel y
  watch a `IProjectContext`; eliminada la cola global de `paths.service`.
  Tests de loader y scopes ajustados al contrato explícito; cierre formal
  pendiente de la revisión de propuesta y de una ejecución visible de gates.
- 2026-08-30: `c00002` — añadido `.github/workflows/release-npm.yml`, disparado
  sólo por tags `v*.*.*`, con `validate`, `validate:package` y
  `npm publish --provenance` usando `NPM_TOKEN`.
- 2026-08-30: `a00004` — resultado de la auditoría desktop incorporado en la
  propuesta canónica; no queda un informe paralelo fuera del índice.
  La pasada estática clasifica D-001 como MEDIUM y D-002/D-003 como LOW;
  no se encontró CRITICAL/HIGH. El build nativo queda condicionado a Rust,
  Tauri CLI y SDKs/dependencias de plataforma.

> **Cerrada 2026-08-30.** El mapa de hallazgos quedó actualizado y las
> propuestas hijas no bloqueadas tienen estado y evidencia coherentes.
> `p00007` permanece `blocked` porque depende de consumir un paquete
> `@delendai/core` publicado; ese bloqueo no se resuelve desde este repo.
