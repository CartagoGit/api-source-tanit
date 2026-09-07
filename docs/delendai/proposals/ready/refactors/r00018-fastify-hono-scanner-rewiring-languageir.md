---
id: r00018
title: "Fastify + Hono scanner rewiring to LanguageIR — closes r00013 S3 + S4"
kind: refactor
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - r00013
  - r00014
---

# r00018 — Fastify y Hono migran a `extractRoutes()` (cierra r00013 S3+S4)

## Goal

Que `packages/frameworks/scanners/fastify.scanner.ts` y
`packages/frameworks/scanners/hono.scanner.ts` consuman el
helper universal `extractRoutes(source, filename, framework)`
shipped en [`r00013 S1+S2`](../done/refactors/r00013-languageir-universal-migrate-fastify-and-hono-scanners-off-regex-balanced-text.md) en vez del camino
`findOutsideStrings` + `findAllBalanced` heredado. Cierra las
slices S3 y S4 que [`r00013`](./r00013-languageir-universal-migrate-fastify-and-hono-scanners-off-regex-balanced-text.md) dejó pendientes.

## Why (audit 2026-09-06 §14)

Hoy, tres frameworks JS/TS tienen soporte heterogéneo del
mismo patrón (`router.get(path, h)`):

- **Express**: consume LanguageIR (helper
  `extract-routes-express.helper.ts` introducido en `x00048`).
- **Fastify**: regex + balanced-text (vía `findOutsideStrings`,
  `findAllBalanced`, `stripJsComments`).
- **Hono**: regex + balanced-text (vía `findOutsideStrings`,
  `findAllBalanced`).

La consecuencia: cuando un usuario añade un patrón TS
válido (p. ej. un alias import, una chained call, un mount
cross-file) que Express reconoce, Fastify y Hono lo pierden
silenciosamente. `extractRoutes()` ya está implementado y
testeado, pero los scanners nunca lo llaman. El refactor está
**muerto en rama**.

`r00013` se cerró como `in-progress` con `inProgressReason:
"S3 (scanner rewiring) and S4 (multi-router fixtures + e2e
tests) not implemented"`. Esta propuesta cierra ambos.

## Approach

### Slice S3 — rewiring de los dos scanners

**Files**:

- `packages/frameworks/scanners/fastify.scanner.ts`
- `packages/frameworks/scanners/hono.scanner.ts`
- `packages/core/language-frontends/typescript/extract-routes-express.helper.ts` (audit; asegurar que no quede muerto)
- `tests/frameworks/extract-routes.spec.ts` (actualizar: cubrir Fastify + Hono end-to-end)

**Detalle**:

1. Importar `extractRoutes` desde `packages/core/language-frontends/typescript/index.ts` en ambos scanners.
2. Reemplazar el bucle actual (`for (const { match, index } of findOutsideStrings(source, SHORT_ROUTE_RE))`) por:
   ```ts
   const routes = extractRoutes(source, sourceFile, "fastify");
   for (const extracted of routes) {
     // mapping extracted → ParsedRoute (método, path, handler, position)
   }
   ```
3. Cuando el scanner ya tiene un `Program` AST TS cacheado
   (caso del LanguageIR), llamar a
   `extractRoutesFromProgram(program, framework)` directamente
   para evitar el segundo parse — esto preserva el beneficio
   AST-share de `x00048` S3.
4. Detrás de un flag `legacyFallback: boolean = true` en el
   constructor del scanner, dejar el camino regex viejo
   activo como fallback si Babel lanza (`try/catch` explícito
   que registra en `IParseDiagnostic`).
5. **Dual-emit durante el primer slice**: en modo test, ambos
   caminos corren, los resultados se comparan, y la suite
   falla si hay diff. Cuando `bun run validate:examples`
   lleva 10 runs idénticos consecutivos, el `legacyFallback`
   se quita (slice siguiente, fuera de esta propuesta).

**Gate**: `bun run test:frameworks` + `bun run validate:examples` + `bun run typecheck`

### Slice S4 — fixtures + E2E multi-router

**Files**:

