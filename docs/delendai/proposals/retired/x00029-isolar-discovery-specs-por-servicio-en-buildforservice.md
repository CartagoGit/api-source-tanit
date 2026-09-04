---
id: x00029
title: "Aislar discovery.specs por servicio en buildForService (mayor bug funcional multi-service)"
kind: fix
status: retired
type: proposal
track: api-source-tanit
date: 2026-09-05
dependsOn:
  - a00013
  - x00025
---

# x00029 — `buildForService` todavía construye cada servicio con el catálogo global

## Goal

Que cada `IServiceDescriptor` reciba **solo las specs de su servicio** al
generar su colección. Hoy `buildForService()` hace:

```ts
// packages/core/discovery/generation.pipeline.ts:334
const specs = [...discovery.specs];
```

con el comentario explícito de que el filtrado por `service.endpoints`
queda para un slice posterior. Mientras esté así, un monorepo
`apps/users` + `apps/orders` produce dos colecciones que potencialmente
contienen las operaciones de ambos.

## Why

Tres revisiones independientes de la rama sitúan esto como el fallo
funcional grave que no avanza:

- El ServiceGraph existe, cada servicio tiene `endpoints` y `baseUrl`
  propios… pero el último tramo del pipeline los ignora.
- No se arregla añadiendo features; es cerrar la invariante que
  a00013 prometió.

## Non-goals

- No cambia el contrato público `IDiscovery`.
- No toca el camino legacy de un solo servicio (ramas monolíticas).

## Slices

### S1 — filtrar specs por `service.endpoints` dentro de `buildForService`

- **Status**: pending
- **Files**:
  - `packages/core/discovery/generation.pipeline.ts`
  - `packages/core/discovery/accumulate-routes-by-service.helper.ts` (reutilizar
    la tupla de identidad si se pasa al filtro de specs)
  - `tests/core/generation.pipeline.spec.ts`
- **Gate**: `bun run test:core`
- **Detalle**:
  - En lugar de `[...discovery.specs]`, derivar las specs visibles para el
    servicio desde `service.endpoints` (misma clave de identidad que el
    resto del pipeline: `(method, uri, sourceFile)` — el filtro por
    `method + uri` es exactamente lo que x00025 demostró inseguro entre
    servicios).
  - Si el grafo aún no popula `service.endpoints` con provenance, usar el
    `routesByService` del grafo como fuente: las specs cuyo método+uri+
    sourceFile pertenezcan a las rutas del servicio.
  - Mantener compatibilidad: monorepo sin ServiceGraph (un solo servicio,
    legacy) sigue recibiendo todas las specs.

### S2 — E2E de aislamiento real

- **Status**: pending
- **Files**: `tests/e2e/multi-service-isolation.test.ts` (o extensión del
  existente `concurrent-projects.test.ts`)
- **Gate**: entra en `bun run validate` (bloquea cerrar x00029)
- **Detalle**:
  - Fixture monorepo con dos servicios y **la misma ruta** en ambos:
    `apps/users GET /health` y `apps/orders GET /health` (y una tercera
    ruta distinta por servicio para demostrar el filtro completo).
  - Aserción: la colección de `users` contiene solo `users /health` (+ su
    ruta propia); la de `orders` simétricamente. Éste es el caso que las
    revisiones señalaron como no cubierto: los tests actuales de x00025
    usan rutas **distintas** a propósito y por eso no detectan la fuga.

## acceptance

1. `bun run test:core` verde con los filtros por servicio probados.
2. El E2E de aislamiento pasa **con las dos rutas idénticas**.
3. `bun run validate` verde end-to-end en GitHub Actions (condición
   adicional: i00002 debe estar cerrado antes de poder demostrar esto).
4. El comentario `const specs = [...discovery.specs]` desaparece (o pasa a
   ser una rama explícita solo-legacy con su `TODO` eliminado).

---

> **Retirada 2026-09-05 tras el merge de `origin/develop`**: equivalente funcional
> ya cubierta por **x00028** (misma acceptance, misma firma de código con commit
> `a5ed0a4` ya en la rama). Queda registrada como referencia cruzada para
> auditoría: el contenido de x00029 era idéntico en objetivo (aislar `discovery.specs`
> por servicio en `buildForService`), sin decisiones divergentes.
