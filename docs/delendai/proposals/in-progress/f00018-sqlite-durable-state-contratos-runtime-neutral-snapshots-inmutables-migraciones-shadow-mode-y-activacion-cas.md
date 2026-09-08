---
id: f00018
title: "SQLite durable state — contratos runtime-neutral, snapshots inmutables, migraciones, shadow mode y activación CAS"
kind: feat
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-09-08
last-transition-id: b6fcfac2-271f-46aa-86a9-1b9599ae8dd5
last-correlation-id: b6fcfac2-271f-46aa-86a9-1b9599ae8dd5
last-transition-from: ready
---

# f00018 — SQLite durable state — contratos runtime-neutral, snapshots inmutables, migraciones, shadow mode y activación CAS

## Goal

Introducir la persistencia durable interna de Tanit detrás de contratos runtime-neutral, sin convertir SQLite en autoridad hasta demostrar paridad completa con el snapshot en memoria. La primera entrega añade el modelo de estado, migraciones versionadas, repositorio bun:sqlite, activación atómica con control optimista de concurrencia y escritura shadow.

## why

Tanit necesita conservar snapshots canónicos, history y diffs para que CLI, UI, Desktop, MCP y exporters consulten una misma memoria durable. La persistencia debe esperar a que OperationId, serverRef, authRef y el snapshot universal estén estabilizados, y debe proteger el último snapshot válido frente a scans fallidos o carreras entre procesos.

## non-goals

- No convertir SQLite en la fuente oficial de lecturas en esta propuesta.
- No persistir AST pesado, secretos resueltos ni representación Postman como modelo canónico.
- No importar bun:sqlite desde contracts o core/domain.
- No migrar todos los consumidores CLI/UI/MCP en el primer lote.
- No añadir una base SQLite dentro de cada proyecto analizado por defecto.

## Slices

- global_gate: e2e

### S1-state-contracts-and-canonical-serialization — S1 — Contratos de estado, IDs estables y serialización canónica
- **Status**: done
- **Files**: `packages/contracts/interfaces/core/state-store.interface.ts`, `packages/contracts/interfaces/core/project-state.interface.ts`, `packages/contracts/interfaces/core/snapshot-store.interface.ts`, `packages/contracts/interfaces/core/stable-ids.interface.ts`, `packages/core/state/canonical-snapshot.serializer.ts`, `packages/core/state/stable-id.service.ts`, `tests/core/state/canonical-snapshot.serializer.spec.ts`, `tests/contracts/state-store.contract.spec.ts`
- **Gate**: type
- acceptance:
  - "Los contratos son runtime-neutral y no importan bun:sqlite."
  - "ProjectId, SnapshotId, ServiceId, OperationId, SchemaId, ServerRef y AuthRef tienen representación estable y explícita; ninguna identidad depende de la posición del array o del autoincrement de SQLite."
  - "La serialización canónica es determinista, redacts secretos y produce un digest estable para el mismo snapshot semántico."
  - "El estado persistible distingue snapshot building, complete y failed, y no permite activar uno incompleto."
  - "Tests cubren IDs, orden determinista, redacción de credenciales y round-trip del snapshot canónico."
- review-state: done
- review-implementer: delendai-impl-20260908
- review-reviewer: delivery_verifier
- review-log: approved by delivery_verifier — Revisión independiente completada. S1 implementa contratos runtime-neutral, IDs explícitos, serializer determinista con redacción/digest, estados y activación sólo complete. Naming gate queda bloqueado por regla preexistente que no contempla el path obligatorio packages/core/state/canonical-snapshot.serializer.ts.
### S2-sqlite-schema-and-migrations — S2 — Esquema SQLite versionado, migraciones y configuración de ubicación
- **Status**: pending
- **DependsOn**: [S1-state-contracts-and-canonical-serialization]
- **Files**: `packages/core/state/sqlite/schema.sql`, `packages/core/state/sqlite/migrations.ts`, `packages/core/state/sqlite/sqlite-connection.adapter.ts`, `packages/core/state/sqlite/state-db-path.service.ts`, `packages/contracts/constants/core/state-store.constant.ts`, `tests/core/state/sqlite/migrations.spec.ts`, `tests/core/state/sqlite/connection.spec.ts`, `docs/STATE.md`
- **Gate**: e2e
- acceptance:
  - "El esquema usa PRAGMA user_version o equivalente y migraciones forward-only reproducibles."
  - "Existen tablas separadas para projects, snapshots, services, operations, servers, auth_profiles, schemas, diagnostics, provenance y source_files; las partes variables usan JSON solo donde el contrato lo permite."
  - "La ubicación por defecto es global por usuario y admite TANIT_STATE_DB para tests, CI, Docker y modo portable."
  - "La conexión activa foreign_keys, WAL y busy_timeout sin guardar secretos."
  - "Tests cubren base vacía, migración v1 a v2, versión futura desconocida, base corrupta y rollback de migración."
