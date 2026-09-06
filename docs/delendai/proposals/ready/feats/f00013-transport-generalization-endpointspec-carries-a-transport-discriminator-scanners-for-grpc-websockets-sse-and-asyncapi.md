---
id: f00013
title: "Transport generalization — EndpointSpec carries a transport discriminator; scanners for gRPC, WebSockets, SSE and AsyncAPI"
kind: feat
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-06
dependsOn:
  - a00018
---

# f00013 — Transport generalization

Hijo de [`a00018`](./a00018-audit-2026-09-06-findings-and-future-slices.md)
§4 (audit §11). Esta propuesta abre el modelo para que Tanit sea
**API Source Discovery** y no solo "REST collection generator".

## Goal

`EndpointSpec` hoy es HTTP-céntrico: cada endpoint es por
construcción una dupla `(method, path)` resuelta por un scanner
de framework (Express, Fastify, Hono, NestJS, FastAPI, Spring,
ASP.NET, Django, Rails, Laravel, Gin, Fiber, Phoenix, Symfony,
Ktor). Ese contrato es correcto **mientras la API habla HTTP**,
pero la auditoría 2026-09-06 §11 detecta cuatro familias de APIs
que hoy Tanit ignora completamente:

1. **gRPC** — el servicio se define en `.proto` y el código
   generado expone `client.SayHello(req)`. No hay `method`
   `path` que scanner.
2. **WebSockets** — `socket.on('event', handler)` /
   `socket.emit('event', payload)`. No hay verbo HTTP, hay
   **event names**.
3. **SSE (Server-Sent Events)** — `text/event-stream` con
   `res.write('data: ...')` periódico. Es HTTP pero el contrato
   semántico es unidireccional server→client.
4. **AsyncAPI** — describe canales pub/sub sobre brokers
   (Kafka, RabbitMQ, NATS, MQTT, WebSocket, etc.). El `.yaml`
   declara channels + operations, no routes.

El objetivo de `f00013` es extender el modelo de datos para que
`EndpointSpec` admita un discriminador `transport`, y entregar
los scanners concretos para gRPC, WebSockets, SSE y AsyncAPI.
**No** rompe los scanners HTTP existentes: HTTP sigue siendo el
caso por defecto y la única ruta afectada cuando `transport` no
está presente.

## Why

Cuatro ejemplos de input que hoy Tanit descarta o reporta como
"0 endpoints" cuando en realidad describen APIs completas.

### gRPC — Protocol Buffers

````protobuf
// greeter.proto
syntax = "proto3";

package helloworld;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloResponse);
  rpc StreamGreetings (HelloRequest) returns (stream HelloResponse);
}

message HelloRequest  { string name = 1; }
message HelloResponse { string message = 1; }
````

Hoy: scanner no existe. Mañana: `transport: "grpc"` con
`{ service: "Greeter", method: "SayHello", requestType:
"HelloRequest", responseType: "HelloResponse", streaming:
"unary" | "server-stream" | "client-stream" | "bidi" }`.

### WebSockets — Socket.IO / `ws` / nativo

````typescript
// chat.ts
io.on('connection', (socket) => {
  socket.on('message',  (payload) => { /* ... */ });
  socket.on('typing',   (payload) => { /* ... */ });
  socket.emit('chat',   { room: 'lobby', text: 'hi' });
  socket.emit('presence', { user: 'u1', status: 'online' });
});
````

Hoy: scanner no existe. Mañana: `transport: "ws"` con
`{ event: "message", direction: "in" | "out", payloadShape:
"inferred" }`.

### SSE — Server-Sent Events

````typescript
// events.ts
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const onTick = () => res.write(`data: ${JSON.stringify(tick)}\n\n`);
  ticker.on('tick', onTick);
  req.on('close', () => ticker.off('tick', onTick));
});
````

Hoy: el scanner de Express/Fastify ve un `GET /events` y lo
emite como HTTP normal — pierde la semántica SSE. Mañana:
`transport: "sse"` con `{ eventName: "tick" | null (default
message), payloadShape: "inferred" }`.

### AsyncAPI — Kafka / RabbitMQ / NATS

````yaml
# asyncapi.yaml
asyncapi: 2.6.0
info:
  title: Orders API
  version: 1.0.0
