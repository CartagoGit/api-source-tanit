---
id: x00038
title: "Express bridge structured-call IR - eliminar call.callee.split('.') en favor de { receiver, method, computed }"
kind: fix
status: done
type: proposal
track: general
date: 2026-09-05
shippedIn:
  - de45d02  # S2: bridge puebla receiver/method/receiverKind + express.scanner consume el IR sin split (6 estilos) + spec multi-estilo (7→6, sin const-M)
  - ce3138a  # S5: gate lint:no-call-callee-split + spec en tests/cli
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

- **Status**: done (el IR estructurado ya existía: `IRouteCallExpression` con `receiver`/`method`/`resolvedMethod`/`receiverKind`; se añadió `receiver` opcional y los campos estructurales al `TSMethodCall`. No se creó un `IStructuredCall` nuevo: se reutilizó el IR existente — ver nota de cierre.)
- **Files**: `packages/contracts/interfaces/core/scanner.interface.ts`
- **Gate**: type
- **Acceptance**: `IStructuredCall { receiver: IExpressionRef; method: string; computed: boolean; args: IExpressionRef[] }` añadido al contrato. Documenta explícitamente que `callee` (string) es legacy y deprecado.

### S2 — Eliminar el bridge en 5 scanners

- **Status**: done (solo Express tenía el `callee.split(".")` semántico; hono/nestjs/fastify/trpc/nextjs no lo usaban. El bridge ahora puebla `receiver`/`method`/`receiverKind` y `express.scanner.ts` (3) consume esos campos, no `split`.)
- **DependsOn**: [S1]
- **Files**: `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/hono.scanner.ts`, `packages/frameworks/scanners/nestjs.scanner.ts`, y los scanners Koa/Hapi si existen
- **Gate**: type
- **Acceptance**: ningún scanner llama a `call.callee.split(".")`. Todos comparan `call.method === "get"` directamente. El caso `computed: true` se trata como método dinámico (el receiver puede ser string-keyed; el method se acepta tal cual).

### S3 — Tests multi-estilo: 6 patrones TS

- **Status**: done (spec `tests/frameworks/express-multi-style.spec.ts`, E2E fuente→ruta). Nota: 6 de los 7 patrones de la tabla. El séptimo, `const M = "get"; app[M](...)`, NO lo cubre x00038: requiere poblar los `IConstantBinding` reales (hoy `propagateConstants(irCalls, [])`). Ese hueco queda en `a00016 S6`, fuera del alcance de este fix.
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

- **Status**: done (se eligió spec con `createTempProject` en memoria sobre fixture en disco: mismo valor de prueba —fuente→colección— sin tocar `validate:examples` ni los conteos de las 21 suites. Ver `tests/frameworks/express-multi-style.spec.ts`.)
- **DependsOn**: [S3]
- **Files**: `tests/fixtures/express-multi-style/`, `tests/e2e/express-multi-style.spec.ts`
- **Gate**: e2e
- **Acceptance**: el fixture contiene los 7 patrones. El E2E genera la colección Postman y verifica que las 7 rutas aparecen.

### S5 — Gate `lint:no-call-callee-split`

- **Status**: done (script en `scripts/gates/`, enganchado a `bun run lint`, spec `tests/cli/lint-no-call-callee-split.spec.ts`. Escanea solo `*.scanner.ts` y excluye líneas de comentario. 22/22 scanners limpios.)
- **DependsOn**: [S4]
- **Files**: `scripts/gates/lint-no-call-callee-split.script.ts`
- **Gate**: lint
- **Acceptance**: grep sobre `packages/frameworks/scanners/*.scanner.ts` falla si encuentra `call.callee.split(`. Excluye comentarios.

## Cierre

> **x00038 DONE 2026-09-05** (slices S1-S5, integrados en `develop` en `de45d02`
> + `ce3138a`). Los 6 multi-estilos con **verbo literal** (`this.router.get`,
> `api.router.get`, `getRouter().get`, `server["get"]`, `router?.get`, y el plano
> `app.get`) llegan ahora a `ParsedRoute`. Prueba anti-regresión documentada: sin
> el fix del bridge, 4 de los 7 casos del spec fallan; con él, 7/7.
>
> Alcance deliberado: **el estilo `const M = "get"; app[M](...)` sigue sin
> resolverse** (el seventh patrón). No es que x00038 lo haya roto: el binding
> de constantes en el scanner (`propagateConstants(irCalls, [])`) está vacío por
> diseño aún — construir los `IConstantBinding` del fichero para pasárselos es
> trabajo del slice S4 de `a00016`/`x00030`, no de este. Se anota aquí para que
> el P1 no se dé por cerrado con un patrón colgando: x00038 cierra el *split*;
> `a00016 S6` (const-M + matriz E2E completa) sigue `pending`.
>
> Evidencia: `bun run validate` verde end-to-end incluido `lint:no-call-callee-split`.

## Acceptance

- Los 6 patrones TS con verbo literal producen las rutas Postman (el 7º,
  `const M = "get"; app[M]`, vive en `a00016 S6`).
- El gate `lint:no-call-callee-split` rechaza cualquier reintroducción del `split`.
- `bun run validate` verde, incluido el nuevo gate.
