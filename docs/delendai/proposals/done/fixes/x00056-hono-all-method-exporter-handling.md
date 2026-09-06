---
id: x00056
title: "Hono `.all()` → exporters materializan el método 'ALL' (audit 2026-09-06 §13)"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-09-06
shippedIn:
  - 79b0a3d  # Hono `.all()` → method: "ALL" (parent commit, S1 in this slice)
  - fdc0171  # ALL-method helper + 4 exporters + OpenAPI marker + fixture + tests
  - 15a477e  # SUPPORTED_METHODS contract test: include 'ALL'
dependsOn:
  - aad6376
---

# x00056 — Materializar `method: 'ALL'` (centinela del contrato) en cada exporter

## Goal

Que las 5 exporters (Postman, OpenAPI, HAR, Bruno, Insomnia)
reconozcan `method: 'ALL'` — emitido por el scanner Hono a partir
de `app.all('/x', h)` desde el commit `aad6376` — y produzcan la
representación correcta para su formato destino.

## Why (audit 2026-09-06 §13)

`aad6376` cambió el scanner Hono de `"GET"` (incorrecto) a `"ALL"`
(semánticamente correcto). Pero ningún exporter sabe todavía qué
hacer con `"ALL"`. Si la colección sale mal:

- **Postman**: no hay método `ALL` en v2.1.0; el exporter debe
  emitir como `ANY` (soportado desde Postman 9) o expandir a los
  7 métodos estándar (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS).
- **OpenAPI**: no hay operación `all`; expandir es la opción
  correcta, con un `x-tanit-source: "hono.all"` para que el
  usuario sepa que vino de `.all()`.
- **HAR**: HAR es permisivo pero los clientes pueden no aceptar
  `"ALL"`; expandir es seguro.
- **Bruno**: el block `method` solo acepta verbos estándar;
  expandir.
- **Insomnia**: similar a Postman, sin método `all`.

Severidad: **P2** (la semántica ya está en el modelo, solo falta
materializar). Si no se hace, los exports con `.all()` siguen
saliendo mal (probablemente vacíos o con error en el importer
Postman).

## Approach

Cada exporter decide su materialización. No hay un único formato
correcto: Postman con `ANY` es más compacto, OpenAPI con 7
operaciones es más explícito.

### Política recomendada

- **Postman**: método `ANY` (la única opción soportada por
  Postman 9+ para "all methods"). Si la versión del schema es
  v2.0, expandir a 7.
- **OpenAPI**: 7 operaciones estándar con `x-tanit-source:
  "hono.all"` en cada una.
- **HAR, Bruno, Insomnia**: 7 métodos estándar, sin marker
  (estos formatos no tienen dónde poner metadata de origen).

## Slices

### S1 — Postman exporter: emitir `ANY`

- **Files**:
  - `packages/core/exporters/postman.exporter.ts`
  - `tests/core/exporters/postman-all-method.spec.ts` (nuevo)
- **Gate**: `bun run test:core`
- **Detalle**:
  - Si `spec.method === 'ALL'`, emitir `request.method = 'ANY'`.
  - Test: spec con method='ALL' en la fixture hono-mini →
    request Postman con method='ANY'.

### S2 — OpenAPI exporter: 7 operaciones con marker

- **Files**:
  - `packages/core/exporters/openapi.exporter.ts`
  - `tests/core/exporters/openapi-all-method.spec.ts` (nuevo)
- **Gate**: `bun run test:core`
- **Detalle**:
  - Si `spec.method === 'ALL'`, generar 7 paths con la misma
    URI, una por método estándar (GET/POST/PUT/PATCH/DELETE/
    HEAD/OPTIONS), cada uno con `x-tanit-source: "hono.all"`.
  - Test: spec con method='ALL' → 7 paths en el YAML.

### S3 — HAR / Bruno / Insomnia: 7 métodos

- **Files**:
  - `packages/core/exporters/har.exporter.ts`
  - `packages/core/exporters/bruno.exporter.ts`
  - `packages/core/exporters/insomnia.exporter.ts`
  - 1 test por exporter
- **Gate**: `bun run test:core`
- **Detalle**: igual que OpenAPI pero sin marker (estos formatos
  no tienen extensión metadata).

### S4 — fixture hono con `.all()`

- **Files**:
  - `tests/fixtures/hono-comprehensive/src/all.ts` (nuevo)
  - o un fixture dedicado `tests/smoke-fixtures/hono-all/`
- **Gate**: `bun run lint:fixtures`
- **Detalle**: 1 endpoint `app.all('/anything', …)` que cubre
  las 5 materializaciones. Esto evita que `.all()` vuelva a
  quedar sin tests porque "no hay fixture que lo cubra".

## Acceptance

5 exporters producen la forma correcta para `method: 'ALL'`.
Test de cada exporter verifica su materialización concreta.
`bun run validate` verde.

## Risks

- Postman `ANY` requiere Postman ≥ 9; los consumidores de la
  colección generada pueden tener versiones más viejas. El
  fallback es expandir a 7 métodos (lo que ya hace S3).
- `x-tanit-source` en OpenAPI es una extension; los importers
  genéricos la ignoran pero las herramientas que miran
  extensions (como Redoc) la muestran. Es comportamiento
  aceptable y reversible (se quita en cualquier momento).