channels:
  orders/created:
    description: Orders placed by customers
    publish:
      message:
        payload:
          $ref: '#/components/schemas/Order'
    subscribe:
      message:
        payload:
          $ref: '#/components/schemas/OrderCreated'
operations:
  onOrderCreated:
    action: send
    channel:
      $ref: '#/channels/orders~1created'
````

Hoy: scanner no existe. Mañana: `transport: "kafka"` (o el
`protocol` declarado en AsyncAPI: `kafka`, `amqp`, `nats`,
`mqtt`, `ws`, etc.) con `{ channel, operation, action:
"send" | "receive", payloadRef }`.

## Non-goals

- **No romper scanners HTTP existentes.** Todos los Slices deben
  mantener `transport` opcional con default implícito `"http"`,
  y los exporters deben seguir emitiendo Postman / OpenAPI /
  HAR / Bruno / Insomnia / curl sin cambio de comportamiento
  cuando todos los endpoints son HTTP.
- **No traducir gRPC/WS/SSE/AsyncAPI a HTTP en esta propuesta.**
  Esta entrega añade los scanners; la decisión de qué exporters
  los consumen (Postman para WS, AsyncAPI→AsyncAPI, gRPC→gRPC
  reflection) se discute en hijos posteriores
  (`f00014-postman-ws.md`, `f00015-asyncapi-exporter.md`, etc.).
- **No reemplazar el modelo HTTP.** `IEndpoint.{method, path,
  query, headers, body}` siguen siendo los campos canónicos.
  Lo que se añade es un discriminador arriba + un bloque de
  metadata específica del transporte.
- **No inferir tipos de payload cuando no son declarados.**
  gRPC tiene tipos `.proto` (fuente de verdad) — los usamos.
  WebSockets y SSE muchas veces llevan payloads opacos; en ese
  caso emitimos `payloadShape: "unknown"` y listo.
- **No rehacer el LanguageIR.** Esta propuesta consume el
  LanguageIR cuando existe (`r00013`) y cae a regex+balanced-text
  cuando todavía no.

## Modelo

````typescript
// packages/contracts/interfaces/core/transport.interface.ts

export type TransportKind =
  | "http"      // REST / framework HTTP clásico (default)
  | "grpc"      // .proto service + rpc
  | "ws"        // WebSocket event (Socket.IO, ws, nativo)
  | "sse"       // text/event-stream
  | "kafka"     // AsyncAPI broker = kafka
  | "rabbitmq"  // AsyncAPI broker = amqp / rabbitmq
  | "nats"      // AsyncAPI broker = nats
  | "mqtt";     // AsyncAPI broker = mqtt

export interface ITransportMeta {
  /** discriminador canónico — todos los exporters lo leen */
  transport: TransportKind;
  /**
   * Metadata específica del transporte. Estructura libre pero
   * validada por un discriminated union. HTTP no usa este campo
   * (todos sus datos viven en IEndpoint plano).
   */
  meta?: GrpcMeta | WebSocketMeta | SseMeta | AsyncApiMeta;
}

export interface GrpcMeta {
  service: string;
  method: string;
  requestType: string;
  responseType: string;
  streaming: "unary" | "server-stream" | "client-stream" | "bidi";
  protoFile: string;        // ruta relativa al repo
  package?: string;
}

export interface WebSocketMeta {
  event: string;            // nombre del evento (message / typing / chat / ...)
  direction: "in" | "out" | "both";
  namespace?: string;       // Socket.IO namespace si aplica
  payloadShape: "unknown" | "inferred" | string;
}

export interface SseMeta {
  eventName: string | null; // null = mensaje por defecto sin nombre
  payloadShape: "unknown" | "inferred" | string;
}

export interface AsyncApiMeta {
  channel: string;          // orders/created
  operation: string;        // onOrderCreated
  action: "send" | "receive";
  payloadRef: string | null;
  protocol: "kafka" | "rabbitmq" | "nats" | "mqtt" | "ws" | "amqp";
}
````

Extensión mínima sobre el contrato actual de `IEndpoint`:

````typescript
// packages/contracts/interfaces/core/endpoint.interface.ts
export interface IEndpoint {
  // ... campos existentes (method, path, query, headers, body, ...)
  transport?: TransportKind; // default "http" cuando ausente
  transportMeta?: GrpcMeta | WebSocketMeta | SseMeta | AsyncApiMeta;
}
````

