---
id: x00036
title: "ASP.NET coverage: HttpHead y HttpOptions no se descartan"
kind: fix
status: ready
type: proposal
track: general
date: 2026-09-05
---

# x00036 — ASP.NET coverage: HttpHead y HttpOptions no se descartan

## Goal

Eliminar el bug confirmado en `packages/frameworks/scanners/aspnet.scanner.ts`
por el cual los atributos `[HttpHead]` y `[HttpOptions]` se detectan en la
regex METHOD_ATTR_RE pero después se descartan porque `HTTP_METHODS` solo
contiene los cinco verbos "principales".

## Why

`packages/frameworks/scanners/aspnet.scanner.ts:17`:

```ts
const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];
```

`packages/frameworks/scanners/aspnet.scanner.ts:86`:

```ts
const METHOD_ATTR_RE = /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|HttpHead|HttpOptions)\s*(\([^)]*\))?\]/g;
```

`packages/frameworks/scanners/aspnet.scanner.ts:225` y `:294`:

```ts
if (!HTTP_METHODS.includes(method)) continue;
```

Resultado: una action declarada como `public IActionResult Health() => Ok();`
con `[HttpHead]` se ignora silenciosamente. HEAD es importante para health
checks de Kubernetes/load balancers, OPTIONS es el método del preflight CORS.
El usuario no recibe la ruta, el collection Postman/OpenAPI queda incompleto,
no hay warning de evidence explicando por qué se descartó.

Bug pequeño pero confirmado en código actual (no estado transitorio).

## Non-goals

- No añade TRACE/CONNECT/PATCH-subrange (verbos exóticos).
- No cambia la representación interna del método; se mantiene el lower-case
  ya en uso por el resto de los scanners.
- No introduce metadata de "método derivado del nombre" (e.g. action
  `Health` → GET). Eso es otro slice (x00039 candidato).

## Slices

- global_gate: lint

### S1 — Ampliar HTTP_METHODS a los siete verbos

- **Status**: pending
- **Files**: `packages/frameworks/scanners/aspnet.scanner.ts`
- **Gate**: type
- **Acceptance**: `HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"]`. Los dos `if (!HTTP_METHODS.includes(method)) continue;` aceptan los nuevos verbos.

### S2 — Tests: scanner reconoce [HttpHead] y [HttpOptions]

- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `tests/frameworks/aspnet-scanner.spec.ts`
- **Gate**: lint

### S3 — Fixture smoke: controller ASP.NET con MapHead y MapOptions

- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `tests/smoke-fixtures/aspnet-http-head-options-mini/`
- **Gate**: e2e

## Acceptance

- `[HttpHead]` produce un endpoint con `method: "head"`.
- `[HttpOptions]` produce un endpoint con `method: "options"`.
- Los métodos previos (get/post/put/delete/patch) no regresionan.
- `bun run validate` verde.
