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

- **Status**: done (3fd6cfd)
- **Files**:
  - packages/contracts/interfaces/core/language-ir.interface.ts (nuevo)
- **Gate**: bun run typecheck
- **Detalle**:
  - IRouteCallExpression { callee, method, args, receiverKind }.
  - IImportBinding { name, source, range }.
  - IReexport { name, from, range }.
  - IConstantBinding { name, value }.

### S2 — Frontend collectMethodCalls multi-estilo

- **Status**: done (2a635bd) — archivo renombrado por x00033 (2b227ee) a `collect-method-calls.helper.ts`
- **Files**: packages/frameworks/typescript/collect-method-calls.helper.ts
- **Gate**: bun run test:frameworks
- **Detalle**: cubre los 6 estilos. Cada rama nueva con su test y
  fixture bajo tests/fixtures.

### S3 — Aliases y reexports

- **Status**: done (c6850e6) — archivo renombrado por x00033 (2b227ee) a `symbol-resolver.helper.ts`
- **Files**: packages/frameworks/typescript/symbol-resolver.helper.ts (nuevo)
- **Gate**: bun run test:frameworks
- **Detalle**: const r = app; r.get('/health') detectado. Reexports
  de router desde ./router registrados.

### S4 — Constant propagation en métodos

- **Status**: done (25d755d) — archivo renombrado por x00033 (2b227ee) a `constant-propagation.helper.ts`
- **Files**: packages/frameworks/typescript/constant-propagation.helper.ts (nuevo)
- **Gate**: bun run test:frameworks
- **Detalle**: const M = 'get'; app[M]('/health') produce un
  IRouteCallExpression con method resuelto. Solo strings literales
  directos (no concatenación).

### S5 — Migración de los 6 scanners TS-flavored

- **Status**: done (28e8bfc) + merge 7f9ad90
- **Files**: express.scanner.ts, nestjs.scanner.ts, hono.scanner.ts,
  nextjs.scanner.ts, fastify.scanner.ts, trpc.scanner.ts.
- **Gate**: bun run test:frameworks && bun run validate:examples
- **Detalle**: cada scanner consume ILanguageIR en vez de
  collectJsFiles + Identifier. Los ejemplos example-express,
  example-nestjs, example-hono, example-trpc, etc., siguen
  detectando los mismos endpoints + los nuevos estilos.

### S6 — Integración real: scanners consumen `method`/`resolvedMethod` del IR (CORRECTIVO — bloquea el cierre)

- **Status**: pending (PARCIALMENTE hecho — el split se cerró vía x00038/de45d02; quedan S6.a, S6.c, S6.d, S6.e)
- **Progreso 2026-09-05/06**: el primer bullet (eliminar `callee.split(".")` de
  `express.scanner.ts`) está HECHO con la propuesta hermana **x00038** (bridge
  puebla `receiver`/`method`/`receiverKind`, el scanner los consume, y el gate
  `lint:no-call-callee-split` lo fija). Los 6 multi-estilos con verbo literal ya
  llegan a `ParsedRoute`. Quedan abiertas 4 piezas, divididas en sub-slices
  S6.a–S6.e (ver abajo) con orden estricto: S6.a → S6.d → S6.c → S6.e.
- **Files**:
  - `packages/contracts/interfaces/core/language-ir.interface.ts` (S6.a)
  - `packages/frameworks/typescript/collect-constants.helper.ts` (S6.c, nuevo)
  - `packages/frameworks/typescript/build-language-ir.helper.ts` (S6.d, nuevo)
  - `packages/frameworks/scanners/express.scanner.ts`
  - `packages/frameworks/typescript/symbol-resolver.ts`
  - `packages/frameworks/typescript/symbol-resolver.helper.ts` (S6.a)
  - `packages/frameworks/scanners/nestjs.scanner.ts` (S6.e)
  - `tests/fixtures/` + specs E2E por scanner
- **Gate**: `bun run test:frameworks && bun run validate:examples` + matriz E2E abajo

### S6.a — `IImportBinding.importedName` + alias canonicalisation (contrato)

- **Status**: pending
- **Size**: S (2–3 h)
- **Files**: `packages/contracts/interfaces/core/language-ir.interface.ts`,
  `packages/frameworks/typescript/symbol-resolver.helper.ts:228-244`,
  `tests/frameworks/symbol-resolver.spec.ts:99-122`
- **Gate**: `bun run typecheck && bun run test:frameworks`
- **Detalle**: añadir `importedName` a `IImportBinding` (hoy sólo
  `name+source`); el collector en `symbol-resolver.helper.ts:228` ya
  destructura `local`+`imported` pero descarta `imported`. Hoy
  `import { Router as R }` resuelve `R→R`; tras el slice resuelve
  `R→Router`. Alinear JSDoc + test para que el caso `R.get → Router.get`
  se valide explícitamente (hoy el test pasa con `R→R`).

### S6.b — Eliminar `call.callee.split(".")` como mecanismo semántico

