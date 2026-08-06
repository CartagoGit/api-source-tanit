---
id: p00028
title: "p00028 — soporte de protocolos avanzados: GraphQL, gRPC, WebSockets y tRPC"
kind: feat
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00024
---

# p00028 — soporte de protocolos avanzados: GraphQL, gRPC, WebSockets y tRPC

## Goal

Ampliar la cobertura del escáner agnóstico `export-to-postman` más allá de las APIs REST tradicionales, permitiendo detectar e importar esquemas de GraphQL, contratos de gRPC (`.proto`), salas de WebSockets/SSE y procedimientos remotos tRPC dentro del formato Postman v2.1.0.

## why

Las aplicaciones web modernas raramente son 100% REST. Un porcentaje significativo de arquitecturas enterprise combina:
1. **GraphQL**: Escaneo de archivos `.graphql` / `.gql` y resolvers de Apollo / Yoga / NestJS GraphQL.
2. **gRPC / Protocol Buffers**: Escaneo de archivos `.proto` y definición de servicios gRPC.
3. **WebSockets / SSE / AsyncAPI**: Escaneo de endpoints con `ws://`, `wss://` o suscripciones EventSource.
4. **tRPC**: Escaneo de `appRouter` en TypeScript para inferir llamadas a procedimientos `query` y `mutation`.

Soportar estos protocolos elevará el proyecto a un nivel **11 de 10** de cobertura de APIs en el ecosistema.

## non-goals

- Ejecutar los servidores en tiempo de análisis (el análisis sigue siendo 100% estático).
- Simular conexiones de red gRPC/WebSocket durante la fase de escaneo.

## slices

### S1 — Scanner de GraphQL (Schema & Resolvers)
- **Files**: `services/scanners/graphql.scanner.ts`, `helpers/graphql-schema.helper.ts`.
- **Gate**: `bun test tests/frameworks/graphql-scanner.spec.ts`.
- Escanea esquemas `.graphql` y extrae consultas (`queries`), mutaciones (`mutations`) y suscripciones (`subscriptions`), construyendo las peticiones POST a `/graphql` en Postman con la query GraphQL formateada.

### S2 — Scanner de gRPC (Proto Definitions)
- **Files**: `services/scanners/grpc.scanner.ts`, `helpers/proto-parser.helper.ts`.
- **Gate**: `bun test tests/frameworks/grpc-scanner.spec.ts`.
- Escanea archivos `.proto` y genera la estructura de paquetes gRPC en la colección Postman v2.1.0.

### S3 — Scanner de WebSockets y Server-Sent Events (SSE)
- **Files**: `services/scanners/websocket.scanner.ts`.
- **Gate**: `bun test tests/frameworks/websocket-scanner.spec.ts`.
- Escanea decoradores de WebSockets (`@WebSocketGateway`, `ws.on`, `io.on`) y rutas de Server-Sent Events (`res.setHeader('Content-Type', 'text/event-stream')`).

### S4 — Scanner de tRPC
- **Files**: `services/scanners/trpc.scanner.ts`.
- **Gate**: `bun test tests/frameworks/trpc-scanner.spec.ts`.
- Analiza `appRouter` de tRPC para mapear consultas `t.procedure.query` a GET y `t.procedure.mutation` a POST.

## acceptance

- Detección de esquemas GraphQL y generación de queries de ejemplo en la colección.
- Detección de servicios `.proto` y endpoints de WebSockets/tRPC.
- Pruebas integradas verdes en `bun run validate`.
