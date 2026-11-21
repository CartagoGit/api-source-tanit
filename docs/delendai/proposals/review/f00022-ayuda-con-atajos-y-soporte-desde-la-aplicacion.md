---
id: f00022
title: "Ayuda con atajos y soporte desde la aplicación"
kind: feat
status: review
type: proposal
track: ux
date: 2026-11-21
last-transition-id: 64717c15-461e-4bb5-95a7-c5eb3406d873
last-correlation-id: 64717c15-461e-4bb5-95a7-c5eb3406d873
last-transition-from: in-progress
last-transition-at: 2026-11-21T14:05:52.584Z
---

# f00022 — Ayuda con atajos y soporte desde la aplicación

## goal

Mostrar los atajos disponibles y enlazar con el repositorio y el registro de incidencias.

## why

La paleta tiene navegación por teclado pero no hay una pantalla que explique sus atajos ni dónde informar de un problema.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: lint

### S1 — Añadir Ayuda y mover la selección de tema a Ajustes
- **Status**: review
- **Files**: `packages/app/src/app/features/help/help.component.ts`, `packages/app/src/app/features/help/help.component.html`, `packages/app/src/app/features/help/help.component.scss`, `packages/app/src/app/shell/app-shell.component.ts`, `packages/app/src/app/shell/app-shell.component.html`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/endpoint_detection.yml`, `.github/ISSUE_TEMPLATE/enhancement.yml`, `packages/app/src/app/core/state/command.store.ts`, `packages/app/src/app/core/state/theme.store.ts`, `tests/app/help.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Ayuda abre sin proyecto desde navegación y paleta."
  - "Los atajos documentados funcionan y los enlaces identificados abren GitHub en el navegador."
  - "La apariencia se elige en Ajustes y se mantiene al navegar."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `9593de678662`

## acceptance

- Ayuda abre sin proyecto desde navegación y paleta.
- Los atajos documentados funcionan y los enlaces identificados abren GitHub en el navegador.
- La apariencia se elige en Ajustes y se mantiene al navegar.
