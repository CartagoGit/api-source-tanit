---
id: t00004
title: "branches de scanners: fixtures dirigidos para subir el suelo (62→70)"
kind: test
status: done
type: proposal
track: export-to-postman
date: 2026-08-29
related:
  - t00002
  - t00003
---

# t00004 — branches de scanners: fixtures dirigidos para subir el suelo (62→70)

## Goal

Subir la cobertura de branches del suite del **64,2 % al 70 %** con
fixtures que recorran los `else` que los scanners y servicios de
frameworks solo toman ante formas de código ajeno que ningún fixture
provoca hoy, y después subir el suelo de branches de `vitest.config.ts`
de 62 a 70 para que el nuevo margen no se erosione en silencio.

## why

La auditoría de 2026-08-29 deja branches como el punto más fino del
gate cuantitativo (F-006): 64,2 % contra suelo 62 — 2,2 puntos de
margen. La deuda está localizada y medida (`build/coverage/coverage-summary.json`):

| Área | Branches sin cubrir | % actual |
|---|--:|--:|
| `packages/frameworks/scanners/*` | 647 | 73,2 % |
| `packages/frameworks/laravel/*` | 335 | 44,3 % |
| `packages/core/domain|discovery|exporters|helpers|adapters` | 561 | ~66 % |

Dentro de `laravel`, los dos peores son `endpoint-discovery.service.ts`
(0,9 %, 115 sin cubrir) y `route-parser.service.ts` (6,8 %, 41) —
código caliente con tests casi nulos. Para el 70 % hacen falta ~333
branches cubiertas nuevas; las tres áreas de arriba suman 1.543
descubiertas, así que el objetivo es alcanzable sin inventar código ni
tocar umbrales antes de demostrarlos.

## non-goals

- Reescribir scanners: la auditoría vigente lo prohíbe explícitamente
  ("se paga con fixtures, no con refactor").
- Perseguir el 100 %: los scanners parsean código de terceros con
  formas infinitas; los suelos son medidos, no aspiracionales.
- Cobertura de los comandos CLI (`packages/cli`, 458 branches
  descubiertas): es deuda de tests de integración/distinta naturaleza;
  si se quiere, otra propuesta.
- Tocar el suelo en `vitest.config.ts` antes de que la nueva medida se
  demuestre sostenida en la cadena de `validate`.

## Slices

- global_gate: test

### S1 — Baseline medida por fichero
- **Status**: done
- **Files**: `build/coverage/coverage-summary.json` (artefacto, no código)
- **Gate**: none
- acceptance:
  - "Queda escrito en esta propuesta qué ficheros concentran la deuda y con qué números"
- evidence (`orchestrator`, 2026-08-29): la tabla de `## why` se obtuvo de
  `bunx vitest run --coverage` sobre `9d74ca0` (validate verde: 125
  ficheros, 2.388 tests, branches 64,22 % = 3.711/5.778).

### S2 — Fixtures de branches para `laravel`
- **Status**: done
- **Files**: `tests/frameworks/laravel/**.spec.ts`, fixtures bajo `tests/fixtures/`
- **Gate**: test
- acceptance:
  - "endpoint-discovery.service.ts y route-parser.service.ts suben de branches sin que ningún test existente se debilite"
  - "Cada test nuevo recorre un `else` concreto de una forma de código real (no mock de internals)"
  - "`bun run validate` verde con los tests nuevos dentro"
- evidence (`orchestrator`, 2026-08-30): endpoint-discovery 0,86 % → **79,31 %**
  (116 → 24 branches sin cubrir), route-parser 6,81 % → **88,63 %** (44 → 5),
  catalog-enricher 30,3 % → **75,75 %** (66 → 16), form-request-parser
  58,8 % → **70,14 %**. Suite frameworks 31 ficheros / 785 tests verdes;
  `validate` exit 0 con el lote dentro (2.505 tests).

### S3 — Fixtures de branches para `scanners/*`
- **Status**: done
- **Files**: `tests/frameworks/**.spec.ts`, fixtures bajo `tests/fixtures/`
- **Gate**: test
- acceptance:
  - "Las branches sin cubrir de `packages/frameworks/scanners/` bajan de 647"
  - "Los fixtures provienen de formas de código reales de los ejemplos o de variaciones mínimas de estas"
- evidence (`orchestrator`, 2026-08-30): openapi 73,1 % → **86,81 %**,
  django 65,9 % → **81,10 %**, symfony 68,5 % → **87,80 %** (además con el
  fix de duplicados F-009 cazado por el test nuevo: commit `f515645`).
  Branches global 64,22 % → **69,45 %** (4.021/5.789). `validate` exit 0.

### S4 — Fixtures de branches para `core/*` (domain, discovery, exporters)
- **Status**: done
- **Files**: `tests/core/**.spec.ts`
- **Gate**: test
- acceptance:
  - "Las branches sin cubrir de `packages/core/*` bajan de 561"
  - "Ningún cambio de comportamiento: solo tests y fixtures"
- evidence (`orchestrator` + `implementation-runner`, 2026-08-30): 90 tests
  nuevos en `tests/core/{param-inferrer,project-loader,exporters}.branches.spec.ts`
  (rutas de error, fallback y bordes, fixtures reales). Branches de core suben
  con el lote: global 69,45 % → **72,00 %** (4.160/5.777). Dos defectos de
  param-inferrer quedaron fijados en test con comentario (sufijos camelCase
  muertos; `query: []` que bloquea la inferencia) sin cambiar comportamiento.

### S5 — Subir el suelo de branches de 62 a 70 y verificarlo en la cadena
- **Status**: done
- **Files**: `vitest.config.ts`
- **Gate**: test
- acceptance:
  - "`vitest.config.ts` exige branches >= 70"
  - "`bun run validate` falla si se introduce una regresión que baje del nuevo suelo"
  - "La propuesta se cierra con la medida final escrita en evidencia"
- evidence (`orchestrator`, 2026-08-30): `vitest.config.ts` exige branches >= 70;
  `bun run validate` completo → **exit 0** con 72,00 % medidos (2 puntos de
  margen) y bench plano ×0.78. Commit `fc4e8f8`.

## acceptance

- "Branches total >= 70 % medida por `bun run test:coverage` dentro de `validate`"
- "El suelo de branches en `vitest.config.ts` sube a 70"
- "Ningún test existente debilitado ni borrado para subir el número"
- "`bun run validate` verde al cierre, con la cadena completa"