- review-state: in_review
- review-implementer: delendai-impl-20260909
### S3-immutable-snapshot-repository-and-cas — S3 — Repositorio SQLite de snapshots inmutables, transacciones y activación CAS
- **Status**: pending
- **DependsOn**: [S2-sqlite-schema-and-migrations]
- **Files**: `packages/core/state/sqlite/sqlite-snapshot.repository.ts`, `packages/core/state/sqlite/sqlite-project.repository.ts`, `packages/core/state/snapshot-transaction.service.ts`, `packages/core/state/snapshot-activation.service.ts`, `tests/core/state/sqlite/snapshot-repository.spec.ts`, `tests/core/state/sqlite/activation-cas.spec.ts`, `tests/core/state/sqlite/crash-recovery.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cada scan escribe un snapshot completo dentro de una transacción; un fallo deja intacto el active_snapshot_id anterior."
  - "Los snapshots completos son inmutables y la activación usa revision optimista: una ejecución vieja no puede sustituir una más nueva."
  - "El repositorio permite restart, history y lectura del snapshot activo sin reescanear el proyecto."
  - "No se persisten tokens, passwords, API keys ni refresh tokens; auth conserva refs y metadata no sensible."
  - "Tests cubren commit atómico, rollback, reinicio, dos writers concurrentes, CAS perdido y ausencia de secretos."

### S4-shadow-persistence-parity-and-doctor — S4 — Escritura shadow, paridad de digest y diagnóstico de estado
- **Status**: pending
- **DependsOn**: [S3-immutable-snapshot-repository-and-cas]
- **Files**: `packages/core/state/shadow-state-writer.service.ts`, `packages/core/state/state-parity.service.ts`, `packages/cli/commands/doctor.script.ts`, `packages/cli/commands/scan.script.ts`, `tests/core/state/shadow-state-writer.spec.ts`, `tests/core/state/state-parity.spec.ts`, `tests/cli/doctor-command.test.ts`, `docs/CLI.md`
- **Gate**: e2e
- acceptance:
  - "Un scan exitoso puede escribir el snapshot a SQLite en shadow sin cambiar aún la autoridad de lectura legacy."
  - "La paridad compara digest canónico en memoria y SQLite y produce diagnostics estructurados cuando difieren."
  - "doctor --json informa versión de DB, migración, snapshot activo, última escritura, corrupción, paridad y secretos omitidos."
  - "La escritura shadow es opt-in y no altera el comportamiento si la DB no está disponible; el fallo queda diagnosticado, no oculto."
  - "Tests cubren shadow disabled/enabled, paridad igual/desigual, DB ausente, restart y salida JSON estable."

## acceptance

- Los contratos son runtime-neutral y no importan bun:sqlite.
- ProjectId, SnapshotId, ServiceId, OperationId, SchemaId, ServerRef y AuthRef tienen representación estable y explícita; ninguna identidad depende de la posición del array o del autoincrement de SQLite.
- La serialización canónica es determinista, redacts secretos y produce un digest estable para el mismo snapshot semántico.
- El estado persistible distingue snapshot building, complete y failed, y no permite activar uno incompleto.
- Tests cubren IDs, orden determinista, redacción de credenciales y round-trip del snapshot canónico.
- El esquema usa PRAGMA user_version o equivalente y migraciones forward-only reproducibles.
- Existen tablas separadas para projects, snapshots, services, operations, servers, auth_profiles, schemas, diagnostics, provenance y source_files; las partes variables usan JSON solo donde el contrato lo permite.
- La ubicación por defecto es global por usuario y admite TANIT_STATE_DB para tests, CI, Docker y modo portable.
- La conexión activa foreign_keys, WAL y busy_timeout sin guardar secretos.
- Tests cubren base vacía, migración v1 a v2, versión futura desconocida, base corrupta y rollback de migración.
- Cada scan escribe un snapshot completo dentro de una transacción; un fallo deja intacto el active_snapshot_id anterior.
- Los snapshots completos son inmutables y la activación usa revision optimista: una ejecución vieja no puede sustituir una más nueva.
- El repositorio permite restart, history y lectura del snapshot activo sin reescanear el proyecto.
- No se persisten tokens, passwords, API keys ni refresh tokens; auth conserva refs y metadata no sensible.
- Tests cubren commit atómico, rollback, reinicio, dos writers concurrentes, CAS perdido y ausencia de secretos.
- Un scan exitoso puede escribir el snapshot a SQLite en shadow sin cambiar aún la autoridad de lectura legacy.
- La paridad compara digest canónico en memoria y SQLite y produce diagnostics estructurados cuando difieren.
- doctor --json informa versión de DB, migración, snapshot activo, última escritura, corrupción, paridad y secretos omitidos.
- La escritura shadow es opt-in y no altera el comportamiento si la DB no está disponible; el fallo queda diagnosticado, no oculto.
- Tests cubren shadow disabled/enabled, paridad igual/desigual, DB ausente, restart y salida JSON estable.
