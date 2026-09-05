---
id: x00038
title: "Express bridge structured-call IR - eliminar call.callee.split('.') en favor de { receiver, method, computed }"
kind: fix
status: ready
type: proposal
track: general
date: 2026-09-05
---

# x00038 — Express bridge structured-call IR: eliminar `call.callee.split(".")`

## Goal

Eliminar la conversión destructiva que el bridge de Express (y Koa/Hapi,
que comparten la misma lógica) aplica al IR estructurado del collector
TypeScript. Hoy el collector emite `CallExpression` con `callee: { receiver,
method, computed }`, el bridge vuelve a convertir esa información en un
string `"receiver.method"` y `express.scanner.ts:278` la rompe por
`split(".")`:

```ts
const [ident, method] = call.callee.split(".");
```

Resultado confirmado:

| Código real              | `ident`  | `method`  | Detectado |
|--------------------------|----------|-----------|-----------|
| `router.get("/users")`   | router   | get       | sí        |
| `this.router.get("/u")`  | this     | router    | **NO**    |
| `api.router.get("/u")`   | api      | router    | **NO**    |
| `router["get"]("/u")`    | router   | "get"     | **NO**    |

Esto es el bug P1 más importante que sobrevive a la auditoría 2026-09-04.
La línea 278 es exactamente la trampa que el auditor señaló.

## Why

El bridge existe porque los scanners legacy esperan strings. La
"modernización" parcial del collector TypeScript introdujo un IR
estructurado, pero los scanners no lo consumieron: el bridge deshizo el
trabajo del collector. Esto **invalida** toda la cadena a00016 (multi-style
TS collector) hasta que se cierre.

El audit 2026-09-04 calculó que el collector nuevo es excelente pero el
scanner final pierde la información. Es exactamente este archivo.

Es un fix grande — afecta a 5 scanners TS (express, koa, hapi, hono,
nestjs) y al contrato `IRouteScanner`. Por eso es propuesta auditable y
no se ejecuta sin pasar por aquí.

## Non-goals

- No reescribe los scanners a una arquitectura nueva. Se mantiene el
  patrón "scanner recibe calls estructurados y mira el method".
- No cambia el collector TypeScript. El IR estructurado ya existe en
  `packages/contracts/interfaces/core/scanner.interface.ts`; este slice
  lo consume correctamente por primera vez.
- No toca Python, Go, PHP, etc. — solo el path TS.

## Slices

- global_gate: e2e

### S1 — Definir `IStructuredCall` en contracts

- **Status**: pending
- **Files**: `packages/contracts/interfaces/core/scanner.interface.ts`
- **Gate**: type
- **Acceptance**: `IStructuredCall { receiver: IExpressionRef; method: string; computed: boolean; args: IExpressionRef[] }` añadido al contrato. Documenta explícitamente que `callee` (string) es legacy y deprecado.

### S2 — Eliminar el bridge en 5 scanners

- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/hono.scanner.ts`, `packages/frameworks/scanners/nestjs.scanner.ts`, y los scanners Koa/Hapi si existen
- **Gate**: type
- **Acceptance**: ningún scanner llama a `call.callee.split(".")`. Todos comparan `call.method === "get"` directamente. El caso `computed: true` se trata como método dinámico (el receiver puede ser string-keyed; el method se acepta tal cual).

### S3 — Tests multi-estilo: 7 patrones TS

- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `tests/frameworks/express-scanner.spec.ts`, `tests/frameworks/hono-scanner.spec.ts`, `tests/frameworks/nestjs-scanner.spec.ts`
- **Gate**: lint
- **Acceptance**: cada scanner pasa los 7 patrones de la auditoría:
  - `router.get("/u", h)`
  - `this.router.get("/u", h)`
  - `api.router.get("/u", h)`
  - `factory().get("/u", h)`
  - `router["get"]("/u", h)`
  - `router?.get("/u", h)` (optional chain)
  - `const get = router.get.bind(router); get("/u", h)`

### S4 — Fixture E2E multi-estilo

- **Status**: pending
- **DependsOn**: [S3]
- **Files**: `tests/fixtures/express-multi-style/`, `tests/e2e/express-multi-style.spec.ts`
- **Gate**: e2e
- **Acceptance**: el fixture contiene los 7 patrones. El E2E genera la colección Postman y verifica que las 7 rutas aparecen.

### S5 — Gate `lint:no-call-callee-split`

- **Status**: pending
- **DependsOn**: [S4]
- **Files**: `scripts/gates/lint-no-call-callee-split.script.ts`
- **Gate**: lint
- **Acceptance**: grep sobre `packages/frameworks/scanners/*.scanner.ts` falla si encuentra `call.callee.split(`. Excluye comentarios.

## Acceptance

- Los 7 patrones TS producen las mismas rutas Postman.
- El grep gate rechaza cualquier reintroducción del bug.
- `bun run validate` verde, incluido el nuevo gate.
- La propuesta audita explícitamente el camino al cierre del "bug P1 grande".
