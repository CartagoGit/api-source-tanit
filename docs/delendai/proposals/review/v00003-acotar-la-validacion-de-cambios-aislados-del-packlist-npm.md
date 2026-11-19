---
id: v00003
title: "Acotar la validación de cambios aislados del packlist npm"
kind: perf
status: review
type: proposal
track: integration
date: 2026-11-19
last-transition-id: 237adf14-84b6-48ac-a1e6-38b6a34b09d1
last-correlation-id: 237adf14-84b6-48ac-a1e6-38b6a34b09d1
last-transition-from: in-progress
last-transition-at: 2026-11-19T14:45:27.075Z
---

# v00003 — Acotar la validación de cambios aislados del packlist npm

## goal

Evitar reconstruir escritorio en PR limitados al contenido distribuido por npm.

## why

El PR #182 cambió la lista files y su prueba, pero el planner clasificó package.json como global.

## non-goals

- Cambios de permisos, políticas de publicación y cobertura agregada de ramas de integración.

## slices

- global_gate: none

### S1 — Comprobar la diferencia de manifiestos y seleccionar la validación de paquete
- **Status**: review
- **Files**: `scripts/gates/prove.script.ts`, `scripts/helpers/proof-plan.helper.ts`, `packages/contracts/interfaces/quality/proof-plan.interface.ts`, `tests/scripts-gates/proof-plan.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: e2e
- acceptance:
  - "Un PR con cambios acotados a files del manifiesto npm, documentación y su regresión ejecuta lint, integración, auditoría y validación del paquete con la regresión de packlist."
  - "Cambios de dependencias, scripts u otros archivos de producto, evidencia ausente y promociones conservan el gate completo."
  - "El plan queda compartido entre CLI y CI. Las pruebas reproducen #182 y cubren las condiciones de fallback."
- shipped-in: `717ee23b1dca`
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol

## acceptance

- Un PR con cambios acotados a files del manifiesto npm, documentación y su regresión ejecuta lint, integración, auditoría y validación del paquete con la regresión de packlist.
- Cambios de dependencias, scripts u otros archivos de producto, evidencia ausente y promociones conservan el gate completo.
- El plan queda compartido entre CLI y CI. Las pruebas reproducen #182 y cubren las condiciones de fallback.
