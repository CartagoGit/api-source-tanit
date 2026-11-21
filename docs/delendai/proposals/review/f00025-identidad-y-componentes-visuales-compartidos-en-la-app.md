---
id: f00025
title: "Identidad y componentes visuales compartidos en la app"
kind: feat
status: review
type: proposal
track: ux
date: 2026-11-21
last-transition-id: 2fda3d09-3ba0-4a46-9836-ef82effc8531
last-correlation-id: 2fda3d09-3ba0-4a46-9836-ef82effc8531
last-transition-from: in-progress
last-transition-at: 2026-11-21T15:05:10.628Z
---

# f00025 — Identidad y componentes visuales compartidos en la app

## goal

Mostrar repositorio, autor y versión en el sidebar y compartir densidad, controles, paneles y movimiento entre las pantallas.

## why

La navegación cambia con una transición apenas visible y cada vista repite estilos de componentes.

## non-goals

- Cambiar la lógica de operaciones del backend.

## slices

- global_gate: lint

### S1 — Unificar diseño, movimiento y pie de navegación
- **Status**: review
- **Files**: `docs/delendai/AGENT-BOOTSTRAP.md`, `packages/app/src/app/core/app-metadata.ts`, `packages/app/src/app/core/host/external-link.service.ts`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/app/features/check/check.component.html`, `packages/app/src/app/features/diagnostics/diagnostics.component.html`, `packages/app/src/app/features/diagnostics/diagnostics.component.scss`, `packages/app/src/app/features/endpoints/endpoints-list.component.html`, `packages/app/src/app/features/endpoints/endpoints-list.component.scss`, `packages/app/src/app/features/exports/export-center.component.html`, `packages/app/src/app/features/exports/export-center.component.scss`, `packages/app/src/app/features/help/help.component.html`, `packages/app/src/app/features/help/help.component.scss`, `packages/app/src/app/features/help/help.component.ts`, `packages/app/src/app/features/history/history-list.component.html`, `packages/app/src/app/features/history/history-list.component.scss`, `packages/app/src/app/features/home/home.component.html`, `packages/app/src/app/features/home/home.component.scss`, `packages/app/src/app/features/live/live-toggle.component.html`, `packages/app/src/app/features/push/push-to-postman.component.html`, `packages/app/src/app/features/services/services-list.component.html`, `packages/app/src/app/features/services/services-list.component.scss`, `packages/app/src/app/features/settings/settings.component.html`, `packages/app/src/app/features/settings/settings.component.scss`, `packages/app/src/app/features/stats/stats.component.html`, `packages/app/src/app/features/sync/sync.component.html`, `packages/app/src/app/features/validate/validate.component.html`, `packages/app/src/app/shared/github-mark.component.ts`, `packages/app/src/app/shared/github-mark.component.html`, `packages/app/src/app/shared/github-mark.component.scss`, `packages/app/src/app/shell/app-shell.component.html`, `packages/app/src/app/shell/app-shell.component.scss`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/styles.scss`, `packages/app/src/styles/motion.scss`, `packages/app/src/styles/primitives.scss`, `packages/app/src/styles/workflow.scss`, `tests/app/reachable.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Repositorio, autor y versión son visibles con o sin proyecto, también con menú móvil cerrado."
  - "Botones, campos, paneles y encabezados reutilizan estilos compartidos y mejoran densidad sin perder foco."
  - "Navegar activa una transición visible y el movimiento reducido la deshabilita."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `9f743119a213`

## acceptance

- Repositorio, autor y versión son visibles con o sin proyecto, también con menú móvil cerrado.
- Botones, campos, paneles y encabezados reutilizan estilos compartidos y mejoran densidad sin perder foco.
- Navegar activa una transición visible y el movimiento reducido la deshabilita.
