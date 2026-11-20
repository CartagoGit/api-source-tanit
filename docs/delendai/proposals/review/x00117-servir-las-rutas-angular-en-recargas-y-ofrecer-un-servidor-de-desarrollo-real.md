---
id: x00117
title: "Servir las rutas Angular en recargas y ofrecer un servidor de desarrollo real"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-20
last-transition-id: 774b8f3b-f1ff-4536-8a62-8719a8e24084
last-correlation-id: 774b8f3b-f1ff-4536-8a62-8719a8e24084
last-transition-from: in-progress
last-transition-at: 2026-11-20T07:29:19.728Z
---

# x00117 — Servir las rutas Angular en recargas y ofrecer un servidor de desarrollo real

## goal

Abrir Tanit Angular desde código fuente y desplegar su build web con rutas que sobreviven a una recarga.

## why

ui:dev ejecuta la interfaz embebida antigua y las secciones Angular se guardan solo en memoria. Apache no recibe reglas para la SPA.

## non-goals

- Publicar la versión minor.
- Exponer por red la API que accede al sistema de archivos local.

## slices

- global_gate: lint

### S1 — Rutas Angular, compilación web y servidor Angular de desarrollo
- **Status**: review
- **Files**: `angular.json`, `package.json`, `packages/app/src/.htaccess`, `packages/app/src/index.html`, `packages/app/src/app/app.config.ts`, `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/state/project.store.ts`, `packages/app/src/app/shell/app-shell.component.ts`, `packages/app/src/app/shell/app-shell.component.html`, `packages/contracts/interfaces/core/bridge.interface.ts`, `packages/core/transport/http-bridge.server.ts`, `scripts/build/ui-dev.script.ts`, `scripts/build/ui-web.script.ts`, `tests/transport/ui-web-bridge.spec.ts`, `tests/app/host-bridge.spec.ts`, `tests/app/shell.spec.ts`, `docs/UI.md`, `docs/CLI.md`, `README.md`, `packages/app/src/app/features/endpoints/endpoints-list.component.ts`, `packages/app/src/app/features/exports/export-center.component.ts`
- **Gate**: e2e
- acceptance:
  - "bun run ui:dev inicia Angular en desarrollo con la Application API real y recarga tras editar código sin volver a compilar el ejecutable."
  - "bun run build:web entrega index.html y .htaccess. Apache sirve rutas de la SPA al recargar y conserva los recursos reales, el API y sus errores HTTP."
  - "El usuario puede recargar una sección abierta y recuperar su proyecto en la misma pestaña. El proxy local mantiene origen y token comprobados."
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol
- shipped-in: `7809496d44f3`

## acceptance

- bun run ui:dev inicia Angular en desarrollo con la Application API real y recarga tras editar código sin volver a compilar el ejecutable.
- bun run build:web entrega index.html y .htaccess. Apache sirve rutas de la SPA al recargar y conserva los recursos reales, el API y sus errores HTTP.
- El usuario puede recargar una sección abierta y recuperar su proyecto en la misma pestaña. El proxy local mantiene origen y token comprobados.
