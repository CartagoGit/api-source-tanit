---
id: x00129
title: "Navegación fluida y presentación coherente de Resumen"
kind: fix
status: in-progress
type: proposal
track: ux
date: 2026-11-21
---

# x00129 — Navegación fluida y presentación coherente de Resumen

## goal

Mantener estable el área de trabajo durante navegación y reutilizar la cabecera, los paneles y estados de controles en Resumen.

## why

La entrada tarda en aparecer mientras la vista anterior se desmonta inmediatamente; al cerrar el menú móvil cambia el espacio del contenido.

## non-goals

- Cambiar los datos que lee una vista o el historial de URLs.

## slices

- global_gate: lint

### S1 — Cruzar las vistas y estabilizar el marco de navegación
- **Status**: pending
- **Files**: `packages/app/src/styles/motion.scss`, `packages/app/src/styles/primitives.scss`, `packages/app/src/styles/workflow.scss`, `packages/app/src/app/shell/app-shell.component.ts`, `packages/app/src/app/shell/app-shell.component.html`, `packages/app/src/app/shell/app-shell.component.scss`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/features/home/home.component.html`, `packages/app/src/app/features/home/home.component.scss`, `packages/app/src/app/features/home/folder-picker.component.html`, `packages/app/src/app/features/home/folder-picker.component.scss`, `packages/app/src/app/features/home/recent-projects.component.html`, `packages/app/src/app/features/home/recent-projects.component.scss`, `packages/app/src/app/features/settings/settings.component.html`, `packages/app/src/app/features/settings/settings.component.scss`, `packages/app/src/app/features/help/help.component.html`, `packages/app/src/app/features/help/help.component.scss`, `packages/app/src/app/features/check/check.component.html`, `packages/app/src/app/features/stats/stats.component.html`, `packages/app/src/app/features/sync/sync.component.html`, `packages/app/src/app/features/live/live-toggle.component.html`, `packages/app/src/app/features/validate/validate.component.html`, `packages/app/src/app/features/push/push-to-postman.component.html`, `tests/app/shell.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "El cambio anima salida y entrada, conserva la navegación Atrás/Adelante y funciona sin la API nativa y con movimiento reducido."
  - "Abrir o cerrar el menú móvil no desplaza la vista."
  - "Resumen usa cabecera, paneles y controles visuales compartidos con estados de hover y foco coherentes."

## acceptance

- El cambio anima salida y entrada, conserva la navegación Atrás/Adelante y funciona sin la API nativa y con movimiento reducido.
- Abrir o cerrar el menú móvil no desplaza la vista.
- Resumen usa cabecera, paneles y controles visuales compartidos con estados de hover y foco coherentes.
