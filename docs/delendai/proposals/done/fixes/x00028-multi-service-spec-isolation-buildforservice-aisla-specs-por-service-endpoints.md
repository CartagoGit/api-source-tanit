---
id: x00028
title: "Multi-service spec isolation - buildForService() aísla specs por service.endpoints"
kind: fix
status: done
type: proposal
track: general
date: 2026-09-04
shippedIn:
  - f780653
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

### S1 — EndpointSpec.serviceId: stamp de workspace en cada spec
- **Status**: done
- **Files**: `packages/contracts/interfaces/core/postman.interface.ts`, `packages/core/adapters/parsed-route-to-spec.adapter.ts`
- **Gate**: type

### S2 — IMergedEndpoint.serviceId propagado por endpointSpecFromMerged
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/contracts/interfaces/core/merge.interface.ts`, `packages/core/discovery/endpoint-merger.service.ts`
- **Gate**: type

### S3 — filterSpecsForService restringe por serviceId ademas de (method, uri)
- **Status**: done
- **DependsOn**: [S2]
- **Files**: `packages/core/discovery/filter-specs-for-service.helper.ts`, `packages/core/discovery/generation.pipeline.ts`
- **Gate**: e2e

### S4 — Fixture E2E apps/users + apps/orders con GET /health cada uno + gate lint:spec-isolation
- **Status**: done
- **DependsOn**: [S3]
- **Files**: `tests/e2e/multi-service-isolation.spec.ts`, `tests/fixtures/multi-service-isolation/`, `scripts/gates/lint-spec-isolation.script.ts`, `package.json`
- **Gate**: e2e

## acceptance

- [x] Cada servicio del ServiceGraph ve solo sus propios EndpointSpec.
- [x] Dos workspaces que emiten GET /health con el mismo (method, uri) producen dos specs distintos, cada uno con su propio serviceId.
- [x] Cada servicio ve exactamente un GET /health (el suyo), no dos.
- [x] El filtro tolera specs sin serviceId (legacy / hand-crafted fixtures) via normalizacion a "".
- [x] El combined-mode (combineServices=true) sigue produciendo un unico IGenerationResult con todos los endpoints.
- [x] Gate lint:spec-isolation rechaza const specs = [...discovery.specs] fuera del helper documentado.
- [x] `bun run validate` verde con 21/21 ejemplos, 3292 tests pasando.
