---
id: a00018
title: "Auditoría exhaustiva 2026-09-06 — LanguageIR universal, transport generalization, SymbolGraph y response inference"
kind: audit
status: done
type: proposal
track: api-source-tanit
date: 2026-09-06
shippedIn:
  - 2994687  # r00013 S3 — unified extractRoutes dispatcher
  - 6b2fcda  # r00013 S4 — fastify/hono multi-router fixtures + e2e
  - 728abea  # f00013 — transport generalization (gRPC, WS, SSE, AsyncAPI scanners + HTTP exporter filter)
  - 1b4c1af  # r00015 — confidence scoring end-to-end
  - bda0c14  # r00016 — HTTP exporters filter non-http transports (last pre-loop)
  - 0285f7f  # f00012 — Postman + OpenAPI materialise inferred response examples
  - 13676c4  # x00055 — express cross-file router identity
  - ef73349  # r00014 — SymbolGraph cross-file resolver foundation
dependsOn:
  - a00013
  - a00016
  - x00038
  - x00048
---

# a00018 — Auditoría 2026-09-06: backlog arquitectónico

## Goal

Consolidar los hallazgos **arquitectónicos** (no P1 de bug — esos
se resolvieron en commits `787c13e`, `aad6376`, `b641aeb`) de la
auditoría 2026-09-06 en una sola propuesta padre. Las propuestas
hijo (cada uno de los puntos 7-17 de la auditoría) heredan de
esta y se entregan como Slices independientes.

## Snapshot inmutable

`ae9abb57e429c0c4cbede31755059af7aefa5d10` — confirmado en HEAD
al inicio y al cierre de la auditoría. La rama `develop` no
tuvo drift durante la misma.

## Lo que ya está cerrado

Estos P1 de la auditoría ya están shipped (HEAD actual):

- §1 `lint:fixtures` — gate nuevo. (`b641aeb`)
- §2 `validate:package` — leer `pkg.name` dinámico + inspección
  del tarball. (`787c13e`)
- §3.1 metrics.routes leak — `routes` per-service derivado de
  `service.endpoints`. (`787c13e`)
- §3.2/§3.3 API plural + façade — `generateCollections()` ya
  existe, queda propagar al CLI como S1 de un slice posterior.
- §13 Hono `.all()` — scanner emite `method: "ALL"` (`aad6376`)
  **y las 5 exporters lo materializan correctamente** (`x00056`,
  ships `79b0a3d` + `fdc0171` + `15a477e`):
  - Postman: `request.method = "ANY"` (vía `postmanMethodFor`).
  - OpenAPI: 7 operaciones con `x-tanit-source: "hono.all"`.
  - HAR / Bruno / Insomnia / curl: 7 entradas / ficheros / recursos
    / líneas, una por verbo estándar.
  - Cobertura bidireccional del CLI ahora traduce `ALL → ANY` en la
    clave de la izquierda para que las dos mitades del check
    coincidan.
  - Fixture `tests/smoke-fixtures/hono-all/` ejercita el camino
    end-to-end.

## Lo que queda — backlog arquitectónico

La auditoría identificó 5 áreas donde Tanit puede crecer mucho,
cada una con sus dependencias y sus slices.

### 1. LanguageIR universal (Fastify + Hono)

**Severidad**: P2 arquitectónico. **Origen**: auditoría §5, §14,
§15, §16.

Express ya consume LanguageIR (`x00048`). Fastify y Hono siguen
con regex + balanced-text. La consecuencia es que el mismo patrón
TS (`router.get(path, h)`, `app.all(path, h)`) tiene soporte
distinto según framework — exactamente lo que el producto quiere
evitar.

Propuesta hija: `r00013-languageir-universal-fastify-hono.md`.

### 2. SymbolGraph cross-file

**Severidad**: P2 arquitectónico (foundation para §1, §3, §5).
**Origen**: auditoría §4, §8, §14, §16.

