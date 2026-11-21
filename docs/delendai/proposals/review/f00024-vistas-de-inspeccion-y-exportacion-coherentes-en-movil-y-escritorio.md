---
id: f00024
title: "Vistas de inspección y exportación coherentes en móvil y escritorio"
kind: feat
status: review
type: proposal
track: ux
date: 2026-11-21
last-transition-id: 47908569-8349-4b64-97ed-3db500ccf581
last-correlation-id: 47908569-8349-4b64-97ed-3db500ccf581
last-transition-from: in-progress
last-transition-at: 2026-11-21T14:24:54.591Z
---

# f00024 — Vistas de inspección y exportación coherentes en móvil y escritorio

## goal

Aplicar proporciones y controles coherentes a endpoints, servicios, historial, diagnóstico y exportación.

## why

Los mismos controles se ven diferentes entre pantallas y las rutas largas limitan la lectura en ventanas estrechas.

## non-goals

- Cambiar la información de las vistas o el comportamiento de los comandos.

## slices

- global_gate: lint

### S1 — Integrar jerarquía visual, foco y espacios adaptativos
- **Status**: review
- **Files**: `packages/app/src/app/features/endpoints/endpoints-list.component.scss`, `packages/app/src/app/features/services/services-list.component.scss`, `packages/app/src/app/features/history/history-list.component.scss`, `packages/app/src/app/features/diagnostics/diagnostics.component.scss`, `packages/app/src/app/features/exports/export-center.component.scss`, `packages/app/src/app/features/services/services-list.component.html`, `packages/app/src/app/features/history/history-list.component.html`, `tests/app/history.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`
- **Gate**: e2e
- acceptance:
  - "Las cinco vistas conservan su información y estructura y usan los temas seleccionados."
  - "Botones y controles son legibles y navegables con teclado en escritorio y a 390 px."
  - "La expansión de servicios anuncia el estado y respeta movimiento reducido."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `411fb08d8542`

## acceptance

- Las cinco vistas conservan su información y estructura y usan los temas seleccionados.
- Botones y controles son legibles y navegables con teclado en escritorio y a 390 px.
- La expansión de servicios anuncia el estado y respeta movimiento reducido.