## Slices

### S1 — Foundation: type + discriminator + exporter no-op

| campo        | valor                                          |
| ------------ | ---------------------------------------------- |
| **id**       | `f00013.s1`                                    |
| **title**    | Type extension + base interface                |
| **files**    | `packages/contracts/interfaces/core/transport.interface.ts` (nuevo) |
|              | `packages/contracts/interfaces/core/endpoint.interface.ts` (edita, +2 campos) |
|              | `packages/contracts/interfaces/core/index.ts` (barrel export) |
|              | `packages/core/src/exporters/postman.ts` (early-return cuando `transport !== "http"`) |
|              | `packages/core/src/exporters/openapi.ts` (early-return) |
|              | `packages/core/src/exporters/har.ts` (early-return) |
|              | `packages/core/src/exporters/bruno.ts` (early-return) |
|              | `packages/core/src/exporters/insomnia.ts` (early-return) |
|              | `packages/core/src/exporters/curl.ts` (early-return) |
|              | `tests/contracts/core/transport.spec.ts` (nuevo) |
| **gate**     | type + lint + unit                            |
| **dependsOn**| —                                              |
| **acceptance** | (1) `TransportKind` exportado y exportable; (2) `IEndpoint.transport` opcional con default `"http"`; (3) exportadores HTTP ignoran `transport !== "http"` con warning estructurado (`logger.warn({transport, id}, "skipped non-http")`); (4) fixture HTTP existente sigue verde end-to-end. |

**Detalle.** El early-return en los exporters es lo que
permite que el resto de slices aterricen **sin** una decisión de
producto sobre qué exporter recibe cada transporte. El log
estructurado deja la puerta abierta a `f00014+` para que cada
exporter decida: o implementa la serialización, o sigue
ignorando. Esta propuesta solo garantiza el camino seguro.

### S2 — gRPC scanner

| campo        | valor                                          |
| ------------ | ---------------------------------------------- |
| **id**       | `f00013.s2`                                    |
| **title**    | gRPC scanner (lee `.proto`, emite `transport: "grpc"`) |
| **files**    | `packages/core/src/scanners/grpc/scanner.ts` (nuevo) |
|              | `packages/core/src/scanners/grpc/parser.ts` (nuevo — usa `protobufjs` ya en deps transitivas o `google-protobuf`) |
|              | `packages/core/src/scanners/grpc/index.ts` (barrel) |
|              | `packages/core/src/scanners/registry.ts` (registra scanner cuando hay `.proto` en el repo) |
|              | `tests/core/scanners/grpc/scanner.spec.ts` (nuevo) |
|              | `tests/fixtures/grpc/greeter.proto` (nuevo fixture) |
| **gate**     | type + lint + unit + smoke (`tests/smoke-fixtures/grpc/`) |
| **dependsOn**| S1                                             |
| **acceptance** | (1) `service Greeter { rpc SayHello(...) returns (...); }` → 1 endpoint con `transport: "grpc"`, `meta.service="Greeter"`, `meta.method="SayHello"`, `meta.requestType="HelloRequest"`, `meta.responseType="HelloResponse"`, `meta.streaming="unary"`; (2) variante `stream` se mapea a `"server-stream"`; (3) paquete `package helloworld;` se refleja en `meta.package`; (4) `postman --target ./tests/fixtures/grpc/` emite comentario `transport: grpc — not exported to this format` y 0 entradas; (5) OpenAPI emite path stub `/grpc/greeter/SayHello` con `x-tanit-transport: grpc` para no perder la información. |

**Detalle.** Se usa `protobufjs` (zero-config, sin code-gen)
para parsear el `.proto`. Solo se emite el endpoint para los
`rpc` que tienen signature completa (request + response types).
`option deprecated = true;` se respeta y se omite. RPCs sin
request/response type (ej. `rpc Ping(google.protobuf.Empty)`)
sí se emiten — `Empty` se reconoce por nombre canónico.

### S3 — WebSocket scanner

