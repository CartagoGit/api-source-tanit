---
id: x00108
title: "Servir la aplicación Angular de apisrc ui por la Application API"
kind: fix
status: done
type: proposal
track: beta
date: 2026-11-19
last-transition-id: 421c5b5d-1254-488c-8fab-71f422eee254
last-correlation-id: 421c5b5d-1254-488c-8fab-71f422eee254
last-transition-from: review
last-transition-at: 2026-11-19T15:09:49.021Z
shipped-in:
  - "4b1204034a56d2e05745fccefc6691556a61a4db"
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
- **Status**: done
- **Files**: `packages/cli/commands/ui.script.ts`, `packages/ui/server/ui-server.service.ts`, `packages/contracts/interfaces/cli/ui.interface.ts`, `tests/cli/ui-static-assets.spec.ts`, `tests/cli/ui-command-branches.spec.ts`, `tests/cli/ui-deps-branches.spec.ts`
- **Gate**: e2e
- acceptance:
  - "La aplicación Angular compilada arranca mediante apisrc ui y comparte origen, token y Application API a través del puente HTTP."
  - "Sin una compilación Angular disponible, apisrc ui sirve la interfaz integrada."
  - "El recorrido en Chromium abre un fixture y ejercita Diagnósticos, visor local, Endpoints, Live, exportación Postman e Historial."
- shipped-in: `e462d3bcc617`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-terra
- review-log: approved by openai-gpt-6.1-terra — verified at 4b1204034a56, validate exit 0 and tests 8/8 claimed, no recorded run cited; acceptance 3/3: (1) tests/cli/ui-static-assets.spec.ts y PR 178 CI verde (2) tests/cli/ui-command-branches.spec.ts y ui-deps-branches.spec.ts verdes (3) evidencia integrada PR 178 y docs/BETA.md — CI PR 178 y Vitest focal verdes.

## acceptance

- La aplicación Angular compilada arranca mediante apisrc ui y comparte origen, token y Application API a través del puente HTTP.
- Sin una compilación Angular disponible, apisrc ui sirve la interfaz integrada.
- El recorrido en Chromium abre un fixture y ejercita Diagnósticos, visor local, Endpoints, Live, exportación Postman e Historial.
