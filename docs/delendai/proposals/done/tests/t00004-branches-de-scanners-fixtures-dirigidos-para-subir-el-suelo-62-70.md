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
| `projects/frameworks/scanners/*` | 647 | 73,2 % |
| `projects/frameworks/laravel/*` | 335 | 44,3 % |
| `projects/core/domain|discovery|exporters|helpers|adapters` | 561 | ~66 % |

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
- Cobertura de los comandos CLI (`projects/cli`, 458 branches
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
  - "`endpoint-discovery.service.ts` y `route-parser.service.ts` suben de branches sin que ningún test existente se debilite"
  - "Cada test nuevo recorre un `else` concreto de una forma de código real (no mock de internals)"
  - "`bun run validate` verde con los tests nuevos dentro"
- review-state: done
- review-implementer: implementation_runner
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Criterios cumplidos. endpoint-discovery.service.ts: branches 86.84% (baseline 0.9%, +85.9pp); route-parser.service.ts: 89.47% (baseline 6.8%, +82.7pp). 135/135 tests laravel verdes. Fixtures usan proyectos temporales reales (mkdtemp), no mocks de internals. bun run validate exit 0 registrado en 358f167.
### S3 — Fixtures de branches para `scanners/*`
- **Status**: done
- **Files**: `tests/frameworks/**.spec.ts`, fixtures bajo `tests/fixtures/`
- **Gate**: test
- acceptance:
  - "Las branches sin cubrir de `projects/frameworks/scanners/` bajan de 647"
  - "Los fixtures provienen de formas de código reales de los ejemplos o de variaciones mínimas de estas"
- review-state: done
- review-implementer: technical_investigator
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Criterios cumplidos. Branches sin cubrir en scanners/: 486 (baseline 647, -161 branches). django.scanner.ts: 81.19% (subida documentada en 7209ac7); openapi.scanner.ts: 86.47%. 857/857 tests frameworks verdes. Fixtures provienen de formas de código reales de los ejemplos y variaciones mínimas (confirmado en mensaje del commit). bun run validate exit 0 en 358f167.
### S4 — Fixtures de branches para `core/*` (domain, discovery, exporters)
- **Status**: done
- **Files**: `tests/core/**.spec.ts`
- **Gate**: test
- acceptance:
  - "Las branches sin cubrir de `projects/core/*` bajan de 561"
  - "Ningún cambio de comportamiento: solo tests y fixtures"
- review-state: done
- review-implementer: implementation_runner
- review-reviewer: proposal_guardian
- review-log: requested_changes by delivery_verifier — El criterio 'Ningún cambio de comportamiento: solo tests y fixtures' no está cumplido. El commit 09fd7a5 mezcla test files con cambios de comportamiento en producción: packages/core/discovery/paths.service.ts (nueva función outputDir(context?: IProjectContext)), packages/frameworks/laravel/endpoint-discovery.service.ts (parámetro context: IProjectContext en varias funciones), packages/frameworks/laravel/route-parser.service.ts y laravel.scanner.ts. La cobertura es correcta (182 missed < 561 baseline, 87.3% de core) y 724/724 tests pasan, pero la integridad del slice exige que los cambios de producción se tracen a r00008 o se justifiquen explícitamente como scaffolding habilitante de los tests, en cuyo caso el criterio debe actualizarse antes del approve.
- review-log: approved by proposal_guardian — Aprobado como proposal_guardian tras verificacion independiente del re-trabajo. Condicion 1 del delivery_verifier: trazar cambios de produccion a r00008 - CUMPLIDA. Los cambios de paths.service.ts, endpoint-discovery.service.ts, route-parser.service.ts y laravel.scanner.ts del commit 09fd7a5 estan en origin/develop cubiertos por r00008 (done, S3+S4 aprobados). Diff origin/develop..HEAD = solo tests/core/. Condicion 2 - solo tests y fixtures - CUMPLIDA en 37b76c1: 7 ficheros unicamente en tests/core/. Validacion: 174/174 tests S4 verdes, 0 errores TS en ficheros nuevos, gate=test satisfecho.
### S5 — Subir el suelo de branches de 62 a 70 y verificarlo en la cadena
- **Status**: done
- **Files**: `vitest.config.ts`
- **Gate**: test
- acceptance:
  - "`vitest.config.ts` exige branches >= 70"
  - "`bun run validate` falla si se introduce una regresión que baje del nuevo suelo"
  - "La propuesta se cierra con la medida final escrita en evidencia"
- review-state: done
- review-implementer: implementation_runner
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Criterios cumplidos. vitest.config.ts línea 91: branches: 70 (commit 09fd7a5). Medida real en build/coverage/coverage-summary.json: 73.29% (4260/5812 branches, baseline 64.22%, +9.07pp). El umbral actúa como guardrail activo. 724/724 tests core verdes. bun run validate exit 0.
## acceptance

- "Branches total >= 70 % medida por `bun run test:coverage` dentro de `validate`"
- "El suelo de branches en `vitest.config.ts` sube a 70"
- "Ningún test existente debilitado ni borrado para subir el número"
- "`bun run validate` verde al cierre, con la cadena completa"
