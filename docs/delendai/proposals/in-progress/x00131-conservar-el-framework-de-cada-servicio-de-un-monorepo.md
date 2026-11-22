---
id: x00131
title: "Conservar el framework de cada servicio de un monorepo"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-22
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
- **Status**: pending
- **Files**: `packages/core/discovery/generation.pipeline.ts`, `tests/e2e/multi-service.test.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El resultado independiente de cada servicio conserva el framework de ese workspace."
  - "La salida combinada, el resultado sin detección y los consumidores del snapshot conservan su contrato."

## acceptance

- El resultado independiente de cada servicio conserva el framework de ese workspace.
- La salida combinada, el resultado sin detección y los consumidores del snapshot conservan su contrato.
