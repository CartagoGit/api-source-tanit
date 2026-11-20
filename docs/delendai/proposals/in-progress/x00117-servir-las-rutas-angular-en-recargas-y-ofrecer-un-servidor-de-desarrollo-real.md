---
id: x00117
title: "Servir las rutas Angular en recargas y ofrecer un servidor de desarrollo real"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-20
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
- **Status**: pending
- **Files**: `angular.json`, `package.json`, `packages/app/src/.htaccess`, `packages/app/src/index.html`, `packages/app/src/app/app.config.ts`, `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/state/project.store.ts`, `packages/app/src/app/shell/app-shell.component.ts`, `packages/app/src/app/shell/app-shell.component.html`, `packages/contracts/interfaces/core/bridge.interface.ts`, `packages/core/transport/http-bridge.server.ts`, `scripts/build/ui-dev.script.ts`, `scripts/build/ui-web.script.ts`, `tests/transport/ui-web-bridge.spec.ts`, `tests/app/host-bridge.spec.ts`, `tests/app/shell.spec.ts`, `docs/UI.md`, `docs/CLI.md`, `README.md`
- **Gate**: e2e
- acceptance:
  - "bun run ui:dev inicia Angular en desarrollo con la Application API real y recarga tras editar código sin volver a compilar el ejecutable."
  - "bun run build:web entrega index.html y .htaccess. Apache sirve rutas de la SPA al recargar y conserva los recursos reales, el API y sus errores HTTP."
  - "El usuario puede recargar una sección abierta y recuperar su proyecto en la misma pestaña. El proxy local mantiene origen y token comprobados."

## acceptance

- bun run ui:dev inicia Angular en desarrollo con la Application API real y recarga tras editar código sin volver a compilar el ejecutable.
- bun run build:web entrega index.html y .htaccess. Apache sirve rutas de la SPA al recargar y conserva los recursos reales, el API y sus errores HTTP.
- El usuario puede recargar una sección abierta y recuperar su proyecto en la misma pestaña. El proxy local mantiene origen y token comprobados.
