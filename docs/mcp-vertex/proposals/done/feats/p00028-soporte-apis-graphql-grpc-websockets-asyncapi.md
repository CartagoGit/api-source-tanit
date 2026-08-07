---
id: p00028
title: "p00028 — soporte de protocolos avanzados: GraphQL, gRPC, WebSockets y tRPC"
kind: feat
status: done
type: proposal
track: export-to-postman
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

> **Cerrada el 2026-08-07.** Dos de los cuatro protocolos se
> implementan enteros (GraphQL y tRPC) y dos **no**, con motivo. El
> criterio para separarlos está abajo.

## el criterio: ¿la request se puede lanzar?

Este proyecto entrega una colección de Postman. Una request que no se
puede mandar no es documentación: es una trampa, porque quien la importa
le da a Send y recibe un error que parece de su API.

| Protocolo | ¿Traducción exacta a HTTP? | Decisión |
| --- | --- | --- |
| **GraphQL** | Sí: `POST /graphql` con la consulta en el cuerpo | **Hecho** |
| **tRPC** | Sí: `query` → `GET /trpc/x.y`, `mutation` → `POST` | **Hecho** |
| **gRPC** | No. Es HTTP/2 con Protobuf binario; una colección v2.1.0 no lo representa | No se hace |
| **WebSocket** | No. Postman los soporta, pero **no** en el esquema v2.1.0 de colección | No se hace |

Emitir un método gRPC como un `POST` a la URL del servicio produciría una
request que falla siempre. Y un `GET ws://…` no es una petición HTTP: es
otro protocolo con el mismo prefijo.

Las **suscripciones** de GraphQL y tRPC se descartan por lo mismo, y esas
sí que tentaban: están en el esquema, al lado de las queries, y meterlas
habría sido gratis. Van por WebSocket.

## no-objetivos

- Ejecutar los servidores en tiempo de análisis (el análisis sigue siendo 100% estático).
- Simular conexiones de red gRPC/WebSocket durante la fase de escaneo.

## slices

### S1 — Scanner de GraphQL
- **Estado**: done (2026-08-07)
- **Ficheros**: `projects/frameworks/scanners/graphql.scanner.ts`,
  `tests/frameworks/graphql-trpc.spec.ts`, `examples/example-graphql/`.

Lo que hace útil la colección no es el endpoint —ese lo sabe cualquiera—
es **la consulta escrita**. Los argumentos van como variables de GraphQL
y no incrustados en el texto: así se cambian desde el panel de Postman
sin editar la consulta, y un `String!` no acaba sin comillas.

Un detalle que parece menor y no lo es: un objeto necesita selección de
campos y un escalar **no la admite**. Ponerle `{ __typename }` a un
`String!` produce una consulta inválida, así que hay que distinguirlos —
y los escalares de serie empiezan por mayúscula igual que los objetos.

### ~~S1 original~~
- **Files**: `services/scanners/graphql.scanner.ts`, `helpers/graphql-schema.helper.ts`.
- **Gate**: `bun test tests/frameworks/graphql-scanner.spec.ts`.
- Escanea esquemas `.graphql` y extrae consultas (`queries`), mutaciones (`mutations`) y suscripciones (`subscriptions`), construyendo las peticiones POST a `/graphql` en Postman con la query GraphQL formateada.

### S2 y S3 — gRPC y WebSockets: no se hacen
- **Estado**: retiradas con motivo. Ver el criterio de arriba.

### ~~S2 original — gRPC~~
- **Files**: `services/scanners/grpc.scanner.ts`, `helpers/proto-parser.helper.ts`.
- **Gate**: `bun test tests/frameworks/grpc-scanner.spec.ts`.
- Escanea archivos `.proto` y genera la estructura de paquetes gRPC en la colección Postman v2.1.0.

### S3 — Scanner de WebSockets y Server-Sent Events (SSE)
- **Files**: `services/scanners/websocket.scanner.ts`.
- **Gate**: `bun test tests/frameworks/websocket-scanner.spec.ts`.
- Escanea decoradores de WebSockets (`@WebSocketGateway`, `ws.on`, `io.on`) y rutas de Server-Sent Events (`res.setHeader('Content-Type', 'text/event-stream')`).

### S4 — Scanner de tRPC
- **Estado**: done (2026-08-07)
- **Ficheros**: `projects/frameworks/scanners/trpc.scanner.ts`,
  `examples/example-trpc/`.

tRPC es el que más valor tiene de los cuatro, y por un motivo que no está
en la propuesta: desde el cliente se llama como si fueran funciones, así
que **casi nadie sabe qué URL está llamando**. La colección lo dice.

Lo difícil no era el `query`/`mutation`, era el árbol: casi nadie escribe
todo en una expresión, lo normal es `const usersRouter = t.router({…})` y
luego `t.router({ users: usersRouter })`. Sin resolver esa referencia los
procedimientos salen sin prefijo —`list` en vez de `users.list`— y encima
el `list` de un router pisa al del otro.

Y una raíz no es "el router sin nombre": `appRouter` también tiene uno. Es
el que **nadie referencia**.

### ~~S4 original~~
- **Files**: `services/scanners/trpc.scanner.ts`.
- **Gate**: `bun test tests/frameworks/trpc-scanner.spec.ts`.
- Analiza `appRouter` de tRPC para mapear consultas `t.procedure.query` a GET y `t.procedure.mutation` a POST.

## el bug de fondo que destapó

GraphQL tiene **un** endpoint, así que sus veinte operaciones son veinte
`POST /graphql`. El pipeline deduplicaba por método + URI, de modo que un
esquema entero producía **una** request. Y el chequeo de invariantes
avisaba de las otras cuatro como "duplicadas".

Las dos cosas estaban escritas para REST, donde la URL identifica la
operación. Ahora la clave incluye el nombre —y el cuerpo, en el caso del
invariante—, que es lo correcto para cualquier RPC sobre POST y no solo
para GraphQL.

## aceptación

- Esquemas GraphQL detectados, con una request por operación y la
  consulta lista para mandar. ✔ 5 en el ejemplo.
- tRPC detectado, con la ruta anidada correcta y el verbo que le toca a
  cada procedimiento. ✔ 6 en el ejemplo.
- ~~Servicios `.proto` y WebSockets~~ → no se emiten, por el criterio de
  arriba.
- `bun run validate` verde. ✔ 1853 tests, **21/21 ejemplos**.
