---
id: x00086
title: "Actualizaciones Live comunes y cancelación sin listeners retenidos"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 2c7ff4af-2f5d-4a96-991c-28922caa3f18
last-correlation-id: 2c7ff4af-2f5d-4a96-991c-28922caa3f18
last-transition-from: review
last-transition-at: 2026-11-09T07:23:45.981Z
---

# x00086 — Actualizaciones Live comunes y cancelación sin listeners retenidos

## goal

Una suscripción activa el watcher y entrega eventos comunes a navegador y desktop; cancelar libera todos los callbacks.

## why

watch.handlers.ts retiene callbacks tras cancelar; la app abre sin watch, navegador carece del canal de eventos y los stores esperan otro payload.

## non-goals

- Nuevos exporters o scanners; Live consume los servicios compartidos existentes.
- Diálogos de consentimiento adicionales: autoexport conserva el flujo del Export Center y sólo reutiliza destinos ya aprobados.

## slices

- global_gate: e2e

### S1 — Propiedad y liberación de suscripciones
- **Status**: done
- **Files**: `packages/core/application-api/watch.handlers.ts`, `packages/core/application-api/cancel.handler.ts`, `packages/core/application-api/close.handler.ts`, `tests/application-api/watch.handlers.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cancelar elimina listeners y no añade historial posterior."
  - "Suscripciones repetidas no duplican callbacks."
- shipped-in: `6de02a85e708`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

### S2 — Eventos comunes desde sesión a clientes
- **DependsOn**: [S1]
- **Status**: done
- **Files**: `packages/core/application-api/watch.handlers.ts`, `packages/core/application-api/cancel.handler.ts`, `packages/core/application-api/close.handler.ts`, `packages/core/transport/http-bridge.server.ts`, `packages/core/transport/stdio-bridge.server.ts`, `packages/core/helpers/live-event.helper.ts`, `packages/contracts/interfaces/core/application-api.interface.ts`, `packages/contracts/interfaces/core/live.interface.ts`, `packages/contracts/interfaces/runtime.d.ts`, `packages/app/src/app/core/api/host-bridge.client.ts`, `packages/app/src/app/core/state/live.store.ts`, `packages/app/src/app/core/state/project.store.ts`, `packages/app/src/app/core/state/exports.store.ts`, `tests/transport/live-events.spec.ts`, `tests/app/live-store.spec.ts`, `tests/app/host-bridge.spec.ts`, `tests/app/cli-parity.spec.ts`, `tests/app/sections-load.spec.ts`, `tests/core/live-event.helper.spec.ts`, `tests/application-api/watch.handlers.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Editar una fuente actualiza snapshot y UI por HTTP y stdio."
  - "Fallo de rescan conserva snapshot válido y publica diagnóstico."
  - "Autoexport usa el mismo servicio de exportación."
- shipped-in: `6de02a85e708`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- Cancelar elimina listeners y no añade historial posterior.
- Suscripciones repetidas no duplican callbacks.
- Editar una fuente actualiza snapshot y UI por HTTP y stdio.
- Fallo de rescan conserva snapshot válido y publica diagnóstico.
- Autoexport usa el mismo servicio de exportación.

## Implementation evidence

- The session observer is shared by subscribers; cancellation, direct close, close-all and transport disconnect dispose callbacks and implicitly enabled watch leases.
- Both carriers emit the same typed Live payload. HTTP streams validate token, origin and subscription ownership; stdio continues reading cancellation controls during an in-flight request.
- The app updates only its current session, rejects obsolete activation responses, reports rescan failures without losing the valid snapshot and clears errors on recovery.
- Autoexport uses the Export Center preview/write path, retains original overwrite/outside-workspace consent and filters generated artifacts/atomic temporary writes to prevent feedback loops.
- Focused verification after refreshing develop: 51 Vitest cases and 35 native HTTP/stdio cases pass. The full delivery gate certifies this complete candidate before publication.
