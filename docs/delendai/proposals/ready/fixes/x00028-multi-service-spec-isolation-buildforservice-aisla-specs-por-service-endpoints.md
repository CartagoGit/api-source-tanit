---
id: x00028
title: "Multi-service spec isolation - buildForService() aísla specs por service.endpoints"
kind: fix
status: ready
type: proposal
track: general
date: 2026-09-04
---

# x00028 — Multi-service spec isolation - buildForService() aísla specs por service.endpoints

## Goal

Hacer que cada servicio del ServiceGraph vea solo sus propios EndpointSpec durante buildForService(). Hoy la funcion consume el catalogo global discovery.specs y el resultado es que service A y service B pueden producir collections usando el mismo catalogo aunque sean monorepos distintos.

## why

El codigo actual de buildForService (packages/core/discovery/generation.pipeline.ts:307-415) tiene literalmente const specs = [...discovery.specs] y un comentario que reconoce: Spec filtering por service.endpoints queda para un slice posterior. Resultado: en un monorepo apps/users y apps/orders, ambos servicios ven el catalogo global y pueden producir collections que mezclan rutas. Es la causa raiz de la mayoria de los bugs P0 que el usuario reviso.

## non-goals

- No cambia el contrato IServiceDescriptor (los servicios siguen describiendo capabilities, no specs)
- No introduce un OperationId publico (eso es Fase B del API IR)
- No toca el flujo hybrid multi-framework dentro del mismo servicio (esa es la causa raiz de x00025, no de este fix)

## Slices

- global_gate: e2e

### S1 — Refactor: extraer buildForService a su propio helper con inyeccion de specs
- **Status**: pending
- **Files**: `packages/core/discovery/generation.pipeline.ts`, `packages/core/discovery/build-for-service.helper.ts`
- **Gate**: type

### S2 — Tests del helper con dos servicios y mismo method+uri
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `packages/core/discovery/build-for-service.helper.spec.ts`
- **Gate**: lint

### S3 — Fixture E2E apps/users + apps/orders con GET /health cada uno
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `tests/e2e/multi-service-isolation.spec.ts`, `tests/fixtures/multi-service-isolation/apps/users/src/routes.ts`, `tests/fixtures/multi-service-isolation/apps/orders/src/routes.ts`
- **Gate**: e2e

### S4 — Gate lint:spec-isolation que rechaza const specs = [...discovery.specs]
- **Status**: pending
- **DependsOn**: [S3]
- **Files**: `scripts/gates/lint-scanner-state.script.ts`
- **Gate**: lint

## acceptance

- TODO: observable acceptance criteria.
