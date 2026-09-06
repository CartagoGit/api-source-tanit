---
id: x00030
title: "Atribución de rutas por provenance (serviceId/scanner) desde el origen, no reconstruida por method+uri"
kind: fix
status: retired
type: proposal
track: api-source-tanit
date: 2026-09-05
dependsOn:
  - a00013
  - x00025
related:
  - x00029
  - a00016
---

# x00030 — La asociación `scannerSpecs → rutas` sigue reconstruyéndose por `method + uri`

## Goal

Que `accumulateRoutesByService()` ya no necesite reconstruir qué rutas
pertenecen a qué scanner. La provenance debe venir **de origen**: cuando
un scanner emite un `ParsedRoute`, ya sabe a qué `serviceId` y a sí mismo
(framework/scanner) pertenece la ruta.

## Why

`x00025` corrigió que el `Map` sobrescribiera la primera entrada, pero el
filtro de asociación es estructuralmente inseguro:

```ts
// packages/core/discovery/accumulate-routes-by-service.helper.ts
const fresh = routes.filter((r) =>
  scannerSpecs.some((s) => s.method === r.method && s.uri === r.uri),
);
```

En un monorepo real:

```
apps/users   GET /health   src/routes.ts
apps/orders  GET /health   src/routes.ts
```

cada scanner tiene la spec `GET /health`, y el filtro por `(method, uri)`
encuentra **las dos rutas globales al procesar cada scanner** → ambos
servicios reciben ambas rutas. Los tests actuales de ese helper evitan
involuntariamente el caso usando rutas distintas por servicio.

## Non-goals

- No requiere un `OperationId` global con la forma del API IR de a00010
  Fase B completo; basta con que el `ParsedRoute` arrastre su
  `serviceId`/scanner-id.
- No toca el contenido de las colecciones, solo el reparto.

## Slices

### S1 — provenance en `ParsedRoute` (o envoltorio de emisión por scanner)

- **Status**: pending
- **Files**:
  - `packages/contracts/interfaces/core/scanner.interface.ts` (`ParsedRoute`)
  - la firma interna `IPerScanner` en `generation.pipeline.ts`
  - `packages/core/discovery/group-by-service.helper.ts` (usa el nuevo campo)
- **Gate**: `bun run typecheck`
- **Detalle**:
  - Añadir al `ParsedRoute` un campo estable de provenance:
    `readonly serviceId: string` (el que derivó el orquestador para el
    match del scanner que emitió la ruta), opcionalmente `framework`.
  - Los scanners no calculan su propio `serviceId` (eso lo conoce el
    orquestador al dispatchear el match): el orquestador decora la salida
    del scanner al agregarla al total, así el contrato del scanner
    `scan()` no se ve forzado a conocer monorepo.
  - Si tocar `ParsedRoute` se considera demasiado ancho, alternativa
    equivalente: `scannerResults: Array<{ serviceId, framework, routes }>`
    en el discovery. La opción se decide en la revisión de S1.

### S2 — `accumulateRoutesByService` elimina el filtro method+uri

- **Status**: pending
- **Files**: `packages/core/discovery/accumulate-routes-by-service.helper.ts`, `tests/core/accumulate-routes-by-service.spec.ts`
  (destruido o absorbido por el helper de grouping)
- **Gate**: `bun run test:core`
- **Detalle**: el reparto pasa a ser `groupBy(route.serviceId)`. El dedupe
  por tupla `(method, uri, sourceFile)` se conserva como garantía de no
  duplicar si un futuro scanner emite dos veces la misma ruta.

### S3 — test adversarial: dos servicios con `GET /health` idénticos

- **Status**: pending
- **Files**: `tests/core/accumulate-routes-by-service.spec.ts` / E2E
- **Gate**: el test
- **Detalle**: el escenario exacto de las revisiones — el helper **falla
  hoy** con él; verde tras S1+S2. Mismo fixture que x00029 S2 (una sola
  fixture sirve a ambas).

## acceptance

1. El filtro `s.method === r.method && s.uri === r.uri` desaparece del
   núcleo de discovery.
2. Test adversarial de rutas idénticas pasa E2E.
3. `bun run validate` verde (con i00002 cerrado).
4. x00025 marcada como dependiente: su invariante pasa a estar demostrada
   por construcción (provenance), no por reconstrucción heurística.

---

> **Retirada 2026-09-05 tras el merge de `origin/develop`**: x00025 fué actualizado
> por `a2956e8` con un helper (`accumulateRoutesByService` en
> `packages/core/discovery/accumulate-routes-by-service.helper.ts`) que toma rutas por
> scanner (`scannerRoutes`) y dedupe por `(method, uri, sourceFile)`. La motivación
> original de x00030 (no volver a atribuir por method+uri global) quedó cubierta ahí.
> El slice "dos servicios con GET /health idénticos" sigue abierto en a00013 S1 y
> puede retomarse como test adversarial contra x00025.
