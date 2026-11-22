---
id: x00131
title: "Conservar el framework de cada servicio de un monorepo"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-22
last-transition-id: 767a7ce8-0d3b-42b7-a36b-22e73b5fe16b
last-correlation-id: 767a7ce8-0d3b-42b7-a36b-22e73b5fe16b
last-transition-from: in-progress
last-transition-at: 2026-11-22T00:28:09.430Z
---

# x00131 — Conservar el framework de cada servicio de un monorepo

## goal

Propagar desde el escáner la coincidencia de framework de cada servicio al snapshot compartido.

## why

El catálogo muestra FastAPI para el backend NestJS porque cada resultado recibe la primera coincidencia global.

## non-goals

- Cambiar el conjunto de frameworks reconocidos en el proyecto.

## slices

- global_gate: lint

### S1 — Propagar la coincidencia de framework por servicio
- **Status**: review
- **Files**: `packages/core/discovery/generation.pipeline.ts`, `tests/e2e/multi-service.test.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El resultado independiente de cada servicio conserva el framework de ese workspace."
  - "La salida combinada, el resultado sin detección y los consumidores del snapshot conservan su contrato."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `b58abbb96252`

## acceptance

- El resultado independiente de cada servicio conserva el framework de ese workspace.
- La salida combinada, el resultado sin detección y los consumidores del snapshot conservan su contrato.
