---
id: a00016
title: "Frontend TypeScript multi-estilo — LanguageIR (this.router.get/factory().get/aliases/reexports/constant-prop)"
kind: audit
status: ready
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - 3fd6cfd  # S1: ILanguageIR shape en contracts/
  - 2a635bd  # S2: collectMethodCalls multi-style
  - c6850e6  # S3: symbol-resolver aliases + reexports
  - 25d755d  # S4: constant propagation
  - 28e8bfc  # S5: bridge + express scanner migrates a LanguageIR
  - 7f9ad90  # merge into develop + push
dependsOn:
  - a00012
related:
  - a00009
  - f00010
---

# a00016 — Frontend TS multi-estilo

> **Revisión 2026-09-05 (cierre reabierto — INTEGRACIÓN pendiente, no DONE).**
> El LanguageIR está bien planteado y sus primitives y tests unitarios son buenos.
> Pero el scanner real **vuelve a descartar** lo que el IR reconoce: verificado
> contra `packages/frameworks/scanners/express.scanner.ts` en develop actual.
> El patrón `primitive ✅ / unit ✅ / integration ❌` se repite, y la propuesta NO
> está terminada mientras el flujo E2E no demuestre los 6 estilos. **No cerrar
> `done`** sin el slice S6 (matriz E2E). Correcciones de detalle: S1.7 y S3 (contrato
> de `IImportBinding` y `method` para computed) documentadas abajo.
>
> Evidencia:
> ```ts
> // express.scanner.ts:259
> const propagated = propagateConstants(irCalls, []); // bindings SIEMPRE vacío
> // express.scanner.ts:274
> const [ident, method] = call.callee.split(".");     // método semántico por string
> ```
> - `this.router.get` → IR reconoce `callee="this.router.get"`, pero `split(".")`
>   hace `method="router"` ∉ HTTP_METHODS → la ruta se descarta E2E.
> - `api.router.get` → mismo fallo (método no es "get", es "router").
> - `server["get"]` → `split(".")` no halla "." → `method=undefined` → descartado.
> - `const M="get"; app[M](...)` → imposible: `propagateConstants` recibe `[]`.
> - `IImportBinding` no guarda `importedName`: `import { Router as R }` resuelve
>   `R→R`, no `R→Router`; el comentario de canonicalización no es realizable con
>   el modelo de datos actual.

## Goal

Evolucionar el frontend TypeScript de detectar Identifier simple
como objeto del MemberExpression (app.get, router.post) a un
LanguageIR multi-estilo:

- this.router.get
- api.router.get
- getRouter().get
- server["get"] (computed member)
- router?.get (optional chaining)
- aliases: const r = app; r.get(...)
- reexports: export { router } from './router'
- constant propagation: const M = 'get'; app[M](...)
- cross-file symbol resolution.

## Why

Hoy el detector tiene una limitación estructural. Los proyectos
reales mezclan múltiples estilos sintácticos; los scanners
TS/Express/Nest/Hono solo saben identificar Identifier.get(). El
proyecto ya tocó el techo del modelo Identifier simple. La
solución correcta es construir un LanguageIR compartido al que
todos los scanners TS consumen.

## Non-goals

- No introduce un type checker formal. La propagación es por uso
  intraprocedural + heurística documentada.
- No implementa resolución cross-package.
- No reemplaza tsc — extiende el frontend existente.

## Slices

### S1 — ILanguageIR shape en contracts/

- **Status**: pending
- **Files**:
  - packages/contracts/interfaces/core/language-ir.interface.ts (nuevo)
- **Gate**: bun run typecheck
- **Detalle**:
  - IRouteCallExpression { callee, method, args, receiverKind }.
  - IImportBinding { name, source, range }.
  - IReexport { name, from, range }.
  - IConstantBinding { name, value }.

### S2 — Frontend collectMethodCalls multi-estilo

- **Status**: pending
- **Files**: packages/frameworks/typescript/collect-method-calls.ts
- **Gate**: bun run test:frameworks
- **Detalle**: cubre los 6 estilos. Cada rama nueva con su test y
  fixture bajo tests/fixtures.

### S3 — Aliases y reexports

