---
id: x00099
title: "Conservar prefijos de routers Express encadenados y exportados entre módulos"
kind: fix
status: done
type: proposal
track: frameworks
date: 2026-11-10
last-transition-id: 5f735d97-9f02-4f06-a81b-f944f4875955
last-correlation-id: 5f735d97-9f02-4f06-a81b-f944f4875955
last-transition-from: review
last-transition-at: 2026-11-10T18:50:45.614Z
shipped-in:
  - "e1653ac68c18bee9e9b1fef335f71b7cbe2dc69d"
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
- **Status**: done
- **Files**: `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/express-router-mounts.helper.ts`, `tests/frameworks/express-chained-mounts.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Regresión sintética original para Router().use con export default, imports y cadena de routers: rutas de controladores bajo /api; GET / independiente."
  - "Resolver por instancia/módulo y componer prefijos anidados sin colisiones de nombres, doble prefijo, bucles ni asociar middleware arbitrario como router."
  - "Preservar montajes simples existentes, aliases, routers homónimos y diagnóstico honesto de receptores no resolubles."
  - "Repetir corpus externo fijado y comparar pares método/ruta completos con baseline revisado; contar coincidencias sin afirmar corrección de schemas/respuestas no medida."
- shipped-in: `7d22c23829aa`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at e1653ac68c18, validate exit 0 and tests 65/65 claimed, no recorded run cited; acceptance 4/4: (1) Reviewed the four regression tests in tests/frameworks/express-chained-mounts.spec.ts for anonymous default export/import chain, isolated same-name routers, re… (2) Reviewed router identity keys, per-module import/export resolution, bounded cycle traversal, prefix normalization, and diagnostics in express-router-mounts.hel… (3) Reviewed chained-mount regression cases and existing Express scanner, multi-router, multi-style, and symbol-table suites; 65/65 passed, including aliases, repe… (4) Inspected /tmp/tanit-corpus-express-20261110.json and CLI/API reports for gothinkster/node-express-realworld-example-app revision 30b68e1e881462b2f4164ea09ab4c… — Independent review of x00099 S1 at landed develop e1653ac68c18bee9e9b1fef335f71b7cbe2dc69d. Focused check: bunx vitest run on five Express framework test files, 65 passed/65, exit 0. External route evidence from the immutable corpus JSON confirms CLI and API 20/20 method/path parity; no claim is made about full response/schema accuracy.

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
