---
id: c00010
title: "Higiene crítica — CI verde, branch protection real, cobertura ≥80%, fixtures reparadas, monkey-patches eliminados"
kind: chore
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-09-07
last-transition-id: c8bba09f-4be0-4d4d-b4f8-979dbfb1a4cd
last-correlation-id: c8bba09f-4be0-4d4d-b4f8-979dbfb1a4cd
last-transition-from: ready
---

# c00010 — Higiene crítica — CI verde, branch protection real, cobertura ≥80%, fixtures reparadas, monkey-patches eliminados

## Goal

Resolver los seis bloqueos operativos que dejan a Tanit con CI rojo, develop sin protección, números mágicos de detectores desincronizados, console.log y process.env monkey-patches en el pipeline de generación, fixtures Express/multi-service sin fuente y cobertura de tests por debajo del umbral profesional. Cierra los hallazgos §3.1, §3.2, §4 y §5 de la auditoría [a00019](./a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md). El objetivo terminal: `bun run validate` verde end-to-end en CI, develop protegido con los 8 required checks, `bun run test:coverage` ≥ 80% global (≥90% core, ≥75% frameworks, ≥70% cli), 0 ocurrencias de `console.log =` o `process.env.POSTMAN_*` en `packages/cli/commands/generate.script.ts` o servicios adyacentes, números de detectores derivados del registry, fixtures reparadas o jubiladas con razón explícita.

## why

El agente externo confirmó que el head actual (ae6e284) tiene: CI rojo en `lint:naming` (dos ficheros pendientes de sufijo semántico), `test-coverage` y `validate-examples`; GitHub reporta `protected: false`, `required_status_checks: []` y ningún ruleset activo a pesar de que `x00068`/`x00071` figuran como done; `packages/core/discovery/host-config-parser.ts` y `packages/core/exporters/postman-inferred-response.ts` no cumplen el sufijo `*.service.ts` / `*.exporter.ts` que el gate exige; `packages/cli/commands/generate.script.ts` todavía hace monkey-patching de `console.log` y `process.env.POSTMAN_OUTPUT_BASENAME` en lugar de inyectar dependencias; el número "21 detectores" está hardcodeado en `package.json`, `packages/desktop/src-tauri/` bundle, `README.md` (que dice 25) y el registry; las fixtures `tests/fixtures/express-multi-router/` y `tests/fixtures/multi-service/` están sin fuente real y el `lint:fixtures` las marca; regresiones de check con varias reglas fallando sin diagnóstico claro. Sin esta higiene, ningún trabajo posterior (modelo universal, session, Angular) puede tener un DoD confiable, y los errores que aparezcan se mezclarán con ruido del CI roto.

## non-goals

- Reescribir el pipeline de generación — solo se elimina el monkey-patching; la arquitectura `generate → pipeline → exporters` se conserva.
- Añadir nuevos scanners o frameworks — el conteo de detectores debe reflejar exactamente los 25 actuales, no inflarse.
- Cambiar el modelo de Postman (eso vive en `r00019`) — aquí solo se asegura que el sufijo del fichero cumple el naming gate.
- Migrar a Tauri 2.0 o añadir plugins nuevos — eso vive en `f00017` (Desktop app).
- Refactor del core para hacerlo agnóstico de frameworks — eso es `r00019` y siguientes.

## Slices

- global_gate: e2e

