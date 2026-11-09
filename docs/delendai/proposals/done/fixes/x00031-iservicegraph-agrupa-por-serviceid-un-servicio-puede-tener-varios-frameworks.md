---
id: x00031
title: "IServiceGraph agrupa por serviceId: un servicio puede tener varios frameworks"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-09-05
shippedIn:
  - 91334a8  # feat(x00031): IServiceDescriptor admite multi-framework por servicio
dependsOn:
  - a00013
related:
  - x00029
  - x00030
---

# x00031 — "servicio" ≠ "match": agrupar los descriptors antes de construir el grafo

## Goal

Que `groupByService()` emita **un** `IServiceDescriptor` por `serviceId`,
con la lista de matches/frameworks que lo componen, en lugar de uno por
match. El modelo mental correcto:

```
service apps_api
  frameworks: [express, graphql]   ← capacidades
  endpoints, baseUrl, auth ...
```

hoy en cambio:

```ts
// packages/core/discovery/group-by-service.helper.ts
for (const match of input.matches) {
  services.push({ serviceId, match, endpoints: routes, … });
}
```

→ `apps/api` con Express + GraphQL produce dos descriptors con el mismo
`serviceId`, y el grafo deja de ser un árbol por servicio.

## Why

Hallazgo repetido en las revisiones de rama: la unidad Service ≠
framework/match sigue sin separarse. Con x00029/x00030 en marcha, dos
descriptores con el mismo id significaría que el mismo servicio recibe
dos construcciones parciales, y `combineServices`/nombres de colección
Postman empezarían a colisionar (`apps_api` dos veces).

## Non-goals

- No redefine `deriveServiceId` (la cascada de a00013 S1 sigue igual).
- No toca la UI del grafo más allá de lo que exija el cambio de shape.

## Slices

### S1 — contrato: `IServiceDescriptor` admite múltiples frameworks

- **Status**: done
- **Files**:
  - `packages/contracts/interfaces/core/service-graph.interface.ts`
- **Gate**: `bun run typecheck && bun run lint:contracts`
- **Detalle (91334a8)`: cambio ADITIVO, no rompe. El descriptor pasa
  a llevar `additionalMatches: ReadonlyArray<IProjectMatch>` (vacío
  para servicios de un solo framework) y `frameworks: ReadonlyArray<string>`
  (al menos `match.framework`). Decisión de la revisión: mantener
  `match` singular porque TODOS los consumidores actuales leen ese
  campo; romperlo sería un cambio invasivo sin valor añadido.

### S2 — grupo: `groupByService` agrupa por `serviceId`

- **Status**: done
- **Files**: `packages/core/discovery/group-by-service.helper.ts` + `tests/core/group-by-service.spec.ts`
- **Gate**: `bun run test:core`
- **Detalle (91334a8)`: cuando dos matches comparten `serviceId` (caso
  híbrido), el segundo se concatena a `additionalMatches` y, si su
  framework es nuevo, a `frameworks`. La lógica de merge de endpoints
  por tupla `(method, uri, sourceFile)` ya existía — el helper no
  duplica rutas. Dos tests nuevos verifican acceptance #1 y #2 de la
  propuesta (un solo descriptor, ningún `serviceId` duplicado).

### S3 — consumidoras: `toServiceGraph`, `generateCollections`, CLI/UI

- **Status**: done (parcial — pipeline sí, UI no)
- **Files**: `packages/core/discovery/to-service-graph.helper.ts`, `packages/core/discovery/generation.pipeline.ts`
- **Gate**: `bun run validate`
- **Detalle (91334a8)`: `toServiceGraph` y `generation.pipeline.ts`
  propagan los nuevos campos al reconstruir descriptores. Las
  factorías de los tests (auth-scheme, filter-specs) actualizan sus
  sintéticos. La UI no consume estos campos todavía — es un cambio
  cosmético y queda fuera del scope de esta propuesta.

## acceptance

1. ✅ Fixture híbrida (`apps/api` express + graphql) → el grafo tiene **un**
   servicio `apps_api` con ambos frameworks (test
   `tests/core/group-by-service.spec.ts`).
2. ✅ No aparece el mismo `serviceId` dos veces en `graph.services` en
   ningún ejemplo (test `group-by-service.spec.ts` cubre el caso
   genérico; los `examples/` se verifican en `bun run validate:examples`).
3. ⏳ `bun run validate` verde con i00002 cerrado — pendiente de x00027.
