---
id: x00108
title: "Servir la aplicación Angular de apisrc ui por la Application API"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-19
last-transition-id: cafb3f36-301a-4cde-b55f-163d85a19cc2
last-correlation-id: cafb3f36-301a-4cde-b55f-163d85a19cc2
last-transition-from: ready
last-transition-at: 2026-11-19T00:32:43.650Z
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
- **Status**: pending
- **Files**: `packages/cli/commands/ui.script.ts`, `packages/ui/server/ui-server.service.ts`, `packages/contracts/interfaces/cli/ui.interface.ts`, `tests/cli/ui-static-assets.spec.ts`, `tests/cli/ui-command-branches.spec.ts`, `tests/cli/ui-deps-branches.spec.ts`
- **Gate**: e2e

## acceptance

- TODO: observable acceptance criteria.