- **Status**: done (x00038, de45d02 + ce3138a)
- **Detalle**: x00038 cerró el split en `express.scanner.ts:274` y
  `symbol-resolver.ts:521` introduciendo el IR estructurado con
  `receiver/method/receiverKind`. El gate `lint:no-call-callee-split`
  lo fija. Los 6 multi-estilos con verbo literal (`app.get`,
  `this.router.get`, `api.router.get`, `server["get"]`,
  `router?.get`, `getRouter().get`) llegan a `ParsedRoute` ya.
  El único `callee.split` superviviente en
  `symbol-resolver.helper.ts:520` está dentro de `resolveCallee()`
  y opera sobre el callee textual para reescritura de aliases
  (`r.get` → `app.get`), con guarda `parts.length !== 2`; es la
  ruta de reescritura, no de derivación semántica.

### S6.c — `IConstantBinding[]` real (collector + wiring)

- **Status**: pending
- **Size**: M (4–6 h)
- **Files**:
  - NEW `packages/frameworks/typescript/collect-constants.helper.ts`
    (walker Babel AST de `VariableDeclarator` con `init` literal;
    emite `IConstantBinding[]`)
  - EDIT `packages/frameworks/scanners/express.scanner.ts:282-283`
    (`propagateConstants(irCalls, bindings)` deja de pasar `[]`)
  - EDIT `tests/frameworks/constant-propagation.spec.ts` (1 caso
    in-source + 1 E2E con fixture temporal)
  - EDIT `tests/frameworks/express-multi-style.spec.ts` (añadir el
    caso `const M="get"; app[M]("/h")` → `GET /h`)
- **Gate**: `bun run test:frameworks` (matriz E2E 8/8)
- **Detalle**: cierra el 8° patrón de la matriz. `propagateConstants`
  ya funciona unit-tested; falta el productor de bindings. Es
  estrictamente aditivo: ningún código que ya funcione cambia de
  comportamiento, sólo se rellena el array que antes iba vacío.
  **Highest-leverage sub-task**: cierra 1 patrón E2E sin tocar
  contratos ni reescribir collectores.

### S6.d — `buildLanguageIR(source)` single-parse refactor

- **Status**: pending
- **Size**: L (8–12 h)
- **Files**:
  - NEW `packages/frameworks/typescript/build-language-ir.helper.ts`
    (top-level `buildLanguageIR(source) → { calls, imports,
    reexports, aliases, constants }`)
  - EDIT `packages/frameworks/typescript/collect-method-calls.helper.ts:531-555`
    (acepta AST pre-parseado en vez de texto)
  - EDIT `packages/frameworks/typescript/symbol-resolver.helper.ts:298-352`
    (extrae `parseForSymbols(source, filename)`)
  - NEW `packages/frameworks/typescript/build-language-ir.spec.ts`
- **Gate**: `bun run typecheck && bun run test:frameworks` + nuevo
  gate `lint:no-build-language-ir-multiple-parse` (espejo de
  `lint:no-call-callee-split`) que prohíbe a los collectores re-parsear
  texto crudo.
- **Detalle**: hoy cada collector (`collect-method-calls`,
  `aliases`, `reexports`, el futuro `constants`) llama
  `babelParse(source, ...)` independientemente — un archivo se
  parsea 3× hoy, 4× cuando S6.c aterrice. 1 parse → 1 AST compartido.
  Depende de S6.a (el contrato del IR debe estar sellado antes de
  consolidar la superficie).

### S6.e — NestJS migrado a IR (con `IDecorator` o walker paralelo)

- **Status**: pending
- **Size**: L–XL (10–16 h)
- **Files**: `packages/frameworks/scanners/nestjs.scanner.ts:241-272`,
  posiblemente NEW `packages/frameworks/typescript/collect-decorators.helper.ts`
  si se extiende el IR con `IDecorator`; fixture `examples/example-nestjs/`
  debe seguir produciendo los mismos endpoints.
- **Gate**: `bun run validate:examples` (nestjs fixture verde)
- **Detalle**: NestJS detecta rutas por decoradores
  (`@Controller`+`@Get`), no por `CallExpression`. Hoy usa regex
  sobre `text.split("\n")` (`CLASS_CONTROLLER_RE` /
  `METHOD_DECORATOR_RE`). Dos opciones: (a) extender `ILanguageIR`
  con `IDecorator` (cambio de contrato, surface mayor), o (b) añadir
  un `collectDecorators(source)` walker separado y alimentar IR
  (calls) + decorators (NestJS) por separado. (b) es más seguro.
  Riesgo alto: cualquier regresión rompe la fixture NestJS y la
  collection Postman del ejemplo.

### Orden estricto

```
S6.a (contrato) → S6.d (refactor) → S6.c (bindings) → S6.e (NestJS)
```

**Matriz E2E 8/8** depende de S6.c (último patrón). **Cierre de
a00016** depende de matriz 8/8 + S6.d (single-parse) + S6.e
(NestJS migrado), o de una decisión explícita de aceptar
"Express-only IR" como cierre con NestJS/Hono/Fastify/Next.js/tRPC
manteniendo regex (anotar como no-goal explícito).


## acceptance

1. Fixture con cada estilo del Goal produce endpoints detectados.
2. Suite example-* (21/21) sigue verde.
3. Coverage sin regresión local.
4. bun run validate verde end-to-end.
5. Documentación en docs/FRAMEWORKS.md (sección 'How scanners use
   the LanguageIR').