| campo        | valor                                          |
| ------------ | ---------------------------------------------- |
| **id**       | `f00013.s3`                                    |
| **title**    | WebSocket scanner (`socket.on/emit`, emite `transport: "ws"`) |
| **files**    | `packages/core/src/scanners/websocket/scanner.ts` (nuevo) |
|              | `packages/core/src/scanners/websocket/extract.ts` (nuevo — regex+AST-light sobre `socket.on("...")` y `socket.emit("...", ...)`) |
|              | `packages/core/src/scanners/websocket/index.ts` (barrel) |
|              | `packages/core/src/scanners/registry.ts` (registra) |
|              | `tests/core/scanners/websocket/scanner.spec.ts` (nuevo) |
|              | `tests/fixtures/ws/chat.ts` (nuevo fixture) |
| **gate**     | type + lint + unit + smoke                     |
| **dependsOn**| S1                                             |
| **acceptance** | (1) `socket.on('message', h)` → endpoint `transport: "ws"`, `meta.event="message"`, `meta.direction="in"`; (2) `socket.emit('chat', payload)` → endpoint `transport: "ws"`, `meta.event="chat"`, `meta.direction="out"`; (3) Socket.IO namespace `io.of('/admin')` → `meta.namespace="/admin"`; (4) Postman exporter emite comentario `transport: ws — not exported to this format` y 0 entradas; (5) fixtures `tests/fixtures/ws/` ≥ 3 escenarios (Socket.IO, `ws`, nativo). |

### S4 — SSE scanner

| campo        | valor                                          |
| ------------ | ---------------------------------------------- |
| **id**       | `f00013.s4`                                    |
| **title**    | SSE scanner (`text/event-stream` → `transport: "sse"`) |
| **files**    | `packages/core/src/scanners/sse/scanner.ts` (nuevo — reutiliza scanner de Express/Fastify, **especializa** el endpoint cuando el handler setea `Content-Type: text/event-stream`) |
|              | `packages/core/src/scanners/sse/event-extract.ts` (nuevo — `res.write(\`event: ${name}\\n\`)` o `eventEmitter.emit(name, ...)`) |
|              | `packages/core/src/scanners/sse/index.ts` (barrel) |
|              | `packages/core/src/scanners/registry.ts` (registra cuando Express/Fastify ya detectaron el route) |
|              | `tests/core/scanners/sse/scanner.spec.ts` (nuevo) |
|              | `tests/fixtures/sse/events.ts` (nuevo fixture) |
| **gate**     | type + lint + unit + smoke                     |
| **dependsOn**| S1, S2 (S2 ya establece el patrón post-S1)      |
| **acceptance** | (1) `app.get('/events', handler)` + `res.setHeader('Content-Type', 'text/event-stream')` → endpoint **transforma** `transport: "http"` a `transport: "sse"` en lugar de duplicar; (2) `event: tick\\n` en el handler → `meta.eventName="tick"`; (3) `data: ...` sin `event:` → `meta.eventName=null`; (4) Postman exporter emite comentario y 0 entradas; (5) tests cubren variantes Express y Fastify. |

**Detalle.** A diferencia de S2 y S3, SSE **es** HTTP. El
scanner no es standalone: toma como input el `IEndpoint` que
el scanner HTTP ya detectó y lo **especializa**. Esto evita el
duplicado (un endpoint HTTP que también es SSE) y mantiene el
contrato del registry simple (un solo scanner produce el
endpoint; el segundo lo anota).

### S5 — AsyncAPI scanner

| campo        | valor                                          |
| ------------ | ---------------------------------------------- |
| **id**       | `f00013.s5`                                    |
| **title**    | AsyncAPI scanner (`asyncapi.yaml/.json` → `transport: "kafka"`/`"rabbitmq"`/`"nats"`/`"mqtt"`) |
| **files**    | `packages/core/src/scanners/asyncapi/scanner.ts` (nuevo) |
|              | `packages/core/src/scanners/asyncapi/parser.ts` (nuevo — `@asyncapi/parser` ya en deps transitivas vía `examples/`) |
|              | `packages/core/src/scanners/asyncapi/version.ts` (nuevo — soporta 2.x y 3.x) |
|              | `packages/core/src/scanners/asyncapi/index.ts` (barrel) |
|              | `packages/core/src/scanners/registry.ts` (registra cuando `asyncapi.{yaml,json}` existe) |
|              | `tests/core/scanners/asyncapi/scanner.spec.ts` (nuevo) |
|              | `tests/fixtures/asyncapi/orders.yaml` (nuevo fixture, AsyncAPI 2.6) |
|              | `tests/fixtures/asyncapi/orders.v3.yaml` (nuevo fixture, AsyncAPI 3.0) |
| **gate**     | type + lint + unit + smoke                     |
| **dependsOn**| S1                                             |
| **acceptance** | (1) `asyncapi.yaml` con `servers.prod.protocol: kafka` y un channel `orders/created` con `publish` + `subscribe` → 2 endpoints, uno con `transport: "kafka"` y `meta.action: "send"`, otro con `meta.action: "receive"`; (2) `$ref: '#/components/schemas/Order'` → `meta.payloadRef="#/components/schemas/Order"`; (3) protocolo `amqp` mapea a `"rabbitmq"`, `mqtt` a `"mqtt"`, `nats` a `"nats"`; (4) AsyncAPI 3.0 con `channels.<name>.address` se soporta; (5) Postman/OpenAPI exporters emiten comentario y 0 entradas; (6) tests cubren los 4 brokers principales. |

