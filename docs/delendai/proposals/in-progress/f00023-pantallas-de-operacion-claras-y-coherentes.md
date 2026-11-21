---
id: f00023
title: "Pantallas de operación claras y coherentes"
kind: feat
status: in-progress
type: proposal
track: ux
date: 2026-11-21
---

# f00023 — Pantallas de operación claras y coherentes

## goal

Dar una jerarquía común a Comprobar, Validar, Sincronizar, Postman, Estadísticas y En vivo.

## why

Los controles, los resultados y los errores están juntos y es difícil anticipar qué hace cada pantalla.

## non-goals

- Cambiar la lógica del backend, el formato de los resultados o los efectos de los controles.

## slices

- global_gate: lint

### S1 — Unificar navegación visual, controles y resultados de seis operaciones
- **Status**: review
- **Files**: `packages/app/src/app/features/check/check.component.html`, `packages/app/src/app/features/check/check.component.ts`, `packages/app/src/app/features/validate/validate.component.html`, `packages/app/src/app/features/validate/validate.component.ts`, `packages/app/src/app/features/sync/sync.component.html`, `packages/app/src/app/features/sync/sync.component.ts`, `packages/app/src/app/features/push/push-to-postman.component.html`, `packages/app/src/app/features/push/push-to-postman.component.ts`, `packages/app/src/app/features/stats/stats.component.html`, `packages/app/src/app/features/stats/stats.component.scss`, `packages/app/src/app/features/stats/stats.component.ts`, `packages/app/src/app/features/live/live-toggle.component.html`, `packages/app/src/app/features/live/live-toggle.component.ts`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/styles.scss`, `packages/app/src/styles/workflow.scss`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Cada pantalla tiene una acción identificable y ayuda contextual en inglés, español y francés."
  - "El panel de resultados preserva la información del backend y los controles existentes."
  - "Los paneles se adaptan a pantalla estrecha, tienen foco visible y respetan movimiento reducido."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol

## acceptance

- Cada pantalla tiene una acción identificable y ayuda contextual en inglés, español y francés.
- El panel de resultados preserva la información del backend y los controles existentes.
- Los paneles se adaptan a pantalla estrecha, tienen foco visible y respetan movimiento reducido.

La hoja compartida sustituye cinco hojas obsoletas de componentes.
