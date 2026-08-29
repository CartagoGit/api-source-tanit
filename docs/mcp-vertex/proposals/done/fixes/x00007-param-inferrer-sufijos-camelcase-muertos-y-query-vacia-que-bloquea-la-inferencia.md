---
id: x00007
title: "param-inferrer: sufijos camelCase muertos y query vacia que bloquea la inferencia"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-30
related:
  - t00004
---

> **Cerrada 2026-08-30.** Los dos defectos corregidos en `be5d67d`
> (integrado por entrega del subagente + commit del dueño en paralelo;
> contenido revisado por el orquestador contra la entrega declarada):
> S1 — los sufijos camelCase (`Id`, `Codigo`) ahora se comparan contra el
> nombre original, no contra `lname`; `DepartamentoId` infiere `"1"`.
> S2 — `!s.query || s.query.length === 0`: vacío y ausente son lo mismo.
> Suite: tests/core 688 verdes, plugin 118 verdes, `validate` exit 0
> (128 ficheros / 2.585 tests). Novedad menor detectada y no arreglada
> (fuera de scope): `codigo_proveedor` nunca recibe `PROV001` porque su
> hint va después del de `codigo` en `PATH_PARAM_HINTS`.

# x00007 — param-inferrer: sufijos camelCase muertos y query vacía que bloquea la inferencia

## Goal

Que la inferencia de ejemplos y variables de colección haga lo que sus
propias tablas de sufijos prometen: reconocer `_id`/`_codigo` también en
nombres camelCase, y aplicar la heurística de query a los specs que hoy
llegan con `query: []` en vez de sin la propiedad.

## why

`t00004` dejó estos dos defectos fijados en test (comentarios en
`packages/core/domain/param-inferrer.service.ts` y sus specs), porque
arreglarlos era un cambio de producción fuera del scope de un lote de
fixtures:

1. **Sufijos muertos**: `exampleForBodyField` compara `lname` (nombre
   ya en minúsculas) contra `endsWith("Id")` y `endsWith("Codigo")` —
   variantes camelCase que nunca casan. Consecuencia medible:
   `DepartamentoId` recibe `sample_departamentoid` genérico en vez de
   `"1"`.
2. **`query: []` bloquea la inferencia**: el guardián de
   `applyAgnosticInference` es `if (!s.query)`, y un array vacío es
   truthy. La mayoría de specs fabricados por el adapter llegan con
   `query: []`, así que la heurística de query solo actúa en los que
   vienen con la propiedad ausente. Comportamiento inconsistente entre
   dos representaciones de "sin query".

## Slices

- global_gate: none

### S1 — Sufijos camelCase de `_id` y `_codigo`
- **Status**: done
- **Files**: `packages/core/domain/param-inferrer.service.ts`,
  `tests/core/param-inferrer.branches.spec.ts`
- **Gate**: test
- acceptance:
  - "`DepartamentoId` infiere el ejemplo del sufijo (`1`), no un genérico"
  - "Los tests fijados con comentario en t00004 se actualizan al comportamiento correcto y se quita la nota de defecto"

### S2 — `query: []` y ausencia de query son lo mismo
- **Status**: done
- **Files**: `packages/core/domain/param-inferrer.service.ts`
- **Gate**: test
- acceptance:
  - "Un GET con `query: []` recibe la misma heurística que un GET sin propiedad query"
  - "Ningún test existente de la familia param-inferrer se debilita"

### S3 — validate verde
- **Status**: done
- **Files**: (cadena)
- **Gate**: test
- acceptance:
  - "`bun run validate` exit 0 con el suelo de branches 70 intacto"

## acceptance

- "`bun run validate` verde con los dos defectos corregidos y sus tests de regresión al comportamiento correcto"
- "El comentario de defecto que t00004 dejó en el spec desaparece (ya no es defecto)"
