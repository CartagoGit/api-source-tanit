---
id: f00014
title: "Postman exporter emits inferred responses — closes f00012 S4 Postman half"
kind: feat
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - f00012
---

# f00014 — Postman exporter emite `response[]` desde `EndpointSpec.responses`

## Goal

Que la colección Postman generada por Tanit incluya un array
`response[]` con un `example` derivado del schema inferido,
cerrando la mitad pendiente del slice S4 de [`f00012`](./f00012-response-inference-infer-request-response-schemas-from-handlers-signatures-decorators-and-explicit-annotations.md).

## Why (audit 2026-09-06 §10, f00012 S4 acceptance)

`f00012` se cerró con una deviation explícita: el lado OpenAPI
del exporter (`renderInferredResponses`) está implementado y
emite `responses.{status}.content."application/json".schema`
correctamente, pero el lado Postman nunca llegó a producción.
`packages/core/exporters/postman.exporter.ts` no lee
`spec.responses` y no emite bloques `response[]`. La
colección Postman resultante es silente sobre la forma de las
respuestas para NestJS, FastAPI, Spring y ASP.NET.

El usuario pierde el `example` previsualizado en Postman: la
colección funciona, pero no muestra qué *debería* devolver el
endpoint. Es la mitad de la promesa de f00012.

## Approach

Extender `collection-builder.service.ts` y/o
`postman.exporter.ts` para consumir `EndpointSpec.responses`
exactamente como hoy hace `openapi.exporter.ts` con
`renderInferredResponses`.

### Materialización esperada (Postman v2.1.0)

```json
{
  "response": [
    {
      "name": "200 OK (inferred from NestJS return type)",
      "status": "OK",
      "code": 200,
      "_postman_previewlanguage": "json",
      "header": "Content-Type: application/json",
      "body": "{\"id\":\"...\",\"email\":\"...\"}"
    }
  ]
}
```

- `name` incluye el `reason` del inferrer cuando existe (ej.
  `"200 OK (NestJS return type)"`).
- `code` = `entry.status`.
- `body` = serialización del schema con valores placeholder
  (string vacío para strings, 0 para numbers, `{}` para
  objects, `[]` para arrays).
- `header` mínimo: `Content-Type: application/json`.
- Si `entry.confidence === "low"`, añadir
  `_postman_previewlanguage: "// inferred (low confidence): <reason>"` como comentario para que el usuario sepa que es heurístico.
- Si `EndpointSpec.responses` está vacío, NO emitir el bloque
  `response[]` (mantener comportamiento actual — no es
  retroactivo).

## Files

- `packages/core/exporters/postman.exporter.ts` — añadir
  función `renderInferredPostmanResponses(spec, components)`
  análoga a la versión OpenAPI.
- `packages/core/exporters/postman.exporter.spec.ts` (nuevo)
  — 5 tests:
  1. Spec sin `responses` → `response[]` ausente.
  2. Spec con `responses: [{ status: 200, schema: UserDto, reason: "..." }]` →
     `response[]` con un objeto, `code: 200`, `name` con razón.
  3. Spec con `confidence: "low"` → `_postman_previewlanguage`
     marcado como heurístico.
  4. Spec con múltiples statuses (200 + 404) → 2 entradas en
     `response[]`.
  5. Schema complejo (array de objects) → body serializa como
     `[{...}]`.

## Gate

- `bun run test:core` verde (Postman exporter tests).
- `bun run lint` verde (no nuevas reglas de naming necesarias).
- E2E con `examples/example-nestjs/` → la colección Postman
  resultante tiene `response[]` poblado en al menos un endpoint.

## Acceptance

- `packages/core/exporters/postman.exporter.ts` lee
  `EndpointSpec.responses` y emite `response[]` por entrada.
- Postman exporter acepta la firma de la propuesta S4 del
  `f00012` original.
- Fixture `examples/example-nestjs/` produce colección con
  `response[]` poblado.
- `f00012` puede reabrirse opcionalmente y quitar el `deviation`
  cuando esta propuesta cierre.

## Risks

- Postman v2.1.0 requiere `name`, `status`, `code`, `body`,
  `header` por entrada. Asegurarse de no emitir entradas
  malformadas (que Postman rechaza al importar).
- Si el schema inferido es profundo, el body puede ser enorme.
  Mitigación: serializar con profundidad limitada (3 niveles)
  y truncar arrays a 1 elemento.