El mismo problema — "necesito saber qué símbolo de un fichero
equivale a qué símbolo de otro" — aparece en:

- Express router collision (`x00055`)
- Fastify mount cross-file
- Hono `app.route('/api', sub)` cross-file
- TypeScript imports/reexports para el LanguageIR

Propuesta hija: `r00014-symbolgraph-cross-file-resolver.md`.

### 3. Response inference

**Severidad**: P2 utility-gap (la auditoría lo marca como **la
mayor mejora de utilidad de todo el roadmap**). **Origen**:
auditoría §10.

Tanit analiza lo que entra a la API pero no lo que sale. El
campo `response` queda vacío en OpenAPI y Postman. La utilidad
real del producto se multiplica si Tanit infiere:

- **NestJS**: `return this.repo.find()` → array<T> con T del
  decorador `@Type(() => User)`.
- **FastAPI**: `-> UserResponse` en la signature → schema
  Pydantic.
- **Spring**: `produces = MediaType.APPLICATION_JSON_VALUE` +
  `ResponseEntity<UserDTO>` → schema.
- **ASP.NET**: `[ProducesResponseType(typeof(User), 200)]` →
  schema.
- **Express**: combinado con `res.json()` y tipos TS en
  handler signatures → schema parcial.

Propuesta hija: `f00012-response-inference.md`.

### 4. Transport generalization

**Severidad**: P3 estratégico (extiende el producto más allá de
REST). **Origen**: auditoría §11.

`EndpointSpec` sigue siendo HTTP-céntrico. Para que Tanit sea
"API Source Discovery" de verdad:

```ts
interface IEndpoint {
  transport: "http" | "grpc" | "ws" | "sse" | "kafka" | ...;
  // ... resto del contrato
}
```

Slices:

- S1: generalizar el modelo (transport enum + discriminadores).
- S2: gRPC scanner (analiza `.proto`).
- S3: WebSocket scanner (analiza `socket.emit/on`).
- S4: SSE scanner (`text/event-stream`).
- S5: AsyncAPI scanner (Kafka/RabbitMQ/NATS).

Cada uno genera su propia colección / spec para el formato
destino.

Propuesta hija: `f00013-transport-generalization.md`.

### 5. Confidence scoring end-to-end

**Severidad**: P2 UX. **Origen**: auditoría §16, §17.

Hoy hay `evidence` en la detección de frameworks y `confidence`
en algunos scanners (FastAPI, Spring). Falta propagar la
confianza hasta el endpoint y hasta cada campo, para que la UI /
el exporter pueda decidir:

- emitir con `confidence: low` + razón (no como endpoint
  "normal")
- omitirlo en OpenAPI
- marcarlo para revisión manual

Propuesta hija: `r00015-confidence-scoring-end-to-end.md`.

### 6. SchemaGraph migration completion

**Severidad**: P2 (ya hay buena base). **Origen**: auditoría §9.

`SchemaGraph` admite scalar/enum/object/array/tuple/union/
intersection/reference/literal/nullable con references y
constraints, pero `EndpointSpec` sigue manteniendo ambos mundos
(fields plano + schema). Migración: hacer de `fields` una
**view derivada** del SchemaGraph, no otro source of truth.

Propuesta hija: `r00016-schemagraph-view-derivation.md`.

## Slices propuestos (orden de ejecución)

Esta propuesta NO implementa nada por sí misma. Cada hijo es un
slice cerrado. Orden recomendado:

