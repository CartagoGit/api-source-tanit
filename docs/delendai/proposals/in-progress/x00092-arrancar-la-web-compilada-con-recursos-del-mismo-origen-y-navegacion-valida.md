---
id: x00092
title: "Arrancar la web compilada con recursos del mismo origen y navegación válida"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: aef92982-f918-4e54-b1c8-2a76bf5e3bb0
last-correlation-id: aef92982-f918-4e54-b1c8-2a76bf5e3bb0
last-transition-from: ready
last-transition-at: 2026-11-09T14:34:22.701Z
---

# x00092 — Arrancar la web compilada con recursos del mismo origen y navegación válida

## goal

Eliminar la pantalla vacía de la web: permitir sus bundles locales en CSP y verificar bootstrap real en navegador, manteniendo token y comprobación de origen.

## why

TODO: why this work matters now.

## non-goals

- Cambios de autenticación o permisos de la Application API.

## slices

- global_gate: none

### S1 — Web compilada visible y protegida
- **Status**: done
- **Files**: `packages/core/transport/http-bridge.server.ts`, `tests/transport/ui-web-bridge.spec.ts`
- **Gate**: e2e
- acceptance:
  - "El navegador carga CSS y JavaScript del mismo origen sin bloqueo CSP."
  - "La aplicación renderiza su shell y no sólo devuelve HTTP 200."
  - "Origen y token siguen protegiendo la Application API."

## acceptance

- El navegador carga CSS y JavaScript del mismo origen sin bloqueo CSP.
- La aplicación renderiza su shell y no sólo devuelve HTTP 200.
- Origen y token siguen protegiendo la Application API.

## evidence

- Real production build returned HTTP 200 but Chrome rendered a blank page. Browser console reported CSP rejecting its own main/polyfills JavaScript and stylesheet.
- Same-origin script/style permissions now allow the compiled app to bootstrap; Chrome DOM reports Angular 20.3.30 and the shell renders. Screenshot verified locally.
- Browser verification uses a temporary profile, `--password-store=basic` and isolated D-Bus environment to avoid desktop keyring prompts on WSL.
- CSP regression checks retain default-src none, same-origin API connections, token/origin checks, and prohibit wildcard scripts/unsafe-eval.
- Same-origin source expressions follow https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src .