## Acceptance global

- `pnpm -w typecheck` verde en `develop` con los nuevos tipos.
- `pnpm -w lint` 0 violations.
- `pnpm --filter @api-source-tanit/core test` verde con los
  nuevos specs (5 nuevos test files, ≥ 30 tests nuevos
  acumulados entre S1-S5).
- Smoke fixtures `grpc/`, `ws/`, `sse/`, `asyncapi/` corren
  end-to-end y confirman el comportamiento "transport: X —
  not exported to this format" en todos los exporters HTTP.
- `INDEX.md` regenerado (script `scripts/proposals/build-index.ts`)
  incluye `f00013` con sus 5 slices.
- Ningún test preexistente modificado excepto donde la
  generalización exige añadir el campo `transport: "http"`
  explícito (en tal caso se cambia en un commit de mecánica
  pura con `pnpm -w codemod:transport-default` que la propuesta
  define en S1).

## Risks

- **Scope creep.** Esta propuesta abre un boquete enorme: cuatro
  familias de transporte, cada una con sus particularidades
  (proto2 vs proto3, AsyncAPI 2 vs 3, Socket.IO namespaces,
  `Last-Event-ID` en SSE, etc.). **Mitigation**: S1 + S2 son el
  camino mínimo para validar el modelo. S3-S5 solo se abordan
  si S1+S2 cierran limpios y la foundation se demuestra
  extensible. Si en S2 aparecen fricciones (ej. el discriminated
  union de `meta` no cubre algo), se **pausa** la propuesta y
  se reabre el diseño antes de empezar S3.
- **Inferencia de payloads opacos.** WebSockets y SSE suelen
  emitir payloads sin tipo. Forzar inferencia aquí abriría la
  puerta a falsos positivos. **Mitigation**: `payloadShape:
  "unknown"` por defecto; inferencia opcional y opt-in por
  scanner.
- **AsyncAPI ecosystem.** AsyncAPI 3.0 introdujo cambios
  importantes (`channels` con `address` separado de `messages`,
  `operations` con `action: send|receive`). **Mitigation**: S5
  testea explícitamente ambas versiones. Si la 3.0 añade
  variantes que la 2.6 no cubre, se cierra S5 con 2.6
  solamente y la 3.0 queda para `f00013.5+`.
- **Exports.** No decidimos en esta propuesta qué exporters
  consumen cada transporte. Eso es trabajo de `f00014+`. Esta
  propuesta solo garantiza el camino seguro (HTTP sigue
  intacto) y deja el hook de transporte documentado.
- **Naming collision con proposal padre.** El padre `a00018`
  lista `f00013` como "pendiente de autoría". Esta propuesta
  **es** esa autoría. No hay conflicto — solo se materializa el
  puntero.

## Out of scope (futuros hijos)

- `f00014` — Postman exporter con soporte nativo para WebSocket
  (colección `.postman_collection` v2.1 tiene un bloque
  `protocolProfileBehavior` para WS).
- `f00015` — AsyncAPI→AsyncAPI exporter (round-trip: Tanit lee
  un `.yaml`, lo enriquece y lo reemite validado).
- `f00016` — gRPC reflection exporter (`grpcurl` style).
- `f00017` — CLI flag `--transport-filter grpc,ws` para emitir
  colecciones homogéneas de un solo transporte.

Estos no se planean en este archivo; se reservan los ids para
que `a00018` y el `INDEX.md` puedan referenciarlos cuando se
autoricen.
