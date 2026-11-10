---
id: x00099
title: "Conservar prefijos de routers Express encadenados y exportados entre módulos"
kind: fix
status: review
type: proposal
track: frameworks
date: 2026-11-10
last-transition-id: 779ebc62-5905-41c9-8cc8-f8f1f2d6eca1
last-correlation-id: 779ebc62-5905-41c9-8cc8-f8f1f2d6eca1
last-transition-from: in-progress
last-transition-at: 2026-11-10T07:46:02.070Z
---

# x00099 — Conservar prefijos de routers Express encadenados y exportados entre módulos

## goal

Resolver el montaje Router().use y su composición entre imports sin perder /api ni inventar prefijos de otras instancias.

## why

Aceptación externa: gothinkster/node-express-realworld-example-app a 30b68e1e881462b2f4164ea09ab4c4f5699c7b0b define export default Router().use(/api, api), donde api encadena .use de controladores. Tras corregir el crash del AST aparecen 20 operaciones, pero 19 carecen del prefijo /api real. GET / debe permanecer sin prefijo.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Composición de montajes por identidad de router
- **Status**: review
- **Files**: `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/express-router-mounts.helper.ts`, `tests/frameworks/express-chained-mounts.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Regresión sintética original para Router().use con export default, imports y cadena de routers: rutas de controladores bajo /api; GET / independiente."
  - "Resolver por instancia/módulo y componer prefijos anidados sin colisiones de nombres, doble prefijo, bucles ni asociar middleware arbitrario como router."
  - "Preservar montajes simples existentes, aliases, routers homónimos y diagnóstico honesto de receptores no resolubles."
  - "Repetir corpus externo fijado y comparar pares método/ruta completos con baseline revisado; contar coincidencias sin afirmar corrección de schemas/respuestas no medida."
- shipped-in: `7d22c23829aa`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- Regresión sintética original para Router().use con export default, imports y cadena de routers: rutas de controladores bajo /api; GET / independiente.
- Resolver por instancia/módulo y componer prefijos anidados sin colisiones de nombres, doble prefijo, bucles ni asociar middleware arbitrario como router.
- Preservar montajes simples existentes, aliases, routers homónimos y diagnóstico honesto de receptores no resolubles.
- Repetir corpus externo fijado y comparar pares método/ruta completos con baseline revisado; contar coincidencias sin afirmar corrección de schemas/respuestas no medida.


## Acceptance evidence — 2026-11-10

The immutable external source recorded in this proposal was analyzed without
installing dependencies or executing project code. The reviewed baseline is
20 explicit method/path pairs: GET / and 19 controller operations under /api.
Before the mount fix only GET / matched; after it all 20 match, with no missing
or unexpected pairs. This is one corpus sample, not a framework-wide accuracy
claim. Response/schema accuracy and Application API parity are separate gates.

Regression cases cover anonymous default exports, chained .use calls,
module-local same-name routers, named import aliases, nested and repeated
mounts, literal prefix constants, CommonJS default exports, unrelated middleware
factories, cycles and unresolved parent factories. Prefix resolution is cached
per router for each scan; the AST is reused from the existing single-parse flow.