- **Status**: pending
- **Files**: packages/frameworks/typescript/symbol-resolver.ts (nuevo)
- **Gate**: bun run test:frameworks
- **Detalle**: const r = app; r.get('/health') detectado. Reexports
  de router desde ./router registrados.

### S4 — Constant propagation en métodos

- **Status**: pending
- **Files**: packages/frameworks/typescript/constant-propagation.ts
  (nuevo)
- **Gate**: bun run test:frameworks
- **Detalle**: const M = 'get'; app[M]('/health') produce un
  IRouteCallExpression con method resuelto. Solo strings literales
  directos (no concatenación).

### S5 — Migración de los 6 scanners TS-flavored

- **Status**: pending
- **Files**: express.scanner.ts, nestjs.scanner.ts, hono.scanner.ts,
  nextjs.scanner.ts, fastify.scanner.ts, trpc.scanner.ts.
- **Gate**: bun run test:frameworks && bun run validate:examples
- **Detalle**: cada scanner consume ILanguageIR en vez de
  collectJsFiles + Identifier. Los ejemplos example-express,
  example-nestjs, example-hono, example-trpc, etc., siguen
  detectando los mismos endpoints + los nuevos estilos.

### S6 — Integración real: scanners consumen `method`/`resolvedMethod` del IR (CORRECTIVO — bloquea el cierre)

- **Status**: pending
- **Files**:
  - `packages/frameworks/scanners/express.scanner.ts`
  - `packages/frameworks/typescript/symbol-resolver.ts` (matriz → ParsedRoute)
  - `tests/fixtures/` + specs E2E por scanner
- **Gate**: `bun run test:frameworks && bun run validate:examples` + matriz E2E abajo
- **Detalle**:
  - **Eliminar `call.callee.split(".")` como mecanismo semántico** (líneas
    `express.scanner.ts:274` y `symbol-resolver.ts:521`). El split es la causa
    de que `this.router.get`, `api.router.get`, `server["get"]`, `router?.get`,
    `getRouter().get` se reconozcan en el IR y se pierdan al construir la ruta.
  - Los scanners deben consumir directamente `IRouteCallExpression.method` y
    (cuando haya constante) `.resolvedMethod`, más `receiverKind`; nada de
    reconstruir el identificador separando por ".".
  - **Constant bindings reales**: construir los `IConstantBinding` del fichero y
    pasárselos a `propagateConstants(calls, bindings)` — hoy `[]` (`:259`) hace
    el estilo "const M = 'get'" inalcanzable E2E. (El unit test pasa solo porque
    fabrica `bindings` a mano.)
  - **`buildLanguageIR(source)`** que en una sola pasada AST produzca
    `{ calls, imports, reexports, aliases, constants }` — hoy cada collector
    (calls/aliases/reexports/constants) vuelve a leer+parsear el fichero, con lo
    que un proyecto TS grande puede parsearse 4×. Un archivo → un parse.
  - **S6.a contrato**: `IImportBinding { localName, importedName, source }`
    (hoy sólo `name`+`source`; `import { Router as R }` resuelve `R→R` no `R→Router`).
    Alinear el JSDoc: para `server["get"]` decided entre `method=""` (doc actual)
    o `method="get"` (test actual); contrato, implementación y tests deben decir
    lo mismo.
  - **Matriz E2E obligatoria** (fuente → endpoint final, NO comprobar el IR):
    `app.get("/a")`→GET /a · `this.router.get("/b")`→GET /b ·
    `api.router.get("/c")`→GET /c · `getRouter().get("/d")`→GET /d ·
    `server["get"]("/e")`→GET /e · `router?.get("/f")`→GET /f ·
    `const r=app; r.get("/g")`→GET /g · `const M="get"; app[M]("/h")`→GET /h.
  - **Empezar por migrar NestJS** (hoy sigue con `split(".")`; sólo Express
    consume el IR vía bridge). La aceptación original pedía los 6 scanners.


## acceptance

1. Fixture con cada estilo del Goal produce endpoints detectados.
2. Suite example-* (21/21) sigue verde.
3. Coverage sin regresión local.
4. bun run validate verde end-to-end.
5. Documentación en docs/FRAMEWORKS.md (sección 'How scanners use
   the LanguageIR').
