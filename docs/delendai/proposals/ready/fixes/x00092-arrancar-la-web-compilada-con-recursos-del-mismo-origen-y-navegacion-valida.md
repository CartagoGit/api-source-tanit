---
id: x00092
title: "Arrancar la web compilada con recursos del mismo origen y navegación válida"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-09
---

# x00092 — Arrancar la web compilada con recursos del mismo origen y navegación válida

## goal

Eliminar la pantalla vacía de la web: permitir sus bundles locales en CSP y verificar bootstrap real en navegador, manteniendo token y comprobación de origen.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Web compilada visible y protegida
- **Status**: pending
- **Files**: `packages/core/transport/http-bridge.server.ts`, `tests/transport/ui-web-bridge.spec.ts`, `packages/app/src/index.html`
- **Gate**: e2e
- acceptance:
  - "El navegador carga CSS y JavaScript del mismo origen sin bloqueo CSP."
  - "La aplicación renderiza su shell y no sólo devuelve HTTP 200."
  - "Origen y token siguen protegiendo la Application API."

## acceptance

- El navegador carga CSS y JavaScript del mismo origen sin bloqueo CSP.
- La aplicación renderiza su shell y no sólo devuelve HTTP 200.
- Origen y token siguen protegiendo la Application API.
