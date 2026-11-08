---
id: x00086
title: "Actualizaciones Live comunes y cancelación sin listeners retenidos"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-08
---

# x00086 — Actualizaciones Live comunes y cancelación sin listeners retenidos

## goal

Una suscripción activa el watcher y entrega eventos comunes a navegador y desktop; cancelar libera todos los callbacks.

## why

watch.handlers.ts retiene callbacks tras cancelar; la app abre sin watch, navegador carece del canal de eventos y los stores esperan otro payload.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: e2e

### S1 — Propiedad y liberación de suscripciones
- **Status**: pending
- **Files**: `packages/core/application-api/watch.handlers.ts`, `tests/application-api/watch.handlers.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cancelar elimina listeners y no añade historial posterior."
  - "Suscripciones repetidas no duplican callbacks."

### S2 — Eventos comunes desde sesión a clientes
- **Status**: pending
- **Files**: `packages/core/transport`, `packages/app/src/app/core`, `packages/contracts/interfaces/core/application-api.interface.ts`, `tests/transport`
- **Gate**: e2e
- acceptance:
  - "Editar una fuente actualiza snapshot y UI por HTTP y stdio."
  - "Fallo de rescan conserva snapshot válido y publica diagnóstico."
  - "Autoexport usa el mismo servicio de exportación."

## acceptance

- Cancelar elimina listeners y no añade historial posterior.
- Suscripciones repetidas no duplican callbacks.
- Editar una fuente actualiza snapshot y UI por HTTP y stdio.
- Fallo de rescan conserva snapshot válido y publica diagnóstico.
- Autoexport usa el mismo servicio de exportación.
