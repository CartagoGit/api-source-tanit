---
id: x00103
title: "Unificar la identidad HTTP de un servicio híbrido"
kind: fix
status: done
type: proposal
track: discovery
date: 2026-11-18
last-transition-id: fa887048-0f1b-4c39-bb1a-e4c1667d77a8
last-correlation-id: fa887048-0f1b-4c39-bb1a-e4c1667d77a8
last-transition-from: review
last-transition-at: 2026-11-19T20:45:04.053Z
shipped-in:
  - "f9b8b9c5be4f26c42744b83037f87236c5e22f58"
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
- **Status**: done
- **Files**: `packages/core/discovery/group-by-service.helper.ts`, `packages/core/discovery/generation.pipeline.ts`, `tests/core/hybrid-service-identity.spec.ts`, `docs/API.md`, `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: e2e
- acceptance:
  - "Un proyecto real de prueba Express y OpenAPI con el mismo método y ruta entrega exactamente una operación en los resultados y la colección, con descripción documentada y ambas fuentes en el informe común."
  - "Dos workspaces con el mismo método y ruta exportan operaciones independientes, incluso en modo combinado."
  - "Grafo y merger comparten la regla de identidad. Se conserva la atribución original del escaneo y las reglas existentes de GraphQL y tRPC."
- shipped-in: `294184073bae`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-terra
- review-log: approved by openai-gpt-6.1-terra — verified at f9b8b9c5be4f, validate exit 0 and tests 2/2 claimed, no recorded run cited; acceptance 3/3: (1) tests/core/hybrid-service-identity.spec.ts 2/2 (2) tests/core/hybrid-service-identity.spec.ts 2/2 (3) diff generation.pipeline y group-by-service revisado; CI #162 test-coverage verde — CI #162 verde y Vitest híbrido 2/2.

## acceptance

- Un proyecto real de prueba Express y OpenAPI con el mismo método y ruta entrega exactamente una operación en los resultados y la colección, con descripción documentada y ambas fuentes en el informe común.
- Dos workspaces con el mismo método y ruta exportan operaciones independientes, incluso en modo combinado.
- Grafo y merger comparten la regla de identidad. Se conserva la atribución original del escaneo y las reglas existentes de GraphQL y tRPC.
