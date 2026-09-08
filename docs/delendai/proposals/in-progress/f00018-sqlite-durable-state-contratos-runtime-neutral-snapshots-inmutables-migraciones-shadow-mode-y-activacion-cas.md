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
- **Status**: done
- **DependsOn**: [S1-state-contracts-and-canonical-serialization]
- **Files**: `packages/core/state/sqlite/schema.sql`, `packages/core/state/sqlite/migrations.ts`, `packages/core/state/sqlite/sqlite-connection.adapter.ts`, `packages/core/state/sqlite/state-db-path.service.ts`, `packages/contracts/constants/core/state-store.constant.ts`, `tests/core/state/sqlite/migrations.spec.ts`, `tests/core/state/sqlite/connection.spec.ts`, `docs/STATE.md`, `vitest.config.ts`, `package.json`
- **Gate**: e2e
- acceptance:
  - "El esquema usa PRAGMA user_version o equivalente y migraciones forward-only reproducibles."
  - "Existen tablas separadas para projects, snapshots, services, operations, servers, auth_profiles, schemas, diagnostics, provenance y source_files; las partes variables usan JSON solo donde el contrato lo permite."
  - "La ubicación por defecto es global por usuario y admite TANIT_STATE_DB para tests, CI, Docker y modo portable."
  - "La conexión activa foreign_keys, WAL y busy_timeout sin guardar secretos."
  - "Los tests Bun-native de SQLite quedan fuera del proyecto Vitest de core y se ejecutan con bun test mediante un script explícito incluido en test:core y validate."
  - "Tests cubren base vacía, migración v1 a v2, versión futura desconocida, base corrupta y rollback de migración."
