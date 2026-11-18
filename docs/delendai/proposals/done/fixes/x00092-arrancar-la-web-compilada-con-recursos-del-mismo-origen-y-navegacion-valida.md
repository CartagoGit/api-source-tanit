---
id: x00092
title: "Arrancar la web compilada con recursos del mismo origen y navegación válida"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 6a3a4157-8f64-443b-807e-328599f4d8ee
last-correlation-id: 6a3a4157-8f64-443b-807e-328599f4d8ee
last-transition-from: review
last-transition-at: 2026-11-11T00:43:54.911Z
shipped-in:
  - "bcf04e22c26af4f82af4a6191d59f29243a9a98e"
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
- shipped-in: `f6c2d1bd9ccc`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at bcf04e22c26a, validate exit 0 and tests 6/6 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed landed CSP: script-src and style-src permit self while default-src stays none. bun test tests/transport/ui-web-bridge.spec.ts passed 6/6 including the… (2) Inspected existing manual browser evidence (not rerun): /tmp/tanit-beta-web-fixed.png visibly shows the Tanit shell; /tmp/tanit-beta-web-fixed-dom.html contain… (3) Reviewed unchanged origin guard in http-bridge.server.ts (rejects a nonmatching supplied Origin) and token guard; focused Bun test verifies same-origin API suc… — Approved after focused Bun tests (6/6), source review, and inspection of persisted prior browser evidence. Browser screenshot was not rerun; origin enforcement was verified in code, while the focused test directly exercises token rejection.

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