### S1-lint-renames-and-monkey-patches — Renombres lint:naming + eliminación de monkey-patches + inyección de dependencias en generate
- **Status**: done
- **Files**: `packages/core/discovery/host-config-parser.service.ts`, `packages/core/exporters/postman-inferred-response.exporter.ts`, `packages/cli/commands/generate.script.ts`, `packages/core/discovery/output-paths.helper.ts`, `packages/core/services/output-sink.service.ts`, `packages/contracts/interfaces/core/output-sink.interface.ts`, `tests/core/output-paths.helper.spec.ts`, `tests/core/output-sink.service.spec.ts`, `scripts/gates/lint-no-monkey-patch.script.ts`, `tests/scripts-gates/lint-no-monkey-patch.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "`bun run lint:naming` verde tras renombrar `host-config-parser.ts` → `host-config-parser.service.ts` y `postman-inferred-response.ts` → `postman-inferred-response.exporter.ts` (cabecera de doc actualizada, ningún import externo queda roto)"
  - "0 ocurrencias de `console.log =` o `process.env.POSTMAN_*` en `generate.script.ts` y servicios adyacentes; el lint `lint:no-monkey-patch` verde con regla explícita"
  - "`IOutputSink` vive en `packages/contracts/interfaces/core/output-sink.interface.ts` y define los canales `write`, `writeError` y `writeJson`; no se introduce un segundo contrato `IGenerationOptions` ni un logger paralelo para resolver este problema"
  - "`ConsoleOutputSink` y `JsonModeConsoleSink` implementan `IOutputSink`; `selectOutputSink` permite inyectar el comportamiento de salida sin mutar `console.log` ni `process.env`"
  - "`generate.script.ts` y `output-paths.helper.ts` consumen el sink y `basenameOverride`; los flags se propagan por argumentos, sin monkey-patch global"
  - "Tests: `tests/core/output-sink.service.spec.ts` cubre los canales stdout/stderr y la selección por modo JSON; `tests/core/output-paths.helper.spec.ts` cubre la resolución del basename; `tests/scripts-gates/lint-no-monkey-patch.spec.ts` verifica el gate"
  - "DoD slice: `bun run typecheck && bun run lint && bun run test:cli` verdes; commit con prefijo `chore(lint):` o `chore(refactor):`"

#### Trazabilidad y revisión independiente — 2026-09-07

- Los renombres `host-config-parser.ts` → `host-config-parser.service.ts` y `postman-inferred-response.ts` → `postman-inferred-response.exporter.ts` ya estaban presentes en el `HEAD` revisado; se conservan como parte de la aceptación verificable, pero no se cuentan como modificaciones nuevas de esta ejecución.
- Los cambios de esta ejecución quedan limitados a `generate.script.ts`, `output-paths.helper.ts`, `output-sink.service.ts`, `output-sink.interface.ts`, sus tests, el gate `lint-no-monkey-patch` y su alta en `package.json`.
- La revisión independiente confirmó: `bun run lint:no-monkey-patch` verde; `bunx vitest run tests/core/output-sink.service.spec.ts tests/core/output-paths.helper.spec.ts` verde (30 tests); `typecheck:core`, `typecheck:cli` y `typecheck:contracts` verdes. También confirmó que `lint:contracts` falla por 15 declaraciones previas en otros archivos, ninguna perteneciente a este slice.
- La prueba `tests/scripts-gates/lint-no-monkey-patch.spec.ts` queda registrada como cobertura documental del gate; su ejecución dentro de la suite de Vitest requiere un proyecto `scripts-gates` específico y no se usa como justificación para ampliar S1.
- `lint:contracts` permanece como deuda previa: `host-config-parser.service.ts` (3 tipos), `import-resolver.ts` (1), `symbol-graph.ts` (2), `symbol-id.ts` (1), `postman-inferred-response.exporter.ts` (1), `extract-routes-fastify.helper.ts` (3), `language-frontends/typescript/index.ts` (1) e `infer-responses.ts` (3). Absorberla queda fuera del alcance de S1.

### S2-branch-protection-and-required-checks — Branch protection real + required checks + ci-summary exit-on-deps + rulesets
- **Status**: done
- **DependsOn**: [S1-lint-renames-and-monkey-patches]
- **Files**: `.github/workflows/validate.yml`, `.github/workflows/integration-delendai.yml`, `.github/workflows/ci-summary.yml`, `scripts/gates/branch-protection.script.ts`, `scripts/gates/ci-summary.script.ts`, `docs/CI.md`, `delendai.config.json`, `tests/scripts-gates/branch-protection.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`scripts/gates/branch-protection.script.ts` chequea GitHub API para `develop` (y ramas `release/*` si existen): `protected=true`, `required_status_checks.contexts` contiene los checks declarados por `.github/workflows/validate.yml` (`typecheck`, `lint`, `test-coverage`, `validate-examples`, `bench-check`, `security-audit`, `validate-package`, `integration-verifier` cuando aplique); falla el CI si diverge"
  - "`ci-summary` job devuelve `exit 1` cuando cualquier dependency job está rojo — implementación via `needs` con `if: failure()` o via composite action que evalúa `matrix` results; ya no es posible que el summary pase mientras un job dependiente falla"
  - "Workflow incluye paso explícito que crea/aplica ruleset via `gh api` cuando falta; documentado en `docs/CI.md` con instrucciones de promoción y excepción de bypass para emergencias (rotación de secretos, fix de infra)"
  - "`x00068` y `x00071` se reabren como `in_progress` y se cierran con el SHA del fix (el de S2 + el de `d34f3a2`)"
  - "Tests: `tests/scripts-gates/branch-protection.spec.ts` mockea GitHub API y cubre 4 casos (develop protegida, develop sin required checks, develop sin protection, rama inexistente → fail)"
  - "DoD slice: `bun run validate` verde en local; CI workflow dry-run con `act` o equivalente verde"