- `tests/fixtures/fastify-multi-router/package.json`
- `tests/fixtures/fastify-multi-router/src/users.ts`
- `tests/fixtures/fastify-multi-router/src/orders.ts`
- `tests/fixtures/fastify-multi-router/src/server.ts`
- `tests/fixtures/hono-multi-router/package.json`
- `tests/fixtures/hono-multi-router/src/users.ts`
- `tests/fixtures/hono-multi-router/src/orders.ts`
- `tests/fixtures/hono-multi-router/src/server.ts`
- `tests/e2e/fastify-multi-router.test.ts` (nuevo)
- `tests/e2e/hono-multi-router.test.ts` (nuevo)
- `docs/FRAMEWORKS.md` (actualizar tabla: Fastify y Hono pasan de "regex/balanced" a "LanguageIR universal")

**Detalle**:

Cada fixture tiene 2 routers con prefijos distintos
(`/users`, `/orders`) y al menos un patrón por framework que
era frágil antes del refactor:

- **Fastify**: `route({ method: ['GET', 'POST'], url: '/x' })`,
  `.register(sub, { prefix: '/v1' })`, alias
  `import Fastify from 'fastify'`.
- **Hono**: chain `app.get('/a', h).post('/b', h)`,
  `app.route('/api', sub)`, alias
  `import { Hono as T } from 'hono'`.

Los tests E2E ejecutan el binario contra cada fixture,
validan que las rutas acaban en el prefijo correcto y que no
hay prefijos cruzados (paralelo al S3 de `x00055` para
Express).

**Gate**: `bun run test:e2e` + `bun run lint:fixtures` + `bun run validate:examples`

## Acceptance

- `bun run typecheck` verde.
- `bun run test:frameworks` verde con los tests nuevos
  (Fastify + Hono consumen `extractRoutes()`).
- `bun run test:e2e` verde con los nuevos
  `fastify-multi-router.test.ts` y `hono-multi-router.test.ts`.
- `bun run validate:examples` verde — los snapshots de
  `example-fastify/` y `example-hono/` no cambian (refactor
  invisible para el contrato `ParsedRoute`).
- `bun run lint:fixtures` verde — las fixtures nuevas cumplen
  el manifest.
- `docs/FRAMEWORKS.md` actualizado: tabla de cobertura refleja
  el cambio de "regex/balanced" a "LanguageIR universal" para
  Fastify y Hono.

## Risks

- **Regresión silenciosa en fixtures existentes**. El contrato
  `ParsedRoute` no cambia, pero el orden de emisión puede
  cambiar (Babel visita los nodos en source order; el regex
  antes dependía de heurística). Mitigación: `validate:examples`
  compara contra snapshots versionados; cualquier diff falla
  el CI antes de merge.
- **Coste AST**. Parsear Babel es más caro que regex. Mitigación:
  `extractRoutes()` consume el `program` AST cacheado por el
  scanner cuando está disponible (single-parse). En el peor
  caso, ≤ 15% de latencia adicional.
- **Cross-file mounts sin resolver**. `r00014 S4` ya
  implementó la resolución cross-file para Express. Si los
  scanners Fastify + Hono S3 no invocan la utilidad cross-file,
  los mounts quedan como "router detectado, rutas no
  expandidas" — el mismo estado que hoy, sin regresión.

## Cross-references

- [`r00013`](../done/refactors/r00013-languageir-universal-migrate-fastify-and-hono-scanners-off-regex-balanced-text.md) — propuesta padre, S1+S2 hechos
- [`r00014`](../done/refactors/r00014-symbolgraph-cross-file-resolver-foundation-for-express-fastify-hono-mounts-and-ts-imports.md) — SymbolGraph foundation (consumida por S3 si aplica)
- [`x00055`](../done/fixes/x00055-express-cross-file-router-identity-symbolgraph-audit-2026-09-06-4.md) — referencia análoga para Express
- [`a00018`](../audits/a00018-auditoria-exhaustiva-2026-09-06-languageir-universal-transport-generalization-symbolgraph-y-response-inference.md) — auditoría padre
