---
id: f00025
title: "Identidad y componentes visuales compartidos en la app"
kind: feat
status: in-progress
type: proposal
track: ux
date: 2026-11-21
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
- **Status**: pending
- **Files**: `packages/app/src/styles.scss`, `packages/app/src/styles/motion.scss`, `packages/app/src/styles/primitives.scss`, `packages/app/src/styles/workflow.scss`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/shell/app-shell.component.html`, `packages/app/src/app/shell/app-shell.component.scss`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/core/host/external-link.service.ts`, `packages/app/src/app/core/app-metadata.ts`, `packages/app/src/app/shared/github-mark.component.ts`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/app/features/settings/settings.component.html`, `packages/app/src/app/features/settings/settings.component.scss`, `packages/app/src/app/features/help/help.component.html`, `packages/app/src/app/features/help/help.component.scss`, `packages/app/src/app/features/exports/export-center.component.html`, `packages/app/src/app/features/exports/export-center.component.scss`, `packages/app/src/app/features/help/help.component.ts`, `packages/app/src/app/features/check/check.component.html`, `packages/app/src/app/features/stats/stats.component.html`, `packages/app/src/app/features/sync/sync.component.html`, `packages/app/src/app/features/live/live-toggle.component.html`, `packages/app/src/app/features/validate/validate.component.html`, `packages/app/src/app/features/push/push-to-postman.component.html`, `tests/app/reachable.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Repositorio, autor y versión son visibles con o sin proyecto, también con menú móvil cerrado."
  - "Botones, campos, paneles y encabezados reutilizan estilos compartidos y mejoran densidad sin perder foco."
  - "Navegar activa una transición visible y el movimiento reducido la deshabilita."

## acceptance

- Repositorio, autor y versión son visibles con o sin proyecto, también con menú móvil cerrado.
- Botones, campos, paneles y encabezados reutilizan estilos compartidos y mejoran densidad sin perder foco.
- Navegar activa una transición visible y el movimiento reducido la deshabilita.
