---
id: x00108
title: "Servir la aplicación Angular de apisrc ui por la Application API"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-19
last-transition-id: 30c446b2-c8a5-410e-b82c-fc7b5c421d05
last-correlation-id: 30c446b2-c8a5-410e-b82c-fc7b5c421d05
last-transition-from: in-progress
last-transition-at: 2026-11-19T00:36:57.725Z
---

# x00108 — Servir la aplicación Angular de apisrc ui por la Application API

## goal

La aplicación compilada inicia en el navegador y usa el registro y el snapshot compartidos con escritorio.

## why

Navegador real: apisrc ui bloqueó los módulos y la hoja de estilos. El servidor integrado espera otro token y rutas. El mismo build pasó apertura, diagnósticos, visor local, endpoints, Live, exportación e historial mediante el puente HTTP existente.

## non-goals

- Cambiar la Application API, sus controles HTTP o la distribución del binario.

## slices

- global_gate: none

### S1 — Conectar apisrc ui al puente HTTP de la aplicación compilada
- **Status**: review
- **Files**: `packages/cli/commands/ui.script.ts`, `packages/ui/server/ui-server.service.ts`, `packages/contracts/interfaces/cli/ui.interface.ts`, `tests/cli/ui-static-assets.spec.ts`, `tests/cli/ui-command-branches.spec.ts`, `tests/cli/ui-deps-branches.spec.ts`
- **Gate**: e2e
- acceptance:
  - "La aplicación Angular compilada arranca mediante apisrc ui y comparte origen, token y Application API a través del puente HTTP."
  - "Sin una compilación Angular disponible, apisrc ui sirve la interfaz integrada."
  - "El recorrido en Chromium abre un fixture y ejercita Diagnósticos, visor local, Endpoints, Live, exportación Postman e Historial."
- shipped-in: `e462d3bcc617`
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol

## acceptance

- La aplicación Angular compilada arranca mediante apisrc ui y comparte origen, token y Application API a través del puente HTTP.
- Sin una compilación Angular disponible, apisrc ui sirve la interfaz integrada.
- El recorrido en Chromium abre un fixture y ejercita Diagnósticos, visor local, Endpoints, Live, exportación Postman e Historial.
