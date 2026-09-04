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

## acceptance

1. Fixture con cada estilo del Goal produce endpoints detectados.
2. Suite example-* (21/21) sigue verde.
3. Coverage sin regresión local.
4. bun run validate verde end-to-end.
5. Documentación en docs/FRAMEWORKS.md (sección 'How scanners use
   the LanguageIR').
