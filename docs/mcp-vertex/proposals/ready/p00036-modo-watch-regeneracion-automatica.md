---
id: p00036
title: "p00036 — modo watch: regeneración automática de colecciones al detectar cambios en rutas"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
---

# p00036 — modo watch: regeneración automática de colecciones al detectar cambios en rutas

## Goal

Implementar un modo `--watch` en el CLI que vigile los archivos de rutas del
proyecto y regenere la colección Postman automáticamente cuando se detecten
cambios, integrándose perfectamente en el flujo de desarrollo diario.

## why

Obligar al desarrollador a ejecutar `bun run expostman` manualmente cada vez
que cambia una ruta rompe el flujo de trabajo. Un modo watch convertiría
`export-to-postman` en un **companion tool** que corre en segundo plano
durante el desarrollo, manteniendo la colección siempre sincronizada:

1. **Desarrollo ágil**: El desarrollador añade un endpoint nuevo, guarda el
   archivo, y la colección se actualiza sola en <500ms.
2. **Integración CI**: En un pipeline, `expostman --watch --timeout 5` puede
   verificar que la colección se mantiene sincronizada.
3. **Hot-reload de Postman**: Con Postman enlazado a un archivo local, el
   cambio se refleja directamente en la interfaz.

## non-goals

- Implementar un servidor HTTP de desarrollo para Postman.
- Usar polling (usar `fs.watch` / `chokidar` / `Bun.watch`).

## slices

### S1 — Watcher de archivos con debounce
- **Files**: `services/watcher.service.ts`.
- **Gate**: `bun test tests/unit/watcher.spec.ts`.
- Usa `fs.watch` (recursivo) con debounce de 300ms para evitar rebuilds
  repetidos durante `Ctrl+S` rápidos.

### S2 — Integración con el pipeline de generación
- **Files**: `scripts/cli.script.ts`, `scripts/generate.script.ts`.
- **Gate**: revisión manual.
- `expostman --watch --project-root ./mi-api` arranca el watcher tras la
  primera generación.

### S3 — Notificaciones de terminal
- **Files**: `helpers/tui-notify.helper.ts`.
- **Gate**: revisión manual.
- Imprime `[18:05:42] ✔ Collection regenerated (9 endpoints, 230ms)` en cada
  rebuild con timestamp y métricas delta.

## acceptance

- `expostman --watch` regenera la colección en <500ms al cambiar un archivo
  de rutas.
- Sin flag `--watch`, el comportamiento actual no cambia.
- `bun run validate` verde.
