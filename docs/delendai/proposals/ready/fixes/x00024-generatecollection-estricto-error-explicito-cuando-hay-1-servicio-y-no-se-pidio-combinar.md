---
id: x00024
title: "generateCollection() estricto — error explícito cuando hay >1 servicio y no se pidió combinar"
kind: fix
status: ready
type: proposal
track: export-to-postman
date: 2026-09-04
dependsOn:
  - a00013
related:
  - a00009
  - f00011
---

# x00024 — `generateCollection()` estricto

## Goal

Convertir el branch `if (Array.isArray(result)) { return result[0]; }` de
`packages/core/discovery/generation.pipeline.ts:86-115` en un lanzamiento
de error explícito cuando el caller no pidió `--combine-services` y
existen varios servicios. El contrato legacy debe seguir funcionando
para single-service.

## Why

Hallazgo P1 del audit 2026-09-04 (snapshot `7ea3a5d`). El contrato
`generateCollection()` está documentado como "una sola colección" pero
el branch multi-service hace `return result[0]` y descarta los demás
servicios **silenciosamente**. Esto significa que
`await generateCollection(monorepoRoot)` para un monorepo con 2
servicios devuelve una sola colección sin warning, perdiendo la
otra. La API plural `generateCollections()` sí devuelve el array
completo, pero los callers que usan la singular no se enteran del bug.

## Non-goals

- No rompe el contrato de `generateCollections()` (plural).
- No cambia la API HTTP pública de `expostman generate`.
- No relaja la detección de multi-service.

## Slices

### S1 — lanzar `MultipleServicesWithoutCombineError`

- **Status**: pending
- **Files**:
  - `packages/core/discovery/generation.pipeline.ts` (rama `Array.isArray(result)`)
  - `packages/core/errors/multiple-services-without-combine.error.ts` (nuevo)
  - `tests/core/generation.pipeline.spec.ts` (nuevo)
- **Gate**: `bun run test:core tests/core/generation.pipeline.spec.ts`
- **Detalle**:
  - Nueva clase `MultipleServicesWithoutCombineError extends Error` con
    `.serviceCount`, `.serviceIds[]`, `.suggestion` ("use --combine-services
    or generateCollections()").
  - `generateCollection()` lanza el error cuando `Array.isArray(result)
    && result.length > 1 && !options.combineServices`.
  - El camino single-service / `combineServices=true` sigue devolviendo
    `IGenerationResult` exactamente como antes.
  - **3 tests nuevos** en `generation.pipeline.spec.ts`:
    1. Monorepo con 2 servicios sin `--combine-services` → throw con
       `serviceCount === 2`, `serviceIds` poblado, mensaje accionable.
    2. Monorepo con 2 servicios + `--combine-services` → 1 collection
       combinada (legacy behavior intact).
    3. Single-service sin `--combine-services` → 1 collection (legacy
       intact).

### S2 — propagar al CLI con exit code 64

- **Status**: pending
- **Files**: `packages/cli/commands/generate.script.ts`
- **Gate**: `bun run test:cli`
- **Detalle**:
  - Capturar `MultipleServicesWithoutCombineError` en el wrapper CLI y
    emitir un mensaje de error legible (lista de servicios detectados +
    sugerencia). Exit code 64 (`EX_USAGE`) para que scripts de CI
    detecten el caso sin parsear texto.

## acceptance

1. `bun run test:core tests/core/generation.pipeline.spec.ts` verde con
   los 3 tests nuevos pasando.
2. CLI devuelve exit 64 con mensaje accionable cuando hay multi-service
   sin `--combine-services`.
3. Single-service y `--combine-services` legacy sin cambios.
4. `bun run validate` verde end-to-end.
5. Coverage sin regresión local.