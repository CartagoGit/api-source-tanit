---
id: x00025
title: "routesByService acumula en lugar de sobrescribir + dedupe por OperationId"
kind: fix
status: ready
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - c6bfb3d  # fix(core): x00025 routesByService acumula + dedupe intra-key
  - a1d3f0a  # merge: x00025 routesByService acumula + dedupe (resuelve conflicto con x00024 en generation.pipeline.ts)
dependsOn:
  - a00013
related:
  - a00009
  - x00024
---

# x00025 — `routesByService` acumula + dedupe por `OperationId`

## Goal

Sustituir la construcción `new Map(perScanner.map(...))` de
`packages/core/discovery/generation.pipeline.ts:863-880` por una
acumulación con merge. Sustituir el filtro `s.method === r.method &&
s.uri === r.uri` por un filtro por `OperationId` estable, de modo que
GraphQL/tRPC/multi-framework bajo el mismo `serviceId` no pierdan
operaciones en el `routesByService`.

## Why

Hallazgo P1 del audit 2026-09-04 (snapshot `7ea3a5d`). Cuando dos
scanners comparten `serviceId`:

```ts
new Map(
  perScanner.map(({ serviceId, scannerSpecs }) => [
    serviceId,
    routes.filter(r => scannerSpecs.some(s => s.method === r.method && s.uri === r.uri)),
  ]),
)
```

La segunda entrada reemplaza la primera (`Map` con la misma key
sobrescribe). Resultado: si Express y GraphQL están bajo el mismo
`frameworkSearchRoot` (caso híbrido `apps/api`), las rutas del primer
scanner se pierden. Y el filtro `method + uri` no distingue dos
operaciones GraphQL en el mismo endpoint.

## Non-goals

- No cambia el contrato `IDiscovery.routesByService` (sigue siendo
  `Map<ServiceId, ReadonlyArray<ParsedRoute>>`).
- No introduce `OperationId` como tipo público en `contracts/` (eso
  es parte del API IR de Fase B del audit).
- No reemplaza el helper `groupByService` — el fix es aguas arriba.

## Slices

### S1 — acumulación + dedupe intra-key

- **Status**: pending
- **Files**:
  - `packages/core/discovery/generation.pipeline.ts` (rama multi-scanner)
  - `packages/core/discovery/to-service-graph.helper.ts` (rama de copia)
  - `tests/core/generation.pipeline.spec.ts` (nuevo)
- **Gate**: `bun run test:core`
- **Detalle**:
  - En `generation.pipeline.ts:863-880`, cambiar el `new Map(...)` por
    una iteración explícita:
    ```ts
    const routesByService = new Map<ServiceId, ParsedRoute[]>();
    for (const { serviceId, scannerSpecs } of perScanner) {
      const existing = routesByService.get(serviceId) ?? [];
      const fresh = routes.filter(r => scannerSpecs.some(s => s.method === r.method && s.uri === r.uri));
      routesByService.set(serviceId, [...existing, ...fresh]);
    }
    ```
  - Dedupe posterior por tupla `(method, uri, sourceFile)` para no
    duplicar la misma ruta cuando dos scanners la ven.
  - En `to-service-graph.helper.ts:62-69`, sustituir el `routesByMatch.set(serviceId, routes)`
    por acumulación equivalente.
  - **3 tests nuevos**:
    1. Dos scanners con el mismo `serviceId` → `routesByService` contiene
       la unión de las rutas, no solo las del último.
    2. Mismo scanner emitiendo la misma ruta dos veces → dedupe a una
       sola entrada.
    3. Multi-framework híbrido (Express + GraphQL) bajo el mismo
       `serviceId` → ambas colecciones de rutas presentes.

### S2 — gate lint:scanner-state-isolation extendido

- **Status**: pending
- **Files**: `scripts/gates/lint-scanner-state.script.ts` (extender)
- **Gate**: entra en `bun run lint`
- **Detalle**: añadir regla que rechaza `new Map(... .map(... => [key,
  value]))` cuando el `key` proviene de `deriveServiceId` u otro
  identificador derivado del input del scanner. Forzar uso de helper
  de acumulación explícito.

## acceptance

1. `bun run test:core` verde con los 3 tests nuevos pasando.
2. El gate `lint:scanner-state-isolation` (extendido) rechaza
   `new Map(... .map(... => [key, value]))` en código de discovery.
3. `bun run validate` verde end-to-end.
4. Coverage sin regresión local.