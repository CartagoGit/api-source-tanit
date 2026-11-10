---
id: x00099
title: "Conservar prefijos de routers Express encadenados y exportados entre módulos"
kind: fix
status: ready
type: proposal
track: frameworks
date: 2026-11-10
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
- **Status**: pending
- **Files**: `packages/frameworks/scanners/express.scanner.ts`, `packages/frameworks/scanners/express-symbol-table.helper.ts`, `tests/frameworks/express-chained-mounts.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Regresión sintética original para Router().use con export default, imports y cadena de routers: rutas de controladores bajo /api; GET / independiente."
  - "Resolver por instancia/módulo y componer prefijos anidados sin colisiones de nombres, doble prefijo, bucles ni asociar middleware arbitrario como router."
  - "Preservar montajes simples existentes, aliases, routers homónimos y diagnóstico honesto de receptores no resolubles."
  - "Repetir corpus externo fijado y comparar pares método/ruta completos con baseline revisado; contar coincidencias sin afirmar corrección de schemas/respuestas no medida."

## acceptance

- Regresión sintética original para Router().use con export default, imports y cadena de routers: rutas de controladores bajo /api; GET / independiente.
- Resolver por instancia/módulo y componer prefijos anidados sin colisiones de nombres, doble prefijo, bucles ni asociar middleware arbitrario como router.
- Preservar montajes simples existentes, aliases, routers homónimos y diagnóstico honesto de receptores no resolubles.
- Repetir corpus externo fijado y comparar pares método/ruta completos con baseline revisado; contar coincidencias sin afirmar corrección de schemas/respuestas no medida.
