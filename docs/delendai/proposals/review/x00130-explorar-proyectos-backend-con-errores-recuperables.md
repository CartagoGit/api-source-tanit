---
id: x00130
title: "Explorar proyectos backend con errores recuperables"
kind: fix
status: review
type: proposal
track: ux
date: 2026-11-22
last-transition-id: 999fbfd2-a998-488a-8e46-c0e0e0180694
last-correlation-id: 999fbfd2-a998-488a-8e46-c0e0e0180694
last-transition-from: in-progress
last-transition-at: 2026-11-22T00:23:56.857Z
---

# x00130 — Explorar proyectos backend con errores recuperables

## goal

Distinguir la exploración web sin servicio local, la web conectada y el escritorio.

## why

Una solicitud de exploración sin respuesta bloquea los controles y puede mostrar un timeout genérico.

## non-goals

- Acceso a carpetas del visitante desde una web estática.
- Comparar contratos de apps detectadas.

## slices

- global_gate: lint

### S1 — Acotar esperas y explicar la selección de carpetas
- **Status**: review
- **Files**: `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/app/features/home/folder-picker.component.ts`, `packages/app/src/app/features/home/folder-picker.component.html`, `tests/app/host-bridge.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "La web sin la API local muestra una explicación específica y recupera los controles."
  - "El explorador conserva errores de la API y permite reintentar tras un timeout web o de escritorio."
  - "La selección explica cómo abrir un backend o la raíz de un monorepo."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `73bcc98e813c`

## acceptance

- La web sin la API local muestra una explicación específica y recupera los controles.
- El explorador conserva errores de la API y permite reintentar tras un timeout web o de escritorio.
- La selección explica cómo abrir un backend o la raíz de un monorepo.