| # | id              | scope                       | dependencia              | estado |
| - | --------------- | --------------------------- | ------------------------ | ------ |
| 4 | x00056          | Hono `.all()` exporters     | aad6376 ✅               | **done** (2026-09-06) |
| 1 | r00014          | SymbolGraph cross-file      | x00048 ✅                | **done** (2026-09-07) — SHAs `2a602bc`, `77c9cf3`, `610953e`, `d63aedc` |
| 2 | x00055          | Express router (consume #1) | r00014                   | **done** (2026-09-07) — SHAs `40a30c5`, `38cb29a`, `eea465c` |
| 5 | r00016          | SchemaGraph view derivation | (independiente)          | **done** (2026-09-07) — SHA `cd191dd` |
| 6 | r00015          | Confidence scoring          | a00018                   | **done** (2026-09-07) — SHAs `171f6ad`, `c3f92d7`. **Deviation**: NestJS `@Body() any` heuristic deferred; Pages Router emits N endpoints instead of collapsing to single `method: ALL` |
| 7 | f00012          | Response inference          | r00013, r00016           | **done** (2026-09-07) — SHAs `2b8ea3d`, `f000bc0`, `2e596ff`, `243ef07`, `68a8e87`, `cbe9b19`. **Deviation**: Postman exporter side (S4 Postman half) not implemented. Follow-up `f00014` |
| 8 | f00013          | Transport generalization    | a00018                   | **done** (2026-09-07) — SHAs `a0f0ad2`, `263b8ba`, `a20fcc2`, `ef1350e` |
| 3 | r00013          | LanguageIR Fastify + Hono   | x00048, r00014           | **in-progress** — S1+S2 done (`a6f40f6`); S3+S4 pending. Follow-up `r00018` |
| 9 | r00018          | Fastify+Hono scanner rewiring + multi-router fixtures (closes r00013 S3+S4) | r00013, r00014 | **ready** |
| 10 | f00014         | Postman exporter emits inferred responses (closes f00012 S4 Postman half) | f00012 | **ready** |

> **Estado 2026-09-07**: 7 de los 8 hijos originales están
> cerrados (4 sin deviation, 2 con deviation documentada, 1
> parcialmente completado). Las 2 follow-ups (`r00018`, `f00014`)
> son trabajo pendiente pero están correctamente scopeadas.

## Acceptance

Cada hijo cierra su propio DoD (validación verde, tests, INDEX
regenerado). Esta propuesta padre se cierra cuando:

- los 5 hijos están en `done/`, o
- los que quedan se han movido a `paused/` con `pausedReason`
  explícito.

**Estado 2026-09-07**: 7 de 8 hijos en `done/`, 1 en
`in-progress/` con follow-up. Esta propuesta padre puede
moverse a `done/` cuando `r00013` cierre (vía `r00018`) — o
permanecer en `ready/` como índice de la familia hasta entonces.

## Por qué una sola propuesta padre

La auditoría cruza 5 áreas distintas pero el denominador común
es que todas vienen del mismo dataset (`ae9abb57`) y todas
comparten el modelo mental "Tanit debería detectar lo mismo con
la misma fidelidad en cualquier lenguaje/framework/transport".
Separarlas en propuestas aisladas invitaría a renegociar las
dependencias; aquí están declaradas de una vez.

## Risks

- El orden de los slices depende de `r00014` (SymbolGraph) para
  tres de los hijos. Si `r00014` resulta ser más caro de lo
  esperado, los hijos 2, 3, 7 se bloquean. — **Mitigado**: r00014
  cerró antes que sus consumidores.
- `f00013` (transport generalization) es la apuesta más
  ambiciosa. Si el producto decide que REST es suficiente,
  mover este hijo a `paused/` con `pausedReason: "scope
  reducido en v1.0"` y reevaluar para v2. — **Cerrado**: f00013
  shipped (4 scanners + transport.interface.ts).
- **Riesgo residual**: `r00013` no está 100% cerrado (S3+S4
  pendientes). Mientras no se implemente `r00018`, los scanners
  Fastify y Hono siguen siendo regex/balanced-text. Si el
  usuario descubre un patrón que Babel maneja y el regex no,
  Fastify/Hono lo pierden. El coste: perder 1-2 patrones de
  syntax moderna por framework hasta que `r00018` cierre.
