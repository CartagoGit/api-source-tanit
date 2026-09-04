---
id: x00031
title: "IServiceGraph agrupa por serviceId: un servicio puede tener varios frameworks"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-05
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

- **Status**: pending
- **Files**:
  - `packages/contracts/interfaces/core/service-graph.interface.ts`
  - `docs/API.md` (regenerado)
- **Gate**: `bun run typecheck && bun run lint:contracts`
- **Detalle**:
  - El descriptor pasa a llevar `matches: ReadonlyArray<IProjectMatch>`
    (o `frameworks: ReadonlyArray<FrameworkId>` + el `match` principal), y
    `endpoints` se construye **por servicio** no por match.
  - Decisión abierta a resolver en la revisión de S1: mantener `match`
    singular para compatibilidad + añadir `additionalMatches`, o ruptura
    limpia (con nota en CHANGELOG). La revisión de propuestas decide; la
    recomendación del auditor es ruptura limpia, el grafo es interno.

### S2 — grupo: `groupByService` agrupa por `serviceId`

- **Status**: pending
- **Files**: `packages/core/discovery/group-by-service.helper.ts` + specs
- **Gate**: `bun run test:core`
- **Detalle**: un `Map<serviceId, IServiceDescriptor>` alimentado con
  upsert por match; `baseUrl`/`auth` se heredan del descriptor del
  workspace común (conflictos → diagnóstico explícito, no silencioso).

### S3 — consumidoras: `toServiceGraph`, `generateCollections`, CLI/UI

- **Status**: pending
- **Files**: `packages/core/discovery/generation.pipeline.ts`, `packages/cli/commands/*`, UI
- **Gate**: `bun run validate`
- **Detalle**: una colección por servicio (no por match); los nombres de
  archivo Postman deben seguir siendo únicos por construcción.

## acceptance

1. Fixture híbrida (`apps/api` express + graphql) → el grafo tiene **un**
   servicio `apps_api` con ambos frameworks.
2. No aparece el mismo `serviceId` dos veces en `graph.services` en ningún
   ejemplo de `examples/`.
3. `bun run validate` verde con i00002 cerrado.