- review-state: done
- review-implementer: sparrow
- review-reviewer: owl
- review-log: approved by owl
### S3-coverage-and-fixtures-green — Coverage ≥80% global + fixtures reparadas + regressions de check corregidas
- **Status**: in_progress
- **DependsOn**: [S2-branch-protection-and-required-checks]
- **Files**: `tests/fixtures/express-multi-router/package.json`, `tests/fixtures/express-multi-router/src/users.ts`, `tests/fixtures/express-multi-router/src/orders.ts`, `tests/fixtures/express-multi-router/src/server.ts`, `tests/fixtures/multi-service/package.json`, `tests/fixtures/multi-service/users-api/package.json`, `tests/fixtures/multi-service/users-api/src/main.ts`, `tests/fixtures/multi-service/billing-api/pyproject.toml`, `tests/fixtures/multi-service/billing-api/main.py`, `tests/e2e/express-multi-router.test.ts`, `tests/e2e/multi-service.test.ts`, `vitest.config.ts`, `scripts/gates/coverage.script.ts`, `tests/coverage-baseline.json`
- **Gate**: e2e
- acceptance:
  - "`tests/fixtures/express-multi-router/` con código real: dos routers con prefijos distintos (`/users`, `/orders`) importando handlers cross-file (ejercita SymbolGraph); `tests/fixtures/multi-service/` con dos APIs distintas (NestJS + FastAPI) que ejercitan `combineServices` sin heredar baseUrl del primero"
  - "`tests/e2e/express-multi-router.test.ts` y `tests/e2e/multi-service.test.ts` ejecutan el binario contra cada fixture y verifican que las rutas se asocian al prefijo correcto y que la combinación multi-servicio no colapsa auth/baseUrl"
  - "`vitest.config.ts` declara thresholds: global ≥ 80%, core ≥ 90%, frameworks ≥ 75%, cli ≥ 70%; el gate `coverage.script.ts` los evalúa contra `tests/coverage-baseline.json` (baseline frozen con los valores actuales para que subir el umbral requiera decisión humana)"
  - "Regresiones de `check` corregidas sin relajar el umbral: las que detecten `routesByService` vacío o auth inconsistente en monorepos quedan documentadas con test que falla antes del fix y pasa después"
  - "`validate-examples` verde — todas las fixtures referenciadas desde `examples/` tienen al menos un snapshot versionado; las que se jubilen se mueven a `tests/fixtures/_retired/` con `retired-reason`"
  - "DoD slice: `bun run test:coverage` + `bun run validate:examples` + `bun run test:e2e` verdes; `bun run validate` full verde"

#### Trazabilidad S3 — 2026-09-07 (slice parcial)

