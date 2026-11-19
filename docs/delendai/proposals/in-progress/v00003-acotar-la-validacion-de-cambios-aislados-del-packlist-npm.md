---
id: v00003
title: "Acotar la validación de cambios aislados del packlist npm"
kind: perf
status: in-progress
type: proposal
track: integration
date: 2026-11-19
last-transition-id: 82d43ffb-9ac3-4148-adb9-8d684e7c63f6
last-correlation-id: 82d43ffb-9ac3-4148-adb9-8d684e7c63f6
last-transition-from: ready
last-transition-at: 2026-11-19T08:21:50.892Z
---

# v00003 — Acotar la validación de cambios aislados del packlist npm

## goal

Evitar reconstruir escritorio en PR limitados al contenido distribuido por npm.

## why

El PR #182 cambió la lista files y su prueba, pero el planner clasificó package.json como global.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Comprobar la diferencia de manifiestos y seleccionar la validación de paquete
- **Status**: pending
- **Files**: `scripts/gates/prove.script.ts`, `scripts/helpers/proof-plan.helper.ts`, `packages/contracts/interfaces/quality/proof-plan.interface.ts`, `tests/scripts-gates/proof-plan.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`, `docs/delendai/proposals/INDEX.md`
- **Gate**: e2e
- acceptance:
  - "Un PR con cambios acotados a files del manifiesto npm, documentación y su regresión ejecuta lint, integración, auditoría y validación del paquete con la regresión de packlist."
  - "Cambios de dependencias, scripts u otros archivos de producto, evidencia ausente y promociones conservan el gate completo."
  - "El plan queda compartido entre CLI y CI. Las pruebas reproducen #182 y cubren las condiciones de fallback."

## acceptance

- Un PR con cambios acotados a files del manifiesto npm, documentación y su regresión ejecuta lint, integración, auditoría y validación del paquete con la regresión de packlist.
- Cambios de dependencias, scripts u otros archivos de producto, evidencia ausente y promociones conservan el gate completo.
- El plan queda compartido entre CLI y CI. Las pruebas reproducen #182 y cubren las condiciones de fallback.