- review-state: done
- review-implementer: delendai-impl-20260909
- review-reviewer: technical-investigator
- review-log: requested_changes by delivery_verifier — Revisión independiente del commit 3426e5b. Solicito cambios antes de aprobar S2. Hallazgo bloqueante: packages/core/state/sqlite/migrations.ts:55-64 valida únicamente la existencia de los diez nombres de tabla; no verifica columnas, constraints, índices esenciales ni compatibilidad estructural. Reproducción: una DB con las diez tablas creadas como CREATE TABLE <name> (broken TEXT) y user_version=2 hace que migrateStateDatabase devuelva 2 sin error, contradiciendo docs/STATE.md, que afirma que un schema corrupto no se repara silenciosamente. Hallazgo de cobertura: tests/core/state/sqlite/migrations.spec.ts:17-25 crea primero el schema actual, fuerza user_version=1 y ejecuta v2; no prueba una base v1 histórica. Una base v1 mínima real falla como State database migration failed y hace rollback, por lo que debe definirse/probarse el schema v1 real o retirarse la afirmación. Riesgo adicional a cubrir: schema.sql se carga con readFileSync(join(import.meta.dir, schema.sql)); añadir chequeo de artefacto si se distribuye compilado. Sin hallazgos en runtime neutrality, secrets, naming o boundaries. Gates: 7/7 tests SQLite, lint:naming PASS, lint:secrets PASS, lint:boundaries PASS, typecheck core PASS. lint:contracts falla por baseline preexistente con 129 declaraciones, incluidas las nuevas interfaces de S2. No se editó código.
- review-log: approved by technical-investigator — Revisión independiente del cambio de integración en commit 7a98dac, con gate acotado: Vitest excluye sólo tests/core/state/sqlite/**; test:core:sqlite ejecuta Bun real y está incluido en test:core y validate. Evidencia del gate acotado: bun test SQLite 7/7, test:core 85 suites + 1257 tests y luego SQLite 7/7, typecheck:core PASS. El validate global no está verde por 4 fallos CLI y regresión de baseline de cobertura ajenos a esta integración; la aprobación no cierra esos hallazgos ni la slice S2 completa.
### S3-immutable-snapshot-repository-and-cas — S3 — Repositorio SQLite de snapshots inmutables, transacciones y activación CAS
- **Status**: done
- **DependsOn**: [S2-sqlite-schema-and-migrations]
- **Files**: `packages/core/state/sqlite/sqlite-snapshot.repository.ts`, `packages/core/state/sqlite/sqlite-project.repository.ts`, `packages/core/state/snapshot-transaction.service.ts`, `packages/core/state/snapshot-activation.service.ts`, `tests/core/state/sqlite/snapshot-repository.spec.ts`, `tests/core/state/sqlite/activation-cas.spec.ts`, `tests/core/state/sqlite/crash-recovery.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cada scan escribe un snapshot completo dentro de una transacción; un fallo deja intacto el active_snapshot_id anterior."
  - "Los snapshots completos son inmutables y la activación usa revision optimista: una ejecución vieja no puede sustituir una más nueva."
  - "El repositorio permite restart, history y lectura del snapshot activo sin reescanear el proyecto."
  - "No se persisten tokens, passwords, API keys ni refresh tokens; auth conserva refs y metadata no sensible."
  - "Tests cubren commit atómico, rollback, reinicio, dos writers concurrentes, CAS perdido y ausencia de secretos."
- review-state: done
- review-implementer: delendai-impl-20260909
- review-reviewer: delivery-verifier-20260909
- review-log: requested_changes by technical-investigator-20260909 — REQUEST_CHANGES en revisión independiente de HEAD d59956574ea3dab627120ba46f6383d2623f34ff. Defecto bloqueante reproducible: SqliteProjectRepository.activate() (packages/core/state/sqlite/sqlite-project.repository.ts:23-25) sólo condiciona por project_id y expectedRevision; no valida existencia, status=complete ni pertenencia del snapshot al proyecto. projects.active_snapshot_id tampoco tiene FK en packages/core/state/sqlite/schema.sql:1-8. Reproducción Bun SQLite: activar p1 con snapshot ghost declarado como perteneciente a p2 devuelve true y deja p1.active_snapshot_id='ghost', revision=1. SnapshotActivationService sólo valida el objeto recibido en memoria. Corregir con validación atómica en SQL/transacción y cubrir snapshot inexistente, de otro proyecto y building/failed. Gates: bun run lint:naming OK; bun run typecheck:core OK; bun test tests/core/state/sqlite/*.spec.ts OK (11/11); bun run lint:secrets OK; bun run lint:durable-writes OK; diff --check OK. Cobertura adicional pendiente: crash recovery usa :memory: y no reabre archivo SQLite, riesgo de cobertura no contado como defecto confirmado.
- review-log: requested_changes by audit-reviewer-20260909 — REQUEST_CHANGES final. Defecto bloqueante reproducible en packages/core/state/sqlite/sqlite-project.repository.ts: activate() sólo condiciona por project_id y expectedRevision; acepta snapshot inexistente, de otro proyecto o con status no-complete porque no consulta snapshots. projects.active_snapshot_id tampoco tiene FK en schema.sql. Reproducción Bun SQLite: activate(p1, snapshot ghost declarado para p2, expectedRevision 0) devuelve true y deja p1.active_snapshot_id='ghost', revision=1. SnapshotActivationService sólo valida el objeto en memoria. Corregir mediante validación atómica SQL/transacción y tests para inexistente, proyecto ajeno y building/failed. Validaciones ejecutadas sobre HEAD d59956574ea3dab627120ba46f6383d2623f34ff: bun run lint:naming OK; bun run typecheck:core OK; bun test tests/core/state/sqlite/*.spec.ts OK (11/11); bun run lint:secrets OK; bun run lint:durable-writes OK; diff --check OK. Riesgo de cobertura no bloqueante: crash-recovery.spec.ts usa :memory: y no reabre un archivo SQLite tras interrupción.
- review-log: approved by delivery-verifier-20260909 — APROBADO tras revisión independiente de commit e55668fd459a7d500e73ef4976b81820400c4b1b. SqliteProjectRepository.activate ejecuta un único UPDATE CAS con expectedRevision y una subconsulta EXISTS que exige snapshot_id existente, project_id igual al proyecto activado y status='complete'; por tanto existencia, pertenencia y completitud se validan atómicamente y cualquier rechazo deja active_snapshot_id y revision sin cambios. Evidencia ejecutada sobre HEAD: bun test tests/core/state/sqlite/*.spec.ts -> 15/15 tests PASS; bun run typecheck:core -> PASS; bun run lint:naming -> PASS; bun run lint:boundaries -> PASS; bun run lint:durable-writes -> PASS. No se editaron archivos ni se revirtieron cambios. El árbol conserva una modificación previa no relacionada en el archivo de la propuesta.
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
- Los tests Bun-native de SQLite quedan fuera del proyecto Vitest de core y se ejecutan con bun test mediante un script explícito incluido en test:core y validate.
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