- `tests/fixtures/express-multi-router/` ya estaba poblado y `tests/frameworks/express-multi-router.spec.ts` + `tests/e2e/express-multi-router.test.ts` ya verifican el caso cross-file (`r00014` S4 / `x00055` S3). Se conservan como evidencia verificable pero no se cuentan como modificaciones nuevas de esta ejecución.
- En esta ejecución (`owl` / `c00010-s3-multi-service-fixture`) se añadió la pieza multi-framework que faltaba: `tests/fixtures/multi-service/` (NestJS `users-api` + FastAPI `billing-api` bajo `apps/<servicio>/`) y `tests/e2e/multi-service.test.ts` con cuatro casos — detección de ambos workspaces, aislamiento de prefijos (users NO ve rutas de invoices ni vicerversa), ausencia de duplicados `METHOD+uri` con `combineServices: true`, e invariantes de forma Postman v2.1.0. `bunx vitest run tests/e2e/multi-service.test.ts` verde (4/4); `bun run lint:fixtures` verde con la nueva fixture.
- El test deja explícito que el fix de per-endpoint baseUrl/auth (audit §18 prioridad 6, `r00019` phase-2) sigue siendo un gap conocido: `match.framework` y `match.frameworkSearchRoot` aún comparten valor entre los dos `IGenerationResult`. Esta ejecución NO aborda ese gap; solo garantiza que la ruta multi-servicio produce colecciones disjuntas por prefijo, que es la pre-condición que `r00019` necesita.
- Quedan fuera del alcance de esta ejecución y pendientes para siguientes slices: `vitest.config.ts` con thresholds per-proyecto (global ≥ 80%, core ≥ 90%, frameworks ≥ 75%, cli ≥ 70%), `scripts/gates/coverage.script.ts`, `tests/coverage-baseline.json` y los snapshots versionados para las fixtures que aún no los tienen. `lint:proposals` también sigue rojo por 16 propuestas archivadas en `done/<kind>/` con `kind` incorrecto (deuda previa a S3, fuera del scope).
- `bun run typecheck` verde en las 5 secciones; 532 tests e2e verdes.
- review-state: superseded — la aceptación S3 NO se cumple en 2026-09-07 (sigue parcial). Ver Trazabilidad 2026-09-08 abajo.
- review-implementer: owl

#### Trazabilidad S3 — 2026-09-08 (verificación independiente — slice sigue parcial)

- Verificación en `HEAD` `fda5835` (lock `a00019-phase-1-hygiene-ci` reclamado por `copilot-editor-sandbox-impl-20260908`):
  - `bun run scripts/gates/lint-naming.script.ts` → verde (503 ficheros, 31 carpetas con regla).
  - `bun run scripts/gates/lint-no-monkey-patch.script.ts` → clean (S1 sigue cumpliéndose).
  - `bunx vitest run tests/scripts-gates/branch-protection.spec.ts` → verde (4/4 casos; S2 verificable end-to-end con `validateBranchProtection()` mockeada).
  - `bunx vitest run tests/scripts-gates/lint-no-monkey-patch.spec.ts` → verde (1/1; gate S1 con cobertura).
  - `bunx vitest run tests/e2e/multi-service.test.ts` → verde (4/4; aislamiento de prefijos + duplicados METHOD+uri + invariantes Postman v2.1.0).
  - `bunx vitest run tests/e2e/express-multi-router.test.ts` → verde (1/1; cross-file SymbolGraph).
  - `bun run scripts/gates/validate.script.ts` → 25/25 ejemplos generan colección válida (con 2 advisories no-bloqueantes en `example-asyncapi` y `example-sse` por duplicación de ruta prefijada; pre-existente).
- S3 acceptance **NO cerrada** — piezas pendientes verificadas por ausencia en disco:
  - `scripts/gates/coverage.script.ts` → no existe (`bun run scripts/gates/coverage.script.ts` falla con `error: Module not found`).
  - `tests/coverage-baseline.json` → no existe.
  - `vitest.config.ts` declara **un único threshold global** (`statements:73, branches:70, functions:82, lines:75`), NO per-proyecto (`global ≥ 80%, core ≥ 90%, frameworks ≥ 75%, cli ≥ 70%`) como exige S3.
  - `lint:proposals` rojo por 16 propuestas en `done/<kind>/` con `kind` incorrecto (deuda previa; no introducida por S3).
