---
id: x00025
title: "routesByService acumula en lugar de sobrescribir + dedupe por OperationId"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - c6bfb3d
  - a1d3f0a
  - 7ea3a5d
  - 91334a8
dependsOn:
  - a00013
related:
  - a00009
  - x00024
  - x00028
  - x00030
---

# x00025 — `routesByService` acumula + dedupe por `OperationId`

## Goal

Sustituir la construcción `new Map(perScanner.map(...))` de `packages/core/discovery/generation.pipeline.ts` por una acumulación con merge. Sustituir el filtro `s.method === r.method && s.uri === r.uri` por un filtro por identidad estable (provenance + `serviceId`), de modo que GraphQL/tRPC/multi-framework bajo el mismo `serviceId` no pierdan operaciones en el `routesByService`.

## Why

Hallazgo P1 del audit 2026-09-04. Cuando dos scanners comparten `serviceId`, el `new Map(perScanner.map(...))` con la misma key sobrescribe el primer valor. Resultado: si Express y GraphQL están bajo el mismo `frameworkSearchRoot` (caso híbrido `apps/api`), las rutas del primer scanner se pierden. Y el filtro `method + uri` no distingue dos operaciones GraphQL en el mismo endpoint ni dos `GET /health` de workspaces distintos.

## Non-goals

- No cambia el contrato `IDiscovery.routesByService` (sigue siendo `Map<ServiceId, ReadonlyArray<ParsedRoute>>`).
- No introduce `OperationId` como tipo público en `contracts/` (el avance real es por provenance + `serviceId`, via x00028).
- No reemplaza el helper `groupByService` — el fix es aguas arriba.

## Slices

### S1 — acumulación + dedupe intra-key
- **Status**: done
- **Files**:
  - `packages/core/discovery/accumulate-routes-by-service.helper.ts` (nuevo)
  - `packages/core/discovery/generation.pipeline.ts` (rama multi-scanner)
  - `tests/core/accumulate-routes-by-service.spec.ts` (nuevo)
- **Gate**: `bun run test:core`

### S2 — gate lint:scanner-state-isolation
- **Status**: done
- **Files**: `scripts/gates/lint-scanner-state.script.ts` (nuevo)
- **Gate**: entra en `bun run lint`

## Decisión sobre el título

El título decía "dedupe por OperationId". La revisión 2026-09-05 observó que OperationId no se introdujo en x00025: el dedupe efectivo es por `(method, uri, sourceFile)` dentro de cada `serviceId`, y la atribución cross-service quedó resuelta en **x00028** mediante `serviceId` estampado en cada `EndpointSpec`. La propuesta **x00030** absorbió el resto del título (asociación por provenance) y se cerró de manera independiente.

## acceptance

- [x] `bun run test:core` verde con los tests nuevos pasando (6 tests en `accumulate-routes-by-service.spec.ts`).
- [x] El gate `lint:scanner-state-isolation` rechaza `new Map(... .map(...))` en código de discovery.
- [x] `bun run validate` verde end-to-end (validado en commits previos: 21/21 ejemplos, 3292 tests pasando).
- [x] Coverage sin regresión local.
- [x] La atribución cross-service se delega a x00028 (con `serviceId` estampado), no a OperationId — `x00030` queda como track separado para asociación por provenance.
