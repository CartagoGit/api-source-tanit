---
id: x00116
title: "Hacer operativa la apertura de proyectos en la web y renovar el espacio de trabajo"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-20
last-transition-id: d37148d3-d254-4fba-b688-0bb48811121f
last-correlation-id: d37148d3-d254-4fba-b688-0bb48811121f
last-transition-from: in-progress
last-transition-at: 2026-11-20T07:06:53.727Z
---

# x00116 — Hacer operativa la apertura de proyectos en la web y renovar el espacio de trabajo

## goal

Convertir el inicio de Tanit en un flujo de trabajo claro y funcional desde web y escritorio.

## why

La prueba Chromium registra cero llamadas al pulsar Abrir carpeta en web y el explorador carece de selección. La navegación antes de abrir una sesión confunde con acciones que aún no pueden operar.

## non-goals

- Publicar la versión minor.

## slices

- global_gate: lint

### S1 — Reparar selector web y renovar navegación y espacios de trabajo
- **Status**: review
- **Files**: `packages/app/src/app/shell/app-shell.component.ts`, `packages/app/src/app/shell/app-shell.component.html`, `packages/app/src/app/shell/app-shell.component.scss`, `packages/app/src/app/shell/sidebar.component.ts`, `packages/app/src/app/shell/sidebar.component.html`, `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/shell/command-palette.component.html`, `packages/app/src/app/features/home/folder-picker.component.ts`, `packages/app/src/app/features/home/folder-picker.component.html`, `packages/app/src/app/features/home/folder-picker.component.scss`, `packages/app/src/app/features/home/home.component.ts`, `packages/app/src/app/features/home/home.component.html`, `packages/app/src/app/features/home/home.component.scss`, `packages/app/src/app/core/state/project.store.ts`, `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/host/dialog.service.ts`, `packages/app/src/app/core/i18n/locales/es.json`, `packages/app/src/app/core/i18n/locales/en.json`, `packages/app/src/app/core/i18n/locales/fr.json`, `packages/app/src/styles/tokens.scss`, `tests/app/shell.spec.ts`, `tests/app/host-bridge.spec.ts`, `docs/delendai/AGENT-BOOTSTRAP.md`, `packages/app/src/app/features/exports/export-center.component.ts`, `packages/app/src/app/features/exports/export-center.component.html`, `packages/app/src/app/features/exports/export-summary.component.ts`, `packages/app/src/app/features/exports/export-summary.component.html`, `packages/app/src/app/features/endpoints/endpoint-detail.component.ts`, `packages/app/src/app/features/endpoints/endpoint-detail.component.html`, `packages/app/src/app/features/endpoints/endpoints-list.component.ts`, `packages/app/src/app/features/endpoints/endpoints-list.component.html`, `packages/app/src/app/core/state/exports.store.ts`, `tests/app/reachable.spec.ts`, `packages/core/exporters/export-files.service.ts`, `packages/contracts/interfaces/core/application-api.interface.ts`, `packages/app/src/app/core/api/exports.client.ts`, `tests/core/export-destination.spec.ts`, `tests/app/export-center.spec.ts`, `tests/app/truth.spec.ts`, `tests/app/project-verbs.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Desde Chromium y la UI compilada, el botón explora carpetas mediante la Application API y abre la carpeta elegida. Una ruta pegada también se puede abrir. Carga y errores son visibles, y un fallo conserva un proyecto previamente abierto."
  - "La primera vista prioriza abrir el proyecto; la navegación muestra operativas las secciones cuando se abre. El título responde a la vista y el atajo anunciado funciona sin referencia a un fabricante."
  - "El flujo real permite abrir el fixture, ver endpoints y acceder a exportación, historial y ajustes. El conector de escritorio acepta core.invoke de Tauri 2."

  - "La previsualización compartida clasifica los destinos internos y externos en el sistema que escribe los archivos, incluido Windows."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `65001ce091e7`

## acceptance

- Desde Chromium y la UI compilada, el botón explora carpetas mediante la Application API y abre la carpeta elegida. Una ruta pegada también se puede abrir. Carga y errores son visibles, y un fallo conserva un proyecto previamente abierto.
- La primera vista prioriza abrir el proyecto; la navegación muestra operativas las secciones cuando se abre. El título responde a la vista y el atajo anunciado funciona sin referencia a un fabricante.
- El flujo real permite abrir el fixture, ver endpoints y acceder a exportación, historial y ajustes. El conector de escritorio acepta core.invoke de Tauri 2.
- La previsualización compartida clasifica los destinos internos y externos en el sistema que escribe los archivos, incluido Windows.