- `review-state` se revierte a `in_progress` (NO `in_review`) porque la aceptación S3 no se cumple: el gate `coverage.script.ts`, el `coverage-baseline.json` y los thresholds per-proyecto siguen sin existir en HEAD. La revisión previa marcada como `in_review` queda en el log pero NO equivale a aprobación.
- c00010 NO se archiva a `done/chores/` porque: (1) el gate de coverage no existe, (2) el baseline no existe, (3) los thresholds per-proyecto no están declarados, (4) `lint:proposals` no cierra por la deuda previa de done/<kind>. El archivo permanece en `in-progress/`.
- `a00019` slice `phase-1-hygiene-ci` queda con `Status: pending` en el cuerpo del doc padre — no se mueve a `in_progress` desde `pending` porque su acceptance exige c00010 cerrado, lo cual no es cierto todavía.
- review-state: in_progress
- review-implementer: copilot-editor-sandbox-impl-20260908
- review-blocker: scripts/gates/coverage.script.ts ausente; tests/coverage-baseline.json ausente; vitest.config.ts sin thresholds per-proyecto
## acceptance

- `bun run lint:naming` verde tras renombrar `host-config-parser.ts` → `host-config-parser.service.ts` y `postman-inferred-response.ts` → `postman-inferred-response.exporter.ts` (cabecera de doc actualizada, ningún import externo queda roto)
- 0 ocurrencias de `console.log =` o `process.env.POSTMAN_*` en `generate.script.ts` y servicios adyacentes; el lint `lint:no-monkey-patch` verde con regla explícita
- `IOutputSink` es el único contrato nuevo de S1 y expone `write`, `writeError` y `writeJson`; no se introduce un logger paralelo ni se amplía `IGenerationOptions` en este slice. La extracción de un `ILogger`, canales tabulares o una API de opciones de generación más amplia queda fuera de S1 y requiere una propuesta posterior con archivos disjuntos
- `ConsoleOutputSink` y `JsonModeConsoleSink` implementan `IOutputSink` sin mutar `console.log` ni `process.env`; la escritura a stdout/stderr queda confinada al adaptador de borde del CLI
- `scripts/gates/branch-protection.script.ts` chequea GitHub API para `develop` (y ramas `release/*` si existen): `protected=true`, `required_status_checks.contexts` contiene los checks declarados por `.github/workflows/validate.yml` (`typecheck`, `lint`, `test-coverage`, `validate-examples`, `bench-check`, `security-audit`, `validate-package`, `integration-verifier` cuando aplique); falla el CI si diverge
- Tests: `tests/scripts-gates/branch-protection.spec.ts` mockea GitHub API y cubre 4 casos (develop protegida, develop sin required checks, develop sin protection, rama inexistente → fail)
- DoD slice: `bun run validate` verde en local; CI workflow dry-run con `act` o equivalente verde
- `tests/fixtures/express-multi-router/` con código real: dos routers con prefijos distintos (`/users`, `/orders`) importando handlers cross-file (ejercita SymbolGraph); `tests/fixtures/multi-service/` con dos APIs distintas (NestJS + FastAPI) que ejercitan `combineServices` sin heredar baseUrl del primero
- `tests/e2e/express-multi-router.test.ts` y `tests/e2e/multi-service.test.ts` ejecutan el binario contra cada fixture y verifican que las rutas se asocian al prefijo correcto y que la combinación multi-servicio no colapsa auth/baseUrl
- `vitest.config.ts` declara thresholds: global ≥ 80%, core ≥ 90%, frameworks ≥ 75%, cli ≥ 70%; el gate `coverage.script.ts` los evalúa contra `tests/coverage-baseline.json` (baseline frozen con los valores actuales para que subir el umbral requiera decisión humana)
- Regresiones de `check` corregidas sin relajar el umbral: las que detecten `routesByService` vacío o auth inconsistente en monorepos quedan documentadas con test que falla antes del fix y pasa después
- `validate-examples` verde — todas las fixtures referenciadas desde `examples/` tienen al menos un snapshot versionado; las que se jubilen se mueven a `tests/fixtures/_retired/` con `retired-reason`
- DoD slice: `bun run test:coverage` + `bun run validate:examples` + `bun run test:e2e` verdes; `bun run validate` full verde
