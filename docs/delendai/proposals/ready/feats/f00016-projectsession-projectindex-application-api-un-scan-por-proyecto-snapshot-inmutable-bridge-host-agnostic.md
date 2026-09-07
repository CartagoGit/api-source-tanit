---
id: f00016
title: "ProjectSession + ProjectIndex + Application API — un scan por proyecto, snapshot inmutable, bridge host-agnostic"
kind: feat
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
---

# f00016 — ProjectSession + ProjectIndex + Application API — un scan por proyecto, snapshot inmutable, bridge host-agnostic

## Goal

Introducir tres piezas que cambian la forma en que el core de Tanit expone su trabajo: (1) **ProjectSession** — un solo scan por apertura de proyecto, snapshot inmutable `IProjectSnapshot` consumido por inspect/generate/check/list/history; soporta cancelación via AbortSignal y watch incremental; (2) **ProjectIndex** — cache de files/AST/manifests/hashes/imports que los 25 detectores consumen en lugar de tocar el filesystem independientemente; base para `ast-cache` (0 re-parses si no hay cambios) y watch granular; (3) **Application API** — handlers host-agnostic (`open/snapshot/listEndpoints/getSchema/getService/listServices/dryRun/export/historyDiff/watch/cancel/settings/listProjects/close`) expuestos via bridge stdio (Desktop, sin HTTP ni Origin) y HTTP preservado para `apisrc ui`. El cierre del bloque (c) de [a00019](./a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo identificó tres problemas: (a) `/api/inspect` y `/api/generate` ejecutan el scan independientemente — abrir un proyecto y pulsar Inspect + Generate ejecuta 2 scans completos en lugar de 1; (b) los 25 detectores del registry tocan el filesystem y parsean archivos sin coordinación — no hay cache de AST TS, ni de manifests (package.json/tsconfig/etc.), ni de imports resueltos, así que un monorepo de 1k archivos se escanea igual de lento cada vez; (c) `apisrc ui` y Tanit Desktop dependen de un servidor HTTP con handshake de token + Origin — válido para el navegador pero innecesario para el sidecar Tauri donde stdio RPC elimina puerto, URL handshake y CSRF surface. Mientras no exista ProjectSession, la GUI no puede sentirse instantánea (cada cambio de tab reescanea); sin ProjectIndex, watch incremental es inviable; sin Application API host-agnostic, Desktop no puede abandonar HTTP.

## non-goals

- Reescribir los scanners — siguen devolviendo `ParsedRoute[]`; el cambio es en el consumer (la pipeline que llama `discoverProject()`), no en el producer.
- Migrar la UI existente a Angular — eso es `f00017`; aquí solo se prepara el backend que la UI consumirá.
- Añadir transports nuevos — el snapshot se construye sobre el discriminated union de `r00019` pero su forma final es estable.
- Eliminar el servidor HTTP — se preserva para `apisrc ui`; bridge stdio es adicional para Desktop.
- Persistencia del snapshot entre runs — el snapshot es in-memory por sesión; persistencia (history-diff) es trabajo de `f00017` S5.

## Slices

- global_gate: e2e

### S1-ProjectSession-single-scan — S1 — ProjectSession: open() una vez, snapshot inmutable, AbortSignal, watch incremental stub
- **Status**: pending
- **Files**: `packages/core/session/project-session.service.ts`, `packages/core/session/project-snapshot.ts`, `packages/core/session/session-events.ts`, `packages/core/session/session-id.ts`, `packages/core/session/session-error.ts`, `packages/cli/commands/inspect.script.ts`, `packages/cli/commands/generate.script.ts`, `packages/cli/commands/list-endpoints.script.ts`, `packages/cli/commands/check.script.ts`, `tests/core/session/project-session.spec.ts`, `tests/cli/session-flow.test.ts`
- **Gate**: e2e
- acceptance:
  - "`ProjectSession.open(projectRoot, opts): Promise<IProjectSession>` ejecuta scan exactamente una vez; segundo `open()` del mismo root devuelve la misma sesión (idempotente)"
  - "`IProjectSnapshot` es inmutable (`readonly` en todos los campos, `Object.freeze` en construcción) e incluye `index: IProjectIndex`, `operations: readonly IOperation[]`, `services: readonly IServiceDescriptor[]`, `diagnostics: readonly IDiagnostic[]`, `capturedAt: Date`"
  - "`session.current(): IProjectSnapshot` accessor; `session.close()` libera recursos; `session.cancel(AbortSignal)` propaga a scans en curso"
  - "`session.on('snapshot-stale', cb)` + `session.on('snapshot-ready', cb)` eventos para watch — implementación S1 los emite con un watcher de filesystem básico (`chokidar` o `node:fs.watch`) sobre los source files del index"
  - "CLI: `inspect` + `generate` + `list-endpoints` + `check` aceptan `--reuse-session=<id>` para compartir el scan entre commands; test e2e: 4 commands secuenciales con `--reuse-session` ejecutan el scan exactamente 1 vez (assertion via spy)"
  - "Tests: `tests/core/session/project-session.spec.ts` cubre open/close/idempotencia/cancelación/eventos; `tests/cli/session-flow.test.ts` cubre el flujo CLI completo"
  - "DoD slice: `bun run typecheck && bun run test:core && bun run test:cli && bun run validate:examples` verdes"

### S2-ProjectIndex-cache — S2 — ProjectIndex: cache files/AST/manifests/hashes/imports, base del watch granular
- **Status**: pending
- **DependsOn**: [S1-ProjectSession-single-scan]
- **Files**: `packages/core/index/project-index.service.ts`, `packages/core/index/file-cache.service.ts`, `packages/core/index/ast-cache.service.ts`, `packages/core/index/manifest-reader.service.ts`, `packages/core/index/workspace-resolver.service.ts`, `packages/core/index/incremental-invalidator.service.ts`, `packages/frameworks/framework.registry.ts`, `tests/core/project-index.spec.ts`, `tests/core/ast-cache-perf.bench.ts`
- **Gate**: e2e
- acceptance:
  - "`ProjectIndex.open(root)` indexa files (con hash SHA-256), language detectada, manifests parseados (package.json/tsconfig.json/go.mod/Cargo.toml/composer.json/pyproject.toml/Gemfile/mix.exs), AST TS Program cacheado (Babel/TS), imports resueltos (consume SymbolGraph de `r00014`), workspaces (npm/yarn/pnpm/bun monorepo)"
  - "`index.file(relPath): IIndexedFile | undefined`; `index.astFor(relPath): ts.Program | undefined` (cached, reuse si hash no cambió); `index.manifestFor(relPath): IManifest | undefined`"
  - "Los 25 detectores se refactorean para consumir el Index — sin re-stat del filesystem ni re-parse de manifests duplicados (verificación via spy fs.readFile)"
  - "`ast-cache`: segundo scan del mismo proyecto = 0 re-parses si no hay cambios (test: timing budget + spy fs.readFile calls = 0 en la segunda invocación)"
  - "`incremental-invalidator`: cambiar 1 archivo invalida solo ese archivo + sus importadores directos (grafo de dependencias inverso pre-calculado); el resto del proyecto no se reprocesa"
  - "Performance budget: proyecto NestJS de 1k archivos < 4s primer scan, < 200ms re-scan tras cambio aislado; bench reproducible en `tests/core/ast-cache-perf.bench.ts` con umbral duro (falla si excede)"
  - "DoD slice: `bun run typecheck && bun run test:core && bun run bench:check` verdes; el test e2e del S1 sigue verde con watch funcionando"

### S3-Application-API-handlers — S3 — Application API: 14 handlers host-agnostic, contratos JSON Schema generados desde Zod
- **Status**: pending
- **DependsOn**: [S2-ProjectIndex-cache]
- **Files**: `packages/core/application-api/handlers.ts`, `packages/core/application-api/open-project.handler.ts`, `packages/core/application-api/snapshot.handlers.ts`, `packages/core/application-api/list-endpoints.handler.ts`, `packages/core/application-api/get-endpoint.handler.ts`, `packages/core/application-api/get-schema.handler.ts`, `packages/core/application-api/list-services.handler.ts`, `packages/core/application-api/dry-run.handler.ts`, `packages/core/application-api/export.handler.ts`, `packages/core/application-api/history.handlers.ts`, `packages/core/application-api/watch.handlers.ts`, `packages/core/application-api/cancel.handler.ts`, `packages/core/application-api/settings.handlers.ts`, `packages/core/application-api/list-projects.handler.ts`, `packages/core/application-api/close.handler.ts`, `packages/core/application-api/zod-schemas.ts`, `packages/core/application-api/dispatcher.ts`, `packages/core/application-api/error.ts`, `tests/application-api/handlers.spec.ts`
- **Gate**: e2e
- acceptance:
  - "14 handlers declarados en `packages/core/application-api/`: cada uno es `(input: TInput, ctx: IRequestContext) => Promise<TOutput>` puro async, sin globals, con Zod schema para input + output; `dispatcher.ts` enruta por nombre y valida entrada/salida"
  - "Contratos JSON Schema auto-generados desde Zod via `zod-to-json-schema`; el comando `bin/apisrc api-schema --handler <name>` los imprime a stdout"
  - "`IRequestContext` lleva `sessionId`, `signal: AbortSignal`, `caller: 'desktop' | 'browser' | 'cli'`; cada handler propaga cancelación"
  - "`error.ts` define `IApiError { code: ApiErrorCode; message: string; details?: Record<string, unknown> }` con códigos estables (`SESSION_NOT_FOUND`, `OPERATION_NOT_FOUND`, `EXPORT_FAILED`, `INVALID_INPUT`, etc.)"
  - "Tests `tests/application-api/handlers.spec.ts` cubren los 14 handlers con al menos 1 caso de éxito + 1 caso de error; dispatcher valida inputs inválidos"
  - "DoD slice: `bun run typecheck && bun run test:core` verdes; ningún CLI command existente queda roto (los handlers se usan internamente desde los CLI commands que ya están migrados)"

### S4-bridges-stdio-http — S4 — Bridges: stdio RPC (Desktop) + HTTP preservado (browser); Desktop main.rs < 150 LOC
- **Status**: pending
- **DependsOn**: [S3-Application-API-handlers]
- **Files**: `packages/core/transport/stdio-bridge.server.ts`, `packages/core/transport/http-bridge.server.ts`, `packages/core/transport/bridge-error.ts`, `packages/core/transport/json-rpc-protocol.ts`, `packages/cli/commands/serve.script.ts`, `packages/desktop/src-tauri/src/main.rs`, `packages/desktop/src-tauri/src/bridge.rs`, `packages/desktop/src-tauri/src/sidecar.rs`, `packages/desktop/src-tauri/Cargo.toml`, `tests/transport/stdio-bridge.spec.ts`, `tests/transport/http-bridge.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`stdio-bridge.server.ts`: protocolo newline-delimited JSON-RPC 2.0 sobre stdin/stdout — Desktop sidecar = `bun run bin/apisrc serve --stdio`; cada request = una línea JSON parseada, cada response = una línea JSON serializada; cancel via método `$/cancelRequest` con el `requestId`"
  - "`http-bridge.server.ts`: preserva la seguridad actual (loopback only, token por ejecución, Origin validation) — ambos bridges importan los mismos handlers de `packages/core/application-api/handlers.ts`; zero duplicación de lógica"
  - "`bin/apisrc serve` acepta `--stdio` o `--http` (default); `--stdio` no requiere token (la IPC ya es local); `--http` mantiene la seguridad existente"
  - "`packages/desktop/src-tauri/src/main.rs` < 150 LOC: solo bridge + window creation + sidecar spawn (no lógica de producto)"
  - "`bridge.rs` solo conoce el contrato IPC: spawn child process, conectar stdin/stdout, propagar mensajes al webview vía `tauri::Emitter`; sidecar errors se loggean a archivo rotativo (no se descartan)"
  - "Tests: `tests/transport/stdio-bridge.spec.ts` cubre happy path + cancelación + handler que lanza + payloads grandes (>1MB); `tests/transport/http-bridge.spec.ts` preserva los tests de seguridad existentes"
  - "DoD slice: `bun run typecheck && bun run test:core && bun run test:desktop && bun run validate:examples` verdes; `cargo check` en el desktop verde"

## acceptance

- `ProjectSession.open(projectRoot, opts): Promise<IProjectSession>` ejecuta scan exactamente una vez; segundo `open()` del mismo root devuelve la misma sesión (idempotente)
- `IProjectSnapshot` es inmutable (`readonly` en todos los campos, `Object.freeze` en construcción) e incluye `index: IProjectIndex`, `operations: readonly IOperation[]`, `services: readonly IServiceDescriptor[]`, `diagnostics: readonly IDiagnostic[]`, `capturedAt: Date`
- `session.current(): IProjectSnapshot` accessor; `session.close()` libera recursos; `session.cancel(AbortSignal)` propaga a scans en curso
- `session.on('snapshot-stale', cb)` + `session.on('snapshot-ready', cb)` eventos para watch — implementación S1 los emite con un watcher de filesystem básico (`chokidar` o `node:fs.watch`) sobre los source files del index
- CLI: `inspect` + `generate` + `list-endpoints` + `check` aceptan `--reuse-session=<id>` para compartir el scan entre commands; test e2e: 4 commands secuenciales con `--reuse-session` ejecutan el scan exactamente 1 vez (assertion via spy)
- Tests: `tests/core/session/project-session.spec.ts` cubre open/close/idempotencia/cancelación/eventos; `tests/cli/session-flow.test.ts` cubre el flujo CLI completo
- DoD slice: `bun run typecheck && bun run test:core && bun run test:cli && bun run validate:examples` verdes
- `ProjectIndex.open(root)` indexa files (con hash SHA-256), language detectada, manifests parseados (package.json/tsconfig.json/go.mod/Cargo.toml/composer.json/pyproject.toml/Gemfile/mix.exs), AST TS Program cacheado (Babel/TS), imports resueltos (consume SymbolGraph de `r00014`), workspaces (npm/yarn/pnpm/bun monorepo)
- `index.file(relPath): IIndexedFile | undefined`; `index.astFor(relPath): ts.Program | undefined` (cached, reuse si hash no cambió); `index.manifestFor(relPath): IManifest | undefined`
- Los 25 detectores se refactorean para consumir el Index — sin re-stat del filesystem ni re-parse de manifests duplicados (verificación via spy fs.readFile)
- `ast-cache`: segundo scan del mismo proyecto = 0 re-parses si no hay cambios (test: timing budget + spy fs.readFile calls = 0 en la segunda invocación)
- `incremental-invalidator`: cambiar 1 archivo invalida solo ese archivo + sus importadores directos (grafo de dependencias inverso pre-calculado); el resto del proyecto no se reprocesa
- Performance budget: proyecto NestJS de 1k archivos < 4s primer scan, < 200ms re-scan tras cambio aislado; bench reproducible en `tests/core/ast-cache-perf.bench.ts` con umbral duro (falla si excede)
- DoD slice: `bun run typecheck && bun run test:core && bun run bench:check` verdes; el test e2e del S1 sigue verde con watch funcionando
- 14 handlers declarados en `packages/core/application-api/`: cada uno es `(input: TInput, ctx: IRequestContext) => Promise<TOutput>` puro async, sin globals, con Zod schema para input + output; `dispatcher.ts` enruta por nombre y valida entrada/salida
- Contratos JSON Schema auto-generados desde Zod via `zod-to-json-schema`; el comando `bin/apisrc api-schema --handler <name>` los imprime a stdout
- `IRequestContext` lleva `sessionId`, `signal: AbortSignal`, `caller: 'desktop' | 'browser' | 'cli'`; cada handler propaga cancelación
- `error.ts` define `IApiError { code: ApiErrorCode; message: string; details?: Record<string, unknown> }` con códigos estables (`SESSION_NOT_FOUND`, `OPERATION_NOT_FOUND`, `EXPORT_FAILED`, `INVALID_INPUT`, etc.)
- Tests `tests/application-api/handlers.spec.ts` cubren los 14 handlers con al menos 1 caso de éxito + 1 caso de error; dispatcher valida inputs inválidos
- DoD slice: `bun run typecheck && bun run test:core` verdes; ningún CLI command existente queda roto (los handlers se usan internamente desde los CLI commands que ya están migrados)
- `stdio-bridge.server.ts`: protocolo newline-delimited JSON-RPC 2.0 sobre stdin/stdout — Desktop sidecar = `bun run bin/apisrc serve --stdio`; cada request = una línea JSON parseada, cada response = una línea JSON serializada; cancel via método `$/cancelRequest` con el `requestId`
- `http-bridge.server.ts`: preserva la seguridad actual (loopback only, token por ejecución, Origin validation) — ambos bridges importan los mismos handlers de `packages/core/application-api/handlers.ts`; zero duplicación de lógica
- `bin/apisrc serve` acepta `--stdio` o `--http` (default); `--stdio` no requiere token (la IPC ya es local); `--http` mantiene la seguridad existente
- `packages/desktop/src-tauri/src/main.rs` < 150 LOC: solo bridge + window creation + sidecar spawn (no lógica de producto)
- `bridge.rs` solo conoce el contrato IPC: spawn child process, conectar stdin/stdout, propagar mensajes al webview vía `tauri::Emitter`; sidecar errors se loggean a archivo rotativo (no se descartan)
- Tests: `tests/transport/stdio-bridge.spec.ts` cubre happy path + cancelación + handler que lanza + payloads grandes (>1MB); `tests/transport/http-bridge.spec.ts` preserva los tests de seguridad existentes
- DoD slice: `bun run typecheck && bun run test:core && bun run test:desktop && bun run validate:examples` verdes; `cargo check` en el desktop verde
