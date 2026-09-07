---
id: r00019
title: "Universal API Model v2 — OperationId universal, per-operation serverRef/authRef, Postman como exporter más"
kind: refactor
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
---

# r00019 — Universal API Model v2 — OperationId universal, per-operation serverRef/authRef, Postman como exporter más

## Goal

Desacoplar Tanit del modelo Postman-centric. Hoy `EndpointSpec` vive en `packages/contracts/interfaces/core/postman.interface.ts`, `generation.pipeline.ts` describe `projectRoot → PostmanCollection`, `TransportKind` acepta `| string` con opcionales absurdos, y `combineServices` hereda `baseUrl`/`auth`/`variables` del primer servicio. El objetivo: (1) `TransportKind` se convierte en discriminated union con campos requeridos por rama (`HttpTransport { method, path }`, `GraphQlTransport { operationType, operationName }`, `GrpcTransport { service, rpc, streaming }`, `WebSocketTransport { event, direction, namespace }`, `SseTransport { event, streamPath }`, `MessageBrokerTransport { broker, channel, direction }`); (2) `OperationId` es función pura universal por transport; (3) `Operation` lleva `serverRef`, `authRef`, `transport`, `provenance` per-instance (los cuatro discriminados en la rama HTTP, presentes vía contexto en otras); (4) `combineServices` genera `{{baseUrl_<serviceId>}}` por servicio; (5) `PostmanExporter` implementa `IExporter` igual que OpenAPI/Bruno/HAR — un exporter más, no el centro; (6) `generation.pipeline.ts` termina en `buildArtifacts(snapshot, exporters)` declarativo. Cierra los hallazgos §3.2, §3.3, §3.4 de [a00019](./a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo señala tres síntomas de acoplamiento: (a) `EndpointSpec` requiere `method` y `uri` incluso cuando conceptualmente se representa otra cosa (un `GrpcTransport` con `service` + `rpc` no debería tener `method: "POST"` por defecto); (b) `combineServices({ services: [users:OAuth+https://users.example.com, orders:APIKey+https://orders.example.com] })` produce una colección combinada donde todas las operaciones heredan el `baseUrl` y `auth` del primer servicio — el audit confirma que el propio `generation.pipeline.ts` reconoce este comportamiento y que el bug de monorepo real (users+orders con auths distintos) sigue abierto; (c) Postman se genera por un camino distinto al de OpenAPI/Bruno/HAR/Insomnia/cURL (los últimos van por el registry de exporters declarativo). Mientras el modelo siga Postman-centric, los exporters no pueden ser ciudadanos de primera, los transports no pueden ser discriminated (los `opcionales` los dejan en un estado malformado legal), y combinar servicios en un monorepo real sigue siendo unsafe.

## non-goals

- Reescribir los scanners para que devuelvan directamente discriminated unions — los scanners siguen devolviendo `ParsedRoute[]` neutro; la discriminated narrow ocurre en la capa de transport-detection al cruzar al modelo universal.
- Migrar todos los exporters a la vez — solo PostmanExporter cambia en esta propuesta; los demás (OpenAPI/Bruno/HAR/Insomnia/cURL) ya son exporters puros y siguen funcionando.
- Añadir nuevos transports (e.g. GraphQL federation, gRPC bidi-streaming) — se modela el discriminador para que entren sin cambios arquitectónicos, pero la implementación completa de cada transport es trabajo posterior por transport.
- Cambiar el comportamiento de los flags del CLI — los flags actuales (`--combine-services`, `--output`, etc.) se preservan; solo cambia la capa interna que los consume.
- Tocar `f00013` (transport generalization actual) — sus 6 transports viven como union actual; aquí se elevan a discriminated unions, pero los scanners siguen emitiendo el union neutral.

## Slices

- global_gate: e2e

### S1-transport-discriminated-unions — S1 — TransportKind como discriminated union + OperationId universal + IOperation shape
- **Status**: pending
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
