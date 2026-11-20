---
id: x00116
title: "Hacer operativa la apertura de proyectos en la web y renovar el espacio de trabajo"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-20
---

# x00116 — Hacer operativa la apertura de proyectos en la web y renovar el espacio de trabajo

## goal

Convertir el inicio de Tanit en un flujo de trabajo claro y funcional desde web y escritorio.

## why

La prueba Chromium registra cero llamadas al pulsar Abrir carpeta en web y el explorador carece de selección. La navegación antes de abrir una sesión confunde con acciones que aún no pueden operar.

## non-goals

- Publicar la versión minor o cambiar la API compartida.

## slices

- global_gate: lint

### S1 — Reparar selector web y renovar navegación y espacios de trabajo
- **Status**: pending
- **Files**: `packages/app/src/app/shell/app-shell.component.ts`, `packages/app/src/app/shell/app-shell.component.html`, `packages/app/src/app/shell/app-shell.component.scss`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/shell/command-palette.component.html`, `packages/app/src/app/features/home/folder-picker.component.ts`, `packages/app/src/app/features/home/folder-picker.component.html`, `packages/app/src/app/features/home/folder-picker.component.scss`, `packages/app/src/app/features/home/home.component.ts`, `packages/app/src/app/features/home/home.component.html`, `packages/app/src/app/features/home/home.component.scss`, `packages/app/src/app/core/state/project.store.ts`, `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/host/dialog.service.ts`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/styles/tokens.scss`, `tests/app/shell.spec.ts`, `tests/app/host-bridge.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Desde Chromium y la UI compilada, el botón explora carpetas mediante la Application API y abre la carpeta elegida. Una ruta pegada también se puede abrir. Carga y errores son visibles, y un fallo conserva un proyecto previamente abierto."
  - "La primera vista prioriza abrir el proyecto; la navegación muestra operativas las secciones cuando se abre. El título responde a la vista y el atajo anunciado funciona sin referencia a un fabricante."
  - "El flujo real permite abrir el fixture, ver endpoints y acceder a exportación, historial y ajustes. El conector de escritorio acepta core.invoke de Tauri 2."

## acceptance

- Desde Chromium y la UI compilada, el botón explora carpetas mediante la Application API y abre la carpeta elegida. Una ruta pegada también se puede abrir. Carga y errores son visibles, y un fallo conserva un proyecto previamente abierto.
- La primera vista prioriza abrir el proyecto; la navegación muestra operativas las secciones cuando se abre. El título responde a la vista y el atajo anunciado funciona sin referencia a un fabricante.
- El flujo real permite abrir el fixture, ver endpoints y acceder a exportación, historial y ajustes. El conector de escritorio acepta core.invoke de Tauri 2.
