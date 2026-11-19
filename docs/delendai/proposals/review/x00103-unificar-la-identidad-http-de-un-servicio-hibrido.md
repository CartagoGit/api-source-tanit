---
id: x00103
title: "Unificar la identidad HTTP de un servicio híbrido"
kind: fix
status: review
type: proposal
track: discovery
date: 2026-11-18
last-transition-id: e163b042-6737-4955-a6a5-d9b9a75db439
last-correlation-id: e163b042-6737-4955-a6a5-d9b9a75db439
last-transition-from: in-progress
last-transition-at: 2026-11-18T07:54:33.872Z
---

# x00103 — Unificar la identidad HTTP de un servicio híbrido

## goal

Exportar una sola operación HTTP cuando Swagger y el código describen el mismo método y ruta del mismo servicio.

## why

En un proyecto Express con OpenAPI, GET /same produce dos operaciones porque el merger recibe dos IDs por framework mientras el grafo y el informe de evidencia ya describen un solo servicio.

## non-goals

- Cambiar las reglas de precedencia del merger o descartar observaciones del informe común.
- Fusionar operaciones entre workspaces o cambiar la identificación por nombre de GraphQL y tRPC.

## slices

- global_gate: e2e

### S1 — Usar la identidad del grafo en la fusión HTTP
- **Status**: review
- **Files**: `packages/core/discovery/group-by-service.helper.ts`, `packages/core/discovery/generation.pipeline.ts`, `tests/core/hybrid-service-identity.spec.ts`, `docs/API.md`, `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: e2e
- acceptance:
  - "Un proyecto real de prueba Express y OpenAPI con el mismo método y ruta entrega exactamente una operación en los resultados y la colección, con descripción documentada y ambas fuentes en el informe común."
  - "Dos workspaces con el mismo método y ruta exportan operaciones independientes, incluso en modo combinado."
  - "Grafo y merger comparten la regla de identidad. Se conserva la atribución original del escaneo y las reglas existentes de GraphQL y tRPC."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `294184073bae`

## acceptance

- Un proyecto real de prueba Express y OpenAPI con el mismo método y ruta entrega exactamente una operación en los resultados y la colección, con descripción documentada y ambas fuentes en el informe común.
- Dos workspaces con el mismo método y ruta exportan operaciones independientes, incluso en modo combinado.
- Grafo y merger comparten la regla de identidad. Se conserva la atribución original del escaneo y las reglas existentes de GraphQL y tRPC.
