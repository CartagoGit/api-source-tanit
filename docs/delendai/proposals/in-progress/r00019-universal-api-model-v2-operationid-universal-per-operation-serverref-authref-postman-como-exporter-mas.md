---
id: r00019
title: "Universal API Model v2 — OperationId universal, per-operation serverRef/authRef, Postman como exporter más"
kind: refactor
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-09-07
dependencies:
  - a00019#phase-1-hygiene-ci
last-transition-id: 05bef354-44f9-4fa2-b45d-59d80b6eb09d
last-correlation-id: 05bef354-44f9-4fa2-b45d-59d80b6eb09d
last-transition-from: review
---

# r00019 — Universal API Model v2 — OperationId universal, per-operation serverRef/authRef, Postman como exporter más

## Goal

Desacoplar Tanit del modelo Postman-centric. Hoy `EndpointSpec` vive en `packages/contracts/interfaces/core/postman.interface.ts`, `generation.pipeline.ts` describe `projectRoot → PostmanCollection`, `TransportKind` acepta `| string` con opcionales absurdos, y `combineServices` hereda `baseUrl`/`auth`/`variables` del primer servicio. El objetivo: (1) `TransportKind` se convierte en discriminated union con campos requeridos por rama (`HttpTransport { method, path }`, `GraphQlTransport { operationType, operationName }`, `GrpcTransport { service, rpc, streaming }`, `WebSocketTransport { event, direction, namespace }`, `SseTransport { event, streamPath }`, `MessageBrokerTransport { broker, channel, direction }`); (2) `OperationId` es función pura universal por transport; (3) `Operation` lleva `serverRef`, `authRef`, `transport`, `provenance` per-instance (los cuatro discriminados en la rama HTTP, presentes vía contexto en otras); (4) `combineServices` genera `{{baseUrl_<serviceId>}}` por servicio; (5) `PostmanExporter` implementa `IExporter` igual que OpenAPI/Bruno/HAR — un exporter más, no el centro; (6) `generation.pipeline.ts` termina en `buildArtifacts(snapshot, exporters)` declarativo. Cierra los hallazgos §3.2, §3.3, §3.4 de [a00019](./a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo señala tres síntomas de acoplamiento: (a) `EndpointSpec` requiere `method` y `uri` incluso cuando conceptualmente se representa otra cosa (un `GrpcTransport` con `service` + `rpc` no debería tener `method: "POST"` por defecto); (b) `combineServices({ services: [users:OAuth+https://users.example.com, orders:APIKey+https://orders.example.com] })` produce una colección combinada donde todas las operaciones heredan el `baseUrl` y `auth` del primer servicio — el audit confirma que el propio `generation.pipeline.ts` reconoce este comportamiento y que el bug de monorepo real (users+orders con auths distintos) sigue abierto; (c) Postman se genera por un camino distinto al de OpenAPI/Bruno/HAR/Insomnia/cURL (los últimos van por el registry de exporters declarativo). Mientras el modelo siga Postman-centric, los exporters no pueden ser ciudadanos de primera, los transports no pueden ser discriminated (los `opcionales` los dejan en un estado malformado legal), y combinar servicios en un monorepo real sigue siendo unsafe.

## Why this design

Cuatro principios guían esta propuesta:

- **Discriminated union > union con opcionales**. `Transport = HttpTransport | GraphQlTransport | ...` con `kind: literal` impide en compilación que un `GrpcTransport` carezca de `service` o que un `HttpTransport` pierda `path`. El typecheck deja de mentir. El exhaustive switch en `operationIdFor()` obliga a cubrir cada rama al añadir un transport — añadir uno nuevo sin implementar rompe el typecheck y se detecta antes del CI.
- **OperationId como función pura universal**. `operationIdFor(transport, ctx)` es determinista y testeable: el mismo `transport` + el mismo `ctx` produce siempre el mismo `OperationId`, independientemente del scanner que lo detectó. Esto es lo que necesitan los IDs estables para Postman / Bruno / OpenAPI.
- **Per-operation `serverRef` y `authRef`**. La raíz del bug "combineServices hereda del primer servicio" es estructural: los servicios compartían descriptor y las operaciones no tenían su propio `serverRef`/`authRef`. Subir estos campos a `IOperation` los hace per-instance y elimina la herencia. El `perOperationResolver.resolve(operation, services)` materializa la asociación a partir de `operation.serviceId`, no del orden del array.
- **PostmanExporter = un exporter más**. Hoy Postman tiene un camino especial (`generateArtifacts()` estático, sin `IExporter`, sin `ExportCapabilities`). Esa asimetría es el síntoma; el remedio es alinear la firma con OpenAPI / Bruno / HAR / Insomnia / cURL. `ExportCapabilities.schemas: 'partial'` documenta honestamente que Postman no expresa todas las capacidades que el modelo universal tiene — sin pretender lo contrario.

## non-goals

- Reescribir los scanners para que devuelvan directamente discriminated unions — los scanners siguen devolviendo `ParsedRoute[]` neutro; la discriminated narrow ocurre en la capa de transport-detection al cruzar al modelo universal.
- Migrar todos los exporters a la vez — solo PostmanExporter cambia en esta propuesta; los demás (OpenAPI/Bruno/HAR/Insomnia/cURL) ya son exporters puros y siguen funcionando.
- Añadir nuevos transports (e.g. GraphQL federation, gRPC bidi-streaming) — se modela el discriminador para que entren sin cambios arquitectónicos, pero la implementación completa de cada transport es trabajo posterior por transport.
- Cambiar el comportamiento de los flags del CLI — los flags actuales (`--combine-services`, `--output`, etc.) se preservan; solo cambia la capa interna que los consume.
- Tocar `f00013` (transport generalization actual) — sus 6 transports viven como union actual; aquí se elevan a discriminated unions, pero los scanners siguen emitiendo el union neutral.

## Architecture

Cuatro capas que separan el problema en transiciones pequenas y verificables:

1. **Scanner → `ParsedRoute[]`** (sin cambios). Los 25 detectores siguen emitiendo `ParsedRoute` neutro. Refactor invisible para `packages/frameworks/`.
2. **Transport-detection → discriminated `Transport`**. `transport-narrow.guard.ts` y `operation-id.service.ts` cruzan `ParsedRoute` al `Transport` con `kind` literal. Aquí se concentra la complejidad de la discriminated union: type guards exhaustivos, función pura `operationIdFor()`, contratos `IHttpTransport | IGraphQlTransport | IGrpcTransport | IWebSocketTransport | ISseTransport | IMessageBrokerTransport` con todos los campos requeridos.
3. **`IOperation` con `serverRef`/`authRef`/`transport`/`provenance` per-instance**. La combinación `combineServices` deja de ser "el primero gana" y pasa a `perOperationResolver` que asigna refs por `operation.serviceId`. `ICombinedDescriptor.variables` emite `{{baseUrl_<serviceId>}}` por servicio, no una sola `{{baseUrl}}` global.
4. **`IExporter[]` registry + `buildArtifacts` declarativo**. `PostmanExporter implements IExporter<IPostmanCollectionV21>` con la misma firma que OpenAPI / Bruno / HAR / Insomnia / cURL. `generation.pipeline.ts` termina en `buildArtifacts(snapshot, exporters): Promise<IExportResult[]>`; el CLI itera el registry por flag (`--formats postman,openapi,...`).

### Dependency on `a00019#phase-1-hygiene-ci`

r00019 aterriza sobre la baseline de [phase-1-hygiene-ci](./a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md) (CI verde end-to-end, branch protection real en `develop`, coverage ≥ 80% global, fixtures reparadas, monkey-patches eliminados, `INDEX.md` regenerado). Sin esa baseline, las Slices no pueden validarse de forma reproducible — `bun run validate` no sería el DoD confiable que esta propuesta declara en cada slice. Esta dependencia se declara en el frontmatter (`dependencies: [a00019#phase-1-hygiene-ci]`) para que el orchestrator la respete al planificar; mientras esa slice no cierre, r00019 NO se aprueba.

### Files layout (resultado de S1)

```text
packages/contracts/interfaces/core/
  operation.interface.ts                 # IOperation
  server-ref.interface.ts                 # IServerRef
  auth-ref.interface.ts                   # IAuthRef
  provenance.interface.ts                 # IProvenance
  transport/
    http-transport.interface.ts               # IHttpTransport
    graphql-transport.interface.ts            # IGraphQlTransport
    grpc-transport.interface.ts                # IGrpcTransport
    websocket-transport.interface.ts           # IWebSocketTransport
    sse-transport.interface.ts                 # ISseTransport
    message-broker-transport.interface.ts      # IMessageBrokerTransport
    index.ts                                   # barrel
    operation-id.service.ts                    # operationIdFor() pura
    transport-narrow.guard.ts                  # isHttpTransport(t): t is IHttpTransport, ...
```

### Files layout (resultado de S4)

```text
packages/core/exporters/
  i-exporter.interface.ts        # IExporter<TArtifact>, ExportCapabilities, IExportResult
  registry.ts                    # EXPORTER_IDS union + selectExporters(formats)
  result.ts                      # IExportResult<TArtifact>
  postman.exporter.ts            # PostmanExporter implements IExporter<IPostmanCollectionV21>

packages/core/discovery/
  generation.pipeline.ts         # buildArtifacts(snapshot, exporters)
```

## Slices

- global_gate: e2e

### S1-transport-discriminated-unions — S1 — TransportKind como discriminated union + OperationId universal + IOperation shape
- **Status**: done
- **Files**: `packages/contracts/interfaces/core/transport/http-transport.interface.ts`, `packages/contracts/interfaces/core/transport/graphql-transport.interface.ts`, `packages/contracts/interfaces/core/transport/grpc-transport.interface.ts`, `packages/contracts/interfaces/core/transport/websocket-transport.interface.ts`, `packages/contracts/interfaces/core/transport/sse-transport.interface.ts`, `packages/contracts/interfaces/core/transport/message-broker-transport.interface.ts`, `packages/contracts/interfaces/core/transport/index.ts`, `packages/contracts/interfaces/core/operation.interface.ts`, `packages/contracts/interfaces/core/server-ref.interface.ts`, `packages/contracts/interfaces/core/auth-ref.interface.ts`, `packages/contracts/interfaces/core/provenance.interface.ts`, `packages/contracts/interfaces/core/transport/operation-id.service.ts`, `packages/contracts/interfaces/core/transport/transport-narrow.guard.ts`, `packages/contracts/index.ts`, `tests/core/operation-id.spec.ts`, `tests/contracts/transport-shape.spec.ts`
- **Gate**: type
- acceptance:
  - "`Transport` es discriminated union: `HttpTransport { kind: 'http'; method: HttpMethod; path: string }`, `GraphQlTransport { kind: 'graphql'; operationType: 'query' | 'mutation' | 'subscription'; operationName: string }`, `GrpcTransport { kind: 'grpc'; service: string; rpc: string; streaming: 'unary' | 'server' | 'client' | 'bidi' }`, `WebSocketTransport { kind: 'websocket'; event: string; direction: 'in' | 'out' | 'both'; namespace: string }`, `SseTransport { kind: 'sse'; event: string; streamPath: string }`, `MessageBrokerTransport { kind: 'broker'; broker: 'kafka' | 'rabbitmq' | 'nats' | 'mqtt'; channel: string; direction: 'publish' | 'subscribe' }` — todos los campos requeridos, no opcionales"
  - "`IOperation { id: OperationId; serviceId: string; transport: Transport; serverRef: IServerRef; authRef: IAuthRef; request: IRequestSpec; responses: IResponseSpec[]; provenance: IProvenance }` con `IServerRef`, `IAuthRef`, `IProvenance` como interfaces separadas en sus propios ficheros"
  - "`operationIdFor(transport, ctx): OperationId` función pura con exhaustive switch — typecheck obliga a cubrir cada nuevo transport (test: añadir un transport sin implementar rompe el typecheck)"
  - "`isHttpTransport(t): t is HttpTransport` y análogos para narrowing type-safe"
  - "`packages/contracts/index.ts` exporta los nuevos tipos para los consumidores del barrel"
  - "Tests: `tests/core/operation-id.spec.ts` cubre los 6 transports + 1 caso mal formado (gRPC sin service) → discriminated narrowing rechaza con mensaje claro; `tests/contracts/transport-shape.spec.ts` verifica exhaustiveness"
  - "DoD slice: `bun run typecheck && bun run test:core` verdes"
- review-state: done
- review-implementer: implementation-runner-r00019-s1
- review-reviewer: delivery-verifier-r00019-s1
- review-log: approved by delivery-verifier-r00019-s1 — Independent review of r00019/S1-transport-discriminated-unions. Slice scope verified: 6 transport interfaces (http/graphql/grpc/websocket/sse/broker) all declared as discriminated unions with required (non-optional) fields, kind literals, and HttpMethod sourced from SUPPORTED_METHODS. IOperation has the eight required fields (id, serviceId, transport, serverRef, authRef, request, responses, provenance); IServerRef/IAuthRef/IProvenance in dedicated files. operationIdFor is a pure function with exhaustive switch + assertNever + Object.freeze — adding a new transport kind without a case breaks the typecheck. is*Transport guards validate kind + required fields at runtime. Validation: typecheck:contracts (1/1 sections pass), typecheck:core (1/1 pass), contracts tests (3 files / 217 tests pass), core tests (90 files / 1286 tests pass) + sqlite (15 tests) = 1518 total, lint:contracts (461 types/constants, 3 declared exceptions), lint:naming (650 files / 37 folder rules), lint:no-orphan-types (4 type packages, all declared or transitive). Legacy TransportKind (from f00013) is intentionally not touched per non-goals — coexistence is documented in proposal Risks. Note: operation-id.service.ts and transport-narrow.guard.ts live under packages/core/transport/ (not packages/contracts/interfaces/core/transport/ as the original Files layout stated). This is a deliberate refactor in e2135c5 that keeps the contracts package type-only (runtime helpers belong in core); the public surface is unaffected because consumers import runtime helpers from packages/core/transport/ directly and types from the contracts barrel. Approval given — implementation matches the architectural intent.
### S2-postman-interface-cleanup — S2 — Postman interface cleanup: drop EndpointSpec, mantener solo tipos Postman-específicos
- **Status**: pending
- **DependsOn**: [S1-transport-discriminated-unions]
- **Files**: `packages/contracts/interfaces/core/postman.interface.ts`
- **Gate**: type
- acceptance:
  - "`packages/contracts/interfaces/core/postman.interface.ts` pierde `EndpointSpec`, `EndpointField`, `EndpointResponse`, `EndpointAuth` y derivados; mantiene solo tipos Postman-específicos (`IPostmanCollection`, `IPostmanItem`, `IPostmanResponse`, `IPostmanVariable`, `IPostmanHeader`, `IPostmanUrl`)"
  - "Re-exporta `IOperation` desde `operation.interface.ts` para compat con consumers que aún esperan el tipo en este fichero (deprecation notice en JSDoc); el re-export se elimina en la propuesta que retire el legacy"
  - "`bun run lint:contracts` verde — el grep por `EndpointSpec` desde `postman.interface.ts` no devuelve resultados en `packages/core/` ni `packages/cli/`"
  - "DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core` verdes; ningún consumer existente queda roto"

### S3-combineServices-with-per-service-context — S3 — combineServices con contexto per-service y per-operation resolver
- **Status**: pending
- **DependsOn**: [S2-postman-interface-cleanup]
- **Files**: `packages/core/merge/combine-services.service.ts`, `packages/core/merge/per-operation-resolver.service.ts`, `packages/contracts/interfaces/core/service.interface.ts`, `tests/core/combine-services.spec.ts`, `tests/fixtures/multi-service/users-api/package.json`, `tests/fixtures/multi-service/users-api/src/main.ts`, `tests/fixtures/multi-service/billing-api/pyproject.toml`, `tests/fixtures/multi-service/billing-api/main.py`
- **Gate**: e2e
- acceptance:
  - "`combineServices(services: IServiceDescriptor[]): ICombinedDescriptor` donde cada `IServiceDescriptor` lleva `id`, `baseUrl`, `auth`, `variables`, `transport`, `endpoints`; sin herencia del primero"
  - "`perOperationResolver.resolve(operation, services): { serverRef, authRef }` resuelve por `operation.serviceId` (no del primer descriptor)"
  - "`ICombinedDescriptor.variables` incluye `{{baseUrl_<serviceId>}}` por servicio; cada `IOperation` apunta a su `serverRef` correcto"
  - "Fixture `tests/fixtures/multi-service/` con dos APIs distintas: NestJS users (OAuth + https://users.example.com) + FastAPI billing (APIKey + https://billing.example.com) — código real que ejercita `combineServices` sin heredar auth/baseUrl del primero"
  - "Tests `tests/core/combine-services.spec.ts` cubren: 1 servicio (no-op), 2 servicios con auth distinto, 2 servicios con baseUrl distinto, combinación + per-operation resolver correcto"
  - "DoD slice: `bun run typecheck && bun run test:core` verdes; la integración con pipeline queda para S4 (no se rompe el comportamiento legacy hasta entonces)"
- review-state: changes_requested
- review-implementer: delendai-impl-20260909
- review-reviewer: delivery-verifier
- review-log: requested_changes by delivery-verifier — La revisión requiere: (1) fixtures reales con OAuth + https://users.example.com y API key + https://billing.example.com; (2) prueba de integración que cargue/ejercite esas fixtures y demuestre serviceId/serverRef/authRef; (3) resolver la duplicidad semántica de IServiceDescriptor entre service.interface.ts y service-graph.interface.ts mediante adaptador o contrato público claro, preservando legacy; (4) añadir cobertura barata para IDs/variables duplicadas y servicios sin endpoints si el diseño lo permite.
### S4-postman-as-IExporter — S4 — PostmanExporter implementa IExporter + pipeline declarativo + CLI consume exporters del registry
- **Status**: pending
- **DependsOn**: [S3-combineServices-with-per-service-context]
- **Files**: `packages/core/discovery/generation.pipeline.ts`, `packages/core/exporters/postman.exporter.ts`, `packages/core/exporters/registry.ts`, `packages/core/exporters/i-exporter.interface.ts`, `packages/core/exporters/result.ts`, `packages/cli/commands/generate.script.ts`, `tests/core/exporters/postman-universal.spec.ts`, `tests/core/generation-pipeline.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`packages/core/exporters/i-exporter.interface.ts` declara `IExporter<TArtifact>` con `id: ExportFormatId`, `capabilities: ExportCapabilities`, `build(snapshot: IProjectSnapshot): Promise<IExportResult<TArtifact>>`; `ExportCapabilities { transports: Transport['kind'][]; schemas: 'full' | 'partial' | 'reference'; responses: 'full' | 'partial' | 'lossy'; auth: 'full' | 'partial' | 'lossy'; examples: boolean; multiService: boolean }`"
  - "`PostmanExporter implements IExporter<IPostmanCollectionV21>` con misma firma que OpenAPI/Bruno/HAR/Insomnia/cURL; `generateArtifacts()` estático desaparece — pasa a método de instancia"
  - "`packages/core/exporters/registry.ts` lista Postman junto a OpenAPI/Bruno/HAR/Insomnia/cURL sin path especial; `EXPORTER_IDS` union exhaustivo; `selectExporters(formats: ExportFormatId[]): IExporter[]` helper"
  - "`generation.pipeline.ts` termina en `async function buildArtifacts(snapshot, exporters: IExporter[]): Promise<IExportResult[]>` declarativo; integra `combineServices` (de S3) y `perOperationResolver`; los flags `--formats postman,openapi,...` iteran el registry"
  - "`generate.script.ts` consume `buildArtifacts` con los exporters seleccionados por flag; el writer sigue siendo atómico (los artefactos se escriben todos o ninguno, via `writeFileAtomic` por artefacto)"
  - "Tests: `tests/core/exporters/postman-universal.spec.ts` cubre PostmanExporter con snapshot vacío / 1 operación / multi-service / per-operation serverRef/authRef divergentes; `tests/core/generation-pipeline.spec.ts` verifica que la lista de exporters se ejecuta declarativamente y que un exporter que lanza no aborta el resto (errores se acumulan en diagnostics)"
  - "DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core && bun run validate:examples` verdes; ningún consumer del CLI nota diferencia observable; snapshot regression tests verde"

## acceptance

- `Transport` es discriminated union: `HttpTransport { kind: 'http'; method: HttpMethod; path: string }`, `GraphQlTransport { kind: 'graphql'; operationType: 'query' | 'mutation' | 'subscription'; operationName: string }`, `GrpcTransport { kind: 'grpc'; service: string; rpc: string; streaming: 'unary' | 'server' | 'client' | 'bidi' }`, `WebSocketTransport { kind: 'websocket'; event: string; direction: 'in' | 'out' | 'both'; namespace: string }`, `SseTransport { kind: 'sse'; event: string; streamPath: string }`, `MessageBrokerTransport { kind: 'broker'; broker: 'kafka' | 'rabbitmq' | 'nats' | 'mqtt'; channel: string; direction: 'publish' | 'subscribe' }` — todos los campos requeridos, no opcionales
- `IOperation { id: OperationId; serviceId: string; transport: Transport; serverRef: IServerRef; authRef: IAuthRef; request: IRequestSpec; responses: IResponseSpec[]; provenance: IProvenance }` con `IServerRef`, `IAuthRef`, `IProvenance` como interfaces separadas en sus propios ficheros
- `operationIdFor(transport, ctx): OperationId` función pura con exhaustive switch — typecheck obliga a cubrir cada nuevo transport (test: añadir un transport sin implementar rompe el typecheck)
- `isHttpTransport(t): t is HttpTransport` y análogos para narrowing type-safe
- `packages/contracts/index.ts` exporta los nuevos tipos para los consumidores del barrel
- Tests: `tests/core/operation-id.spec.ts` cubre los 6 transports + 1 caso mal formado (gRPC sin service) → discriminated narrowing rechaza con mensaje claro; `tests/contracts/transport-shape.spec.ts` verifica exhaustiveness
- DoD slice: `bun run typecheck && bun run test:core` verdes
- `packages/contracts/interfaces/core/postman.interface.ts` pierde `EndpointSpec`, `EndpointField`, `EndpointResponse`, `EndpointAuth` y derivados; mantiene solo tipos Postman-específicos (`IPostmanCollection`, `IPostmanItem`, `IPostmanResponse`, `IPostmanVariable`, `IPostmanHeader`, `IPostmanUrl`)
- Re-exporta `IOperation` desde `operation.interface.ts` para compat con consumers que aún esperan el tipo en este fichero (deprecation notice en JSDoc); el re-export se elimina en la propuesta que retire el legacy
- `bun run lint:contracts` verde — el grep por `EndpointSpec` desde `postman.interface.ts` no devuelve resultados en `packages/core/` ni `packages/cli/`
- DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core` verdes; ningún consumer existente queda roto
- `combineServices(services: IServiceDescriptor[]): ICombinedDescriptor` donde cada `IServiceDescriptor` lleva `id`, `baseUrl`, `auth`, `variables`, `transport`, `endpoints`; sin herencia del primero
- `perOperationResolver.resolve(operation, services): { serverRef, authRef }` resuelve por `operation.serviceId` (no del primer descriptor)
- `ICombinedDescriptor.variables` incluye `{{baseUrl_<serviceId>}}` por servicio; cada `IOperation` apunta a su `serverRef` correcto
- Fixture `tests/fixtures/multi-service/` con dos APIs distintas: NestJS users (OAuth + https://users.example.com) + FastAPI billing (APIKey + https://billing.example.com) — código real que ejercita `combineServices` sin heredar auth/baseUrl del primero
- Tests `tests/core/combine-services.spec.ts` cubren: 1 servicio (no-op), 2 servicios con auth distinto, 2 servicios con baseUrl distinto, combinación + per-operation resolver correcto
- DoD slice: `bun run typecheck && bun run test:core` verdes; la integración con pipeline queda para S4 (no se rompe el comportamiento legacy hasta entonces)
- `packages/core/exporters/i-exporter.interface.ts` declara `IExporter<TArtifact>` con `id: ExportFormatId`, `capabilities: ExportCapabilities`, `build(snapshot: IProjectSnapshot): Promise<IExportResult<TArtifact>>`; `ExportCapabilities { transports: Transport['kind'][]; schemas: 'full' | 'partial' | 'reference'; responses: 'full' | 'partial' | 'lossy'; auth: 'full' | 'partial' | 'lossy'; examples: boolean; multiService: boolean }`
- `PostmanExporter implements IExporter<IPostmanCollectionV21>` con misma firma que OpenAPI/Bruno/HAR/Insomnia/cURL; `generateArtifacts()` estático desaparece — pasa a método de instancia
- `packages/core/exporters/registry.ts` lista Postman junto a OpenAPI/Bruno/HAR/Insomnia/cURL sin path especial; `EXPORTER_IDS` union exhaustivo; `selectExporters(formats: ExportFormatId[]): IExporter[]` helper
- `generation.pipeline.ts` termina en `async function buildArtifacts(snapshot, exporters: IExporter[]): Promise<IExportResult[]>` declarativo; integra `combineServices` (de S3) y `perOperationResolver`; los flags `--formats postman,openapi,...` iteran el registry
- `generate.script.ts` consume `buildArtifacts` con los exporters seleccionados por flag; el writer sigue siendo atómico (los artefactos se escriben todos o ninguno, via `writeFileAtomic` por artefacto)
- Tests: `tests/core/exporters/postman-universal.spec.ts` cubre PostmanExporter con snapshot vacío / 1 operación / multi-service / per-operation serverRef/authRef divergentes; `tests/core/generation-pipeline.spec.ts` verifica que la lista de exporters se ejecuta declarativamente y que un exporter que lanza no aborta el resto (errores se acumulan en diagnostics)
- DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core && bun run validate:examples` verdes; ningún consumer del CLI nota diferencia observable; snapshot regression tests verde
- Validación post-cambio: `bun run lint:proposals:gen-index` produce `INDEX.md` byte-idéntico al committed (sin diff); r00019 sigue en `ready/refactors/` y no se mueve a `done/` hasta que phase-1-hygiene-ci cierre (ver `dependencies:` en frontmatter)

## Risks

- **Broken cross-proposal link**. r00019 enlaza a `[a00019](./a00019-...)` que apunta a `ready/refactors/a00019-...` (no existe); la ruta correcta es `../../in-progress/a00019-...`. El mismo patrón roto existe en `f00016` / `f00017` / `r00020` / `i00003` desde sus respectivas subcarpetas. Corregir el link de r00019 es trivial; los otros cuatro requieren tocar archivos fuera del scope de esta slice y se documentan aquí para una propuesta cross-cutting de hygiene de docs. Alternativamente, mover los hijos a `ready/<kind>/` con el path ya correcto lo resuelve de raíz.
- **`f00013` shape drift**. `f00013` introdujo los 6 transports como union con opcionales. S1 los eleva a discriminated unions. Si el shape en `f00013` y el shape declarado en r00019 S1 divergen en implementación, el typecheck fallará al cerrar S1. Detectado por `bun run typecheck`; no es bloqueante pero requiere atención del implementer.
- **Consumers externos de `generateArtifacts()` estático**. S4 convierte el método estático `PostmanExporter.generateArtifacts()` en método de instancia. Cualquier consumer fuera de `packages/core/` (e.g. `packages/cli/`, `integrations/`) que invoque el estático rompe en silencio. Mitigación: `bun run lint:no-orphan-types` + `grep -rn 'generateArtifacts' packages/ integrations/` antes de cerrar S4.
- **Limit del schema Postman V2.1**. Postman espera un único `{{baseUrl}}` por request; el `serverRef` per-operation se materializa en variables por carpeta (`{{baseUrl_<serviceId>}}`) que PostmanExporter emite. Documentado en `ExportCapabilities.schemas: 'partial'`. No es bug; es el techo del formato Postman. Si en el futuro Postman soporta `server.url` por item, el exporter pasa a `schemas: 'full'` sin cambios estructurales.
- **Cobertura de los nuevos transports**. S1 modela los 6 transports como discriminador, pero la implementación completa de cada uno (e.g. GraphQL federation, gRPC bidi-streaming real) queda para propuestas posteriores por transport. La forma del discriminador permite entrada incremental sin re-arquitectura.
