---
id: x00086
title: "Actualizaciones Live comunes y cancelación sin listeners retenidos"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: a4d9a9ce-1189-47d4-aa7c-c4aed5295d5f
last-correlation-id: a4d9a9ce-1189-47d4-aa7c-c4aed5295d5f
last-transition-from: review
last-transition-at: 2026-11-10T18:23:44.831Z
shipped-in:
  - "44a9237b01db93db8f15bc57e734c4ae2b9de684"
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
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 44a9237b01db, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 2/2: (1) Reviewed watch/cancel/close handlers and tests/application-api/watch.handlers.spec.ts for cleanup and no post-cancel history. (2) Reviewed the same watch handler tests for idempotent subscription ownership and callback counts. — Independent review at landed develop source 44a9237b01db93db8f15bc57e734c4ae2b9de684. Reused actual governed validation from the prior review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975, two platform skips; journal timestamp 2026-11-09T15:37:21.268Z at the prior unit path .cache/delendai/results/logs/validate.jsonl. It was not rerun in this unit. Tracked source diff from validated 3e02acdb to this snapshot is empty outside proposal metadata. Fresh lint:docs and lint:proposals both pass. Independent source review; no changes requested.

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
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at 44a9237b01db, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed both HTTP and stdio transport event paths, host bridge, live store, and transport/app regression tests. (2) Reviewed live event helper and rescan failure tests asserting the valid snapshot is retained while diagnostics are emitted. (3) Reviewed exports store and shared export service path used by live autoexport. — Independent review at landed develop source 44a9237b01db93db8f15bc57e734c4ae2b9de684. Reused actual governed validation from the prior review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975, two platform skips; journal timestamp 2026-11-09T15:37:21.268Z at the prior unit path .cache/delendai/results/logs/validate.jsonl. It was not rerun in this unit. Tracked source diff from validated 3e02acdb to this snapshot is empty outside proposal metadata. Fresh lint:docs and lint:proposals both pass. Independent source review; no changes requested.

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
