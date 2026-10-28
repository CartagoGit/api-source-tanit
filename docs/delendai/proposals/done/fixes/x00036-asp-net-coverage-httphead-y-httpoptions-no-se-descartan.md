---
id: x00036
title: "ASP.NET coverage: HttpHead y HttpOptions no se descartan"
kind: fix
status: done
type: proposal
track: general
date: 2026-09-05
shippedIn:
  - 9807255  # fix(x00036): ASP.NET scanner accepts MapHead/MapOptions + tests + smoke fixture
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

- **Status**: done
- **Files**: `packages/frameworks/scanners/aspnet.scanner.ts`
- **Gate**: type
- **Detalle extra (9807255)**: además de extender `HTTP_METHODS`, había
  que extender la regex `MINIMAL_API_RE` para que `app.MapHead(...)` y
  `app.MapOptions(...)` también se reconocieran. La propuesta original
  mencionaba solo el check `HTTP_METHODS.includes`; en la práctica el
  filtro previo de la regex ya descartaba los verbos nuevos en el camino
  minimal-API, así que sin tocar la regex la mitad del fix era invisible.
- **Acceptance**: ✅ `HTTP_METHODS = ["get", "post", "put", "delete", "patch", "head", "options"]` y `MINIMAL_API_RE` extendida con `|Head|Options`.

### S2 — Tests: scanner reconoce [HttpHead] y [HttpOptions]

- **Status**: done
- **DependsOn**: [S1]
- **Files**: `tests/frameworks/aspnet-scanner.spec.ts`
- **Gate**: lint
- **Detalle (9807255)**: nuevo `describe("ASP.NET — full HTTP method coverage (x00036)")`
  con cinco tests — los cuatro de los verbos nuevos (controller + minimal API)
  y uno de no-regresión sobre los cinco verbos originales.

### S3 — Fixture smoke: controller ASP.NET con MapHead y MapOptions

- **Status**: done
- **DependsOn**: [S2]
- **Files**: `tests/smoke-fixtures/aspnet-mini/` (extendido, no se creó una nueva carpeta — los verbos nuevos caben en el fixture existente, evita fragmentar la suite).
- **Gate**: e2e
- **Detalle (9807255)**: `UsersController` gana `[HttpHead] Ping` y
  `[HttpOptions] Preflight`; `expected.json` lista los dos verbos nuevos
  como `HEAD /api/users` y `OPTIONS /api/users`.

## Acceptance

- `[HttpHead]` produce un endpoint con `method: "head"`. ✅
- `[HttpOptions]` produce un endpoint con `method: "options"`. ✅
- `app.MapHead` / `app.MapOptions` también detectados. ✅ (cubierto por
  el mismo slice; la propuesta original no lo nombraba pero era el mismo
  bug en otra forma).
- Los métodos previos (get/post/put/delete/patch) no regresionan. ✅
  (test de no-regresión añadido en el slice S2).
- `bun run validate` verde. ⏳ pendiente de Actions (x00027 / i00002
  bloquean la verificación end-to-end del último bullet); localmente
  typecheck + lint + tests pasan.
