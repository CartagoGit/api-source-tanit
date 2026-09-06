---
id: r00012
title: "integration verifier v2 — YAML real y header correcto"
kind: refactor
status: in-progress
type: proposal
track: general
date: 2026-09-06
last-transition-id: r00012-in-progress
last-correlation-id: affair-2026-09-06-r00012-in-progress
last-transition-from: ready
last-idempotency-key: affair-2026-09-06-r00012-in-progress
---

# r00012 — integration verifier v2 — YAML real y header correcto

## Goal

Sustituir el grep textual de workflow-overlap por parseo YAML real, y reescribir el header del script para que el conteo de preguntas coincida con la realidad.

## why

La revisión 2026-09-06 señaló dos debilidades en lint-integration-verifier: header miente sobre número de preguntas (8 según header, 5 en QUESTIONS), y workflow-overlap es heurístico.

## non-goals

- TODO: what this proposal deliberately skips.

## Slices

- global_gate: lint

### S1 — refactor(gates): YAML real en workflow-overlap + header correcto
- **Status**: done
- **Files**: `scripts/gates/lint-integration-verifier.script.ts`
- **Gate**: lint
- acceptance:
  - "checkWorkflowOverlap parsea YAML en vez de grep"
  - "Detecta branches en multilínea y formatos equivalentes"
  - "Header declara 5 locales + 3 reusadas = 8 totales"
  - "Header explica cuáles preguntas son reusadas y de dónde vienen"
- review-state: done
- review-implementer: orchestrator
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — Single-agent auto-review. f4ff676 reemplaza grep textual por Bun.YAML.parse (más robusto) y reescribe el header del script para que diga 5 locales + 3 reusadas = 8 totales, sin mentir sobre el conteo. Validate pasa 3216/3216.
## acceptance

- checkWorkflowOverlap parsea YAML en vez de grep
- Detecta branches en multilínea y formatos equivalentes
- Header declara 5 locales + 3 reusadas = 8 totales
- Header explica cuáles preguntas son reusadas y de dónde vienen
