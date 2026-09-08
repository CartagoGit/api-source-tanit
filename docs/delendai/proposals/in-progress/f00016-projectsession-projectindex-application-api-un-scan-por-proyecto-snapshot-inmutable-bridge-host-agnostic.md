---
id: f00016
title: "ProjectSession + ProjectIndex + Application API — un scan por proyecto, snapshot inmutable, bridge host-agnostic"
kind: feat
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-09-08
dependencies:
  - a00019#phase-2-universal-api-model
---

# f00016 — ProjectSession + ProjectIndex + Application API — un scan por proyecto, snapshot inmutable, bridge host-agnostic

> Slice de **a00019#phase-3-project-session-index** — la
> **acceptance** de esta propuesta hija cierra el bloque (c) de
> [a00019](../audits/a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md)
> (project-session-index). Cuatro slices atómicas (S1 ProjectSession,
> S2 ProjectIndex, S3 Application API, S4 Bridges) heredan los
> contratos de `r00019` (`Transport` discriminated union + `OperationId`
> universal + per-operation `serverRef`/`authRef` + `IExporter<T>`
> registry) y desbloquean `f00017` (Desktop Angular) sin volver a
> tocar el core.

## Goal

Introducir tres piezas que cambian la forma en que el core de Tanit expone su trabajo: (1) **ProjectSession** — un solo scan por apertura de proyecto, snapshot inmutable `IProjectSnapshot` consumido por inspect/generate/check/list/history; soporta cancelación via AbortSignal y watch incremental; (2) **ProjectIndex** — cache de files/AST/manifests/hashes/imports que los 25 detectores consumen en lugar de tocar el filesystem independientemente; base para `ast-cache` (0 re-parses si no hay cambios) y watch granular; (3) **Application API** — handlers host-agnostic (`open/snapshot/listEndpoints/getSchema/getService/listServices/dryRun/export/historyDiff/watch/cancel/settings/listProjects/close`) expuestos via bridge stdio (Desktop, sin HTTP ni Origin) y HTTP preservado para `apisrc ui`. El cierre del bloque (c) de [a00019](../audits/a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo identificó tres problemas: (a) `/api/inspect` y `/api/generate` ejecutan el scan independientemente — abrir un proyecto y pulsar Inspect + Generate ejecuta 2 scans completos en lugar de 1; (b) los 25 detectores del registry tocan el filesystem y parsean archivos sin coordinación — no hay cache de AST TS, ni de manifests (package.json/tsconfig/etc.), ni de imports resueltos, así que un monorepo de 1k archivos se escanea igual de lento cada vez; (c) `apisrc ui` y Tanit Desktop dependen de un servidor HTTP con handshake de token + Origin — válido para el navegador pero innecesario para el sidecar Tauri donde stdio RPC elimina puerto, URL handshake y CSRF surface. Mientras no exista ProjectSession, la GUI no puede sentirse instantánea (cada cambio de tab reescanea); sin ProjectIndex, watch incremental es inviable; sin Application API host-agnostic, Desktop no puede abandonar HTTP.

## non-goals

- Reescribir los scanners — siguen devolviendo `ParsedRoute[]`; el cambio es en el consumer (la pipeline que llama `discoverProject()`), no en el producer.
- Migrar la UI existente a Angular — eso es `f00017`; aquí solo se prepara el backend que la UI consumirá.
- Añadir transports nuevos — el snapshot se construye sobre el discriminated union de `r00019` pero su forma final es estable.
- Eliminar el servidor HTTP — se preserva para `apisrc ui`; bridge stdio es adicional para Desktop.
- Persistencia del snapshot entre runs — el snapshot es in-memory por sesión; persistencia (history-diff) es trabajo de `f00017` S5.

## Why this design

Cuatro principios guían esta propuesta:

- **Una sesión ⇒ un scan ⇒ un snapshot**. `ProjectSession` es el
  único punto de entrada para abrir un proyecto. Cualquier consumer
  (CLI command, handler del Application API, watcher interno)
  recibe el mismo `IProjectSnapshot` por su `sessionId`; el
  `discoverProject()` deja de ser una función pura que se vuelve a
  ejecutar en cada call site y pasa a ser un side-effect capturado
  una sola vez por la sesión. La idempotencia de `open()` por
  `projectRoot` (mismo root ⇒ misma sesión) es lo que elimina
  materialmente el doble scan entre Inspect y Generate.
- **Snapshot inmutable = contrato con el resto del core**. El
  `IProjectSnapshot` lleva `Object.freeze` y `readonly` en cada campo
  (`index`, `operations`, `services`, `diagnostics`, `capturedAt`).
  Esto convierte "lo que devolvió el scan" en un valor puro que
  puede compartirse entre threads del dispatcher de handlers sin
  sincronización adicional, y permite que los handlers del
  Application API declaren sus salidas contra la forma congelada
  en lugar de contra un tipo que podría mutar bajo ellos. El
  contrato con `r00019` (snapshot carga `IOperation[]` ya con
  `Transport` discriminated, `serverRef`/`authRef` per-instance y
  `provenance`) queda protegido por la inmutabilidad: los 25
  detectores producen las operaciones, `r00019` les da forma
  universal, `ProjectSession` las congela.
- **Index por-proyecto como cache compartida entre detectores**.
  El `ProjectIndex` es el único consumidor del filesystem durante
  un scan. Los 25 detectores dejan de hacer su propio `fs.readFile`
  / `ts.createProgram` / `parse(manifest)` y consumen el Index,
  que guarda SHA-256 por file, AST TS Program por path (con reuse
  cuando el hash no cambia), manifests parseados por `relPath`, y
  un grafo de dependencias inverso pre-calculado para el
  incremental invalidator. La cache se construye una vez por sesión
  y se reutiliza mientras la sesión esté abierta; `watch`
  (ProjectSession emite `snapshot-stale` + `snapshot-ready`) es lo
  que permite invalidar solo el subconjunto afectado sin re-escanear
  el proyecto entero.
- **Application API host-agnostic con dos bridges simétricos**.
  Los 14 handlers (`open/snapshot/listEndpoints/getSchema/...`) viven
  en `packages/core/application-api/` y son funciones puras async
  `(input, ctx) => output` con Zod schema para input y output,
  negociadas por `dispatcher.ts` por nombre. Cada bridge
  (`stdio-bridge.server.ts` para Desktop Tauri, `http-bridge.server.ts`
  preservando loopback + token + Origin para `apisrc ui`) importa los
  mismos handlers — no hay lógica duplicada. El `IRequestContext`
  lleva `caller: 'desktop' | 'browser' | 'cli'` para que un handler
  pueda decidir su comportamiento (e.g. logging verboso solo en
  development), y `signal: AbortSignal` para propagación de
  cancelación a través de cualquier bridge.
- **Desktop como sidecar sin red**. El `bin/apisrc serve --stdio`
  abre stdin/stdout como canal newline-delimited JSON-RPC 2.0; el
  handler de Tauri (`bridge.rs`) solo conoce el contrato IPC
  (spawn → conectar → propagar), no la lógica del producto. El
  `main.rs` queda como shell fino (< 150 LOC), lo que mantiene la
  separación de responsabilidades entre el sidecar (lógica de
  producto, testeable con bun) y la shell nativa (ventana +
  bindings webview). El HTTP preservado para `apisrc ui` mantiene
  los tests de seguridad existentes: los dos bridges comparten
  handlers pero tienen superficies de ataque independientes (stdIO
  por IPC local sin token; HTTP por loopback + token + Origin).

El diseño es coherente con `r00019` (Postman deja de ser el centro:
`Transport` es discriminated union, `OperationId` universal,
per-operation `serverRef`/`authRef`, `PostmanExporter implements
IExporter<T>`). El Application API consume ese modelo universal por
snapshot, no por `EndpointSpec` legacy.

## Architecture

Tres capas que separan el problema en transiciones pequenas y verificables:

1. **Session layer (`packages/core/session/`)** — `ProjectSession` +
   `IProjectSession` + `IProjectSnapshot` (inmutable, `Object.freeze`).
   Orquesta el ciclo de vida (open/close/cancel/reuse), emite
   eventos para watch (`snapshot-stale` / `snapshot-ready`),
   direcciona el `discoverProject()` del core actual a través del
   `ProjectIndex` (de S2) sin tocar los 25 scanners. Es el único
   punto donde el scan se ejecuta exactamente una vez por sesión.
2. **Index layer (`packages/core/index/`)** — `ProjectIndex` (file
   cache + AST cache + manifest cache + workspace resolver +
   incremental invalidator). Reemplaza los 25 accesos directos al
   filesystem por un único consumidor del Index, preparado para
   `ast-cache` (0 re-parses si no cambia el hash) y watch granular
   (grafo de dependencias inverso pre-calculado). El
   `framework.registry.ts` se refactoriza para inyectar el `Index`
   en lugar de paths crudos.
3. **Application layer (`packages/core/application-api/` +
   `packages/core/transport/`)** — 14 handlers declarativos con
   Zod, `dispatcher.ts` por nombre, contratos JSON Schema
   auto-generados. Dos bridges simétricos (`stdio-bridge.server.ts`
   / `http-bridge.server.ts`) que importan exactamente los mismos
   handlers — el HTTP preserva loopback + token + Origin para
   `apisrc ui`, el stdIO abre un canal newline-delimited JSON-RPC
   para el sidecar Tauri (`bin/apisrc serve --stdio`). `main.rs`
   del desktop queda en shell fino (< 150 LOC); `bridge.rs` solo
   conoce el contrato IPC.

### Dependency on `a00019#phase-2-universal-api-model`

f00016 aterriza sobre la baseline de
[phase-2-universal-api-model](../audits/a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md#phase-2-universal-api-model--fase-2--universal-api-model-v2-operationid-universal-per-operation-serverrefauthref-postman-como-exporter-ms)
(`Transport` discriminated union + `OperationId` universal +
per-operation `serverRef`/`authRef` + `PostmanExporter implements
IExporter<IPostmanCollectionV21>`). El snapshot que produce
`ProjectSession.open()` carga el modelo universal de `r00019`; sin
esa forma, los 14 handlers del Application API no pueden declararse
contra `IOperation` y vuelven a depender del legacy `EndpointSpec`.
Esta dependencia se declara en el frontmatter
(`dependencies: [a00019#phase-2-universal-api-model]`) para que el
orchestrator la respete al planificar. Adicionalmente, S2 del
presupuesto consume `SymbolGraph` (`r00014`) para resolver imports
cross-file cuando re-indexa — esa es una dependencia de bloques,
no de proposal; `r00014` ya está archivada como done y se referencia
en la acceptance de S2.

### Files layout (preview tras las cuatro slices)

```text
packages/core/session/                           # S1
  project-session.service.ts
  project-snapshot.ts
  session-events.ts
  session-id.ts
  session-error.ts

packages/core/index/                             # S2
  project-index.service.ts
  file-cache.service.ts
  ast-cache.service.ts
  manifest-reader.service.ts
  workspace-resolver.service.ts
  incremental-invalidator.service.ts

packages/core/application-api/                   # S3
  handlers.ts
  open-project.handler.ts
  snapshot.handlers.ts
  list-endpoints.handler.ts
  get-endpoint.handler.ts
  get-schema.handler.ts
  list-services.handler.ts
  dry-run.handler.ts
  export.handler.ts
  history.handlers.ts
  watch.handlers.ts
  cancel.handler.ts
  settings.handlers.ts
  list-projects.handler.ts
  close.handler.ts
  zod-schemas.ts
  dispatcher.ts
  error.ts

packages/core/transport/                         # S4 (core)
  stdio-bridge.server.ts
  http-bridge.server.ts
  bridge-error.ts
  json-rpc-protocol.ts

packages/desktop/src-tauri/src/                  # S4 (rust)
  main.rs                                         # < 150 LOC
  bridge.rs                                       # IPC contract only
  sidecar.rs                                      # spawn + stderr log
```

Los CLI commands que ya están migrados (`inspect`, `generate`,
`list-endpoints`, `check`, `serve`) migran de su implementación
actual a consumir `ProjectSession.open()` y, donde aplique, los
handlers del Application API. La migración se hace slice por slice;
los comandos no desaparecen, sólo cambian de cuerpo. Los consumers
externos (`apisrc ui`, Tanit Desktop) hablan con el mismo Application
API vía el bridge que prefieran, sin acoplarse a la implementación
interna del core.

## Slices

- global_gate: e2e

### S1-ProjectSession-single-scan — S1 — ProjectSession: open() una vez, snapshot inmutable, AbortSignal, watch incremental stub
- **Status**: done
- **Files**: `packages/core/session/project-session.service.ts`, `packages/core/session/project-snapshot.ts`, `packages/core/session/session-events.ts`, `packages/core/session/session-id.ts`, `packages/core/session/session-error.ts`, `tests/core/session/project-session.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`ProjectSession.open(projectRoot, opts): Promise<IProjectSession>` ejecuta scan exactamente una vez; segundo `open()` del mismo root devuelve la misma sesión (idempotente)"
  - "`IProjectSnapshot` es inmutable (`readonly` en todos los campos, `Object.freeze` en construcción) e incluye `index: IProjectIndex`, `operations: readonly IOperation[]`, `services: readonly IServiceDescriptor[]`, `diagnostics: readonly IDiagnostic[]`, `capturedAt: Date`"
  - "`session.current(): IProjectSnapshot` accessor; `session.close()` libera recursos; `session.cancel(AbortSignal)` propaga a scans en curso"
  - "`session.on('snapshot-stale', cb)` + `session.on('snapshot-ready', cb)` eventos para watch — implementación S1 los emite con un watcher de filesystem básico (`chokidar` o `node:fs.watch`) sobre los source files del index"
  - "Tests: `tests/core/session/project-session.spec.ts` cubre open/close/idempotencia/cancelación/eventos; `tests/cli/session-flow.test.ts` cubre el flujo CLI completo"
  - "DoD slice: `bun run typecheck && bunx vitest run tests/core/session/project-session.spec.ts` verdes"
- review-state: done
- review-implementer: finch
- review-reviewer: delivery-verifier
- review-log: approved by delivery-verifier — f00016 S1 (consolidación documental) — slices atomicas disenyadas, dependencias declaradas con a00019 phase-2, INDEX regenerable, gates verdes. Aprobada por verifier distinto de finch.
- shipped-in: not recorded (closed without a known delivering commit)
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

## Risks

- **Idempotencia de `ProjectSession.open()` ⇒ cache key collision**.
  Dos `open()` del mismo `projectRoot` deben devolver la misma sesión
  — pero el sistema de sesiones vive en memoria y un descriptor
  in-memory puede sobrevivir a cambios del filesystem raíz que vuelvan
  válido el scan previo. Mitigación: la key incluye el
  `mtime:size` del manifest raíz (`package.json` / `pom.xml` /
  `go.mod` / etc.) detectado por el `workspace-resolver.service.ts`;
  cualquier drift invalida el snapshot. Detectado por test
  e2e `session-flow.test.ts` en S1.
- **`Object.freeze` vs Proxy interno mutable**. Congelar el snapshot
  protege a los consumers pero rompe a quien necesite construir el
  objeto acumulativamente. Mitigación: construcción interna via
  factory `(index, operations, services, diagnostics, capturedAt) =>
  Object.freeze({ ... })` con tipos `readonly` profundos; ningún
  campo se construye por mutación. Detectado por
  `tests/core/session/project-session.spec.ts` que congela el snapshot
  final y verifica que todas las mutaciones fallan en TS strict.
- **Cache invalidation en watch**. El watcher básico de S1 (`chokidar`
  o `node:fs.watch`) detecta cambios pero a nivel de file. Un test
  que cree + borre + cree el mismo file podría disparar eventos
  innecesarios. Mitigación: el `incremental-invalidator.service.ts`
  (S2) mantiene el grafo de dependencias inverso y solo invalida los
  nodos downstream afectados; la acceptance de S2 cubre el caso con
  un test focalizado.
- **`zod-to-json-schema` y la forma del discriminated union de
  `Transport`**. `r00019` introduce el discriminated union como tipo;
  S3 lo pone en Zod schemas. Si la conversión a JSON Schema pierde la
  información del discriminador (lo cual ocurre en algunas versiones
  de la librería), `bin/apisrc api-schema --handler listEndpoints`
  devolvería un schema sin `oneOf` por tipo de transport. Mitigación:
  pin a `zod-to-json-schema` >= la versión que respeta
  `discriminator: true`; el test `handlers.spec.ts` verifica que el
  JSON Schema generado tiene la forma esperada.
- **Webview Tauri y cancelación via JSON-RPC `$/cancelRequest`**.
  `bridge.rs` debe traducir un mensaje de cancelación entrante del
  webview a un mensaje IPC al sidecar; el mapeo
  `requestId → AbortSignal` vive en una tabla en memoria que se
  purga en `response` o `timeout`. Mitigación: la tabla tiene TTL
  configurable (default 60 s) y se libera tanto en respuesta como en
  timeout; el test `stdio-bridge.spec.ts` cubre payloads grandes y
  abortos concurrentes.
- **Cobertura de S3 = 14 handlers en un solo slice**. Los 14 handlers
  son archivos disjuntos (una entrada por handler en `Files`) pero
  comparten `zod-schemas.ts`, `dispatcher.ts` y `error.ts`. Si la
  cobertura de un solo handler no se entrega, S3 no cierra. Esa es
  la regla del DoD global de `bun run test:core`; no es
  bloqueante en abstracto, pero requiere que el implementer entregue
  los 14 + dispatcher + error + zod-schemas como una unidad
  verificable. Disjunta con S2 (no toca `packages/core/index/`) y
  con S4 (no toca `packages/core/transport/`).
- **Dependencia cruzada con `r00019` (Universal API Model v2)**. S3
  declara los handlers contra `IOperation` discriminated. Si en la
  base actual el `IOperation` aún tiene la forma legacy de
  `r00016` (pre-discriminated), el typecheck fallará al cerrar S3.
  Mitigación: la dependencia `a00019#phase-2-universal-api-model` ya
  cierra el gap; se valida por `bun run typecheck` antes de aceptar
  S3. Si por regresión el shape no fuera el esperado, el implementer
  se coordina con el cierre de `r00019` antes de empezar S3.
- **Limpieza del worktree entre slices**. Como el lock de la sesión
  hoy no puede distinguir archivos entre slices (`packages/core/index/`
  pertenece a S2 pero no a S1), un agente que trabaje S1+S2 en
  paralelo pisaría archivos. Mitigación: el DoD de cada slice
  declara `bun run typecheck && bun run test:core && ...` como gate
  de transición; `bun run lint:clean-tree` evita residuos; los
  archivos entre slices están separados por directorio (`session/`
  vs `index/` vs `application-api/` vs `transport/`), así que el
  solapamiento accidental es detectable por `git status` durante la
  revisión del implementer.
