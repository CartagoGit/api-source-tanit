---
id: r00013
title: "LanguageIR universal — migrate Fastify and Hono scanners off regex/balanced-text"
kind: refactor
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-06
dependsOn:
  - x00048
  - r00014
---

# r00013 — LanguageIR universal para Fastify + Hono

## Goal

Que los scanners de Fastify y Hono consuman el mismo frontend
LanguageIR que ya consume Express (vía `x00048`). Hoy esos dos
frameworks siguen implementando su propio parsing con
regex + `findAllBalanced` + `findOutsideStrings` sobre el código
fuente — exactamente el patrón que LanguageIR universaliza y que
el producto quiere extirpar porque produce detecciones frágiles
frente al mismo patrón TS según el framework.

El contrato objetivo es una API única:

```ts
// packages/core/language-frontends/typescript/index.ts
export function extractRoutes(
  source: string,
  filename: string,
  framework: "express" | "fastify" | "hono" | "nestjs",
): IExtractedRoute[];
```

Y cada scanner hace:

```ts
const routes = extractRoutes(raw, file, "fastify");
for (const r of routes) emitEndpoint(r);
```

en lugar de mantener su propio walker sobre el AST/regex.

## Why (audit 2026-09-06 §5, §14, §15, §16)

Hoy los tres frameworks TS comparten la **misma forma sintáctica**
(`router.METHOD(path, handler)`) pero la consumen con tres
mecanismos distintos:

| framework | parser               | reconoce `.get` | `.all`   | chain `.get().post()` | `.route('/api', sub)` |
| --------- | -------------------- | --------------- | -------- | --------------------- | --------------------- |
| Express   | `x00048` (LanguageIR) | ✅              | ✅       | ✅                    | ✅                    |
| Fastify   | regex + balanced     | ✅              | ⚠️       | ❌                    | ⚠️ (sólo `app.route`) |
| Hono      | regex + balanced     | ✅              | ✅ (x56) | ⚠️ parcial            | ⚠️ (sólo `app.route`) |

La consecuencia es exactamente la asimetría que LanguageIR
existe para evitar:

- `app.get('/x', h)` funciona perfectamente en Express; en
  Fastify rompe con `findAllBalanced` cuando el path contiene
  caracteres escapados (`/x\:1`), cuando el handler está en una
  variable con scope raro, o cuando hay un `// comment` justo
  antes.
- `app.all('/x', h)` en Hono ya está bien (lo cerró `x00056`
  + `aad6376`), pero **la cobertura se hizo a mano, no gracias
  al IR**. Si alguien añade `.all()` a Fastify mañana, va a
  tener que volver a tocar el regex.
- `app.route('/api', sub)` en Hono y Fastify se queda en una
  búsqueda heurística por nombre (`"route"` está en el map de
  verbos conocidos). Cross-file + chain + prefix por decorador
  no entran en la heurística.
- Los scanners de Fastify/Hono siguen sin consumir `IImportBinding`
  (`Router as R`), `IConstantBinding` (`const M = "get"`) ni
  `IReexport` (sub-routers reexportados). Express sí.

Severidad: **P2 arquitectónico**, pero con coste de
mantenimiento tangible: cada vez que LanguageIR crece (x00048,
f00012, etc.), Fastify/Hono se quedan atrás automáticamente.

## Non-goals

- No romper scanners que ya funcionan (la regresión en
  `example-fastify/`, `example-hono/`, `tests/smoke-fixtures/`
  es inaceptable). El camino es **dual-emit**: durante el slice
  S3, los scanners emiten lo nuevo **y** lo viejo, y se compara
  en CI. Cuando las dos emisiones coinciden para todas las
  fixtures, se elimina el camino viejo.
- No migrar scanners que no son TS-flavored (Python, Go, Rust,
  PHP, Java, Kotlin, C#) — siguen con su propio scanner
  específico por framework.
- No reescribir Fastify para entender la cadena completa
  (`.get().post()` después de un `.use()` con plugin) en este
  slice. S1 sólo cubre el caso estándar; las chains complejas
  las cubre `r00014` (SymbolGraph cross-file).
- No tocar el contrato `ParsedRoute.framework` ni la
  materialización de exporters (`x00056` ya cerró esa parte).

## Approach

El LanguageIR frontend **ya existe** en
`packages/core/language-frontends/typescript/` (su contrato está
en `packages/contracts/interfaces/core/language/`). El trabajo
de este refactor es **encapsular** la lógica de "qué es una
ruta para framework X" en helpers AST-level y dar una API
unificada `extractRoutes()` que los tres scanners TS consumen.

### Paso 1 — `extractFastifyRoutesFromProgram`

Walker Babel que reconoce:

- `<receiver>.METHOD(<path>, <handler>)` para `METHOD ∈
  {get, post, put, delete, patch, options, head, all}`.
  `receiver` se valida contra la lista de routers Fastify
  importados (`fastify()`, `Fastify()`, `Router()` de
  `@fastify/router`).
- `<receiver>.route({ method, url, handler })` — la forma
  larga de Fastify. `method` puede ser string literal o array
  (`['GET', 'POST']`), que se expande a 2 endpoints.
- `<receiver>.route(<path>, <handler>)` — la forma corta
  (sobrecarga de `route`), válida desde Fastify v4.
- `<receiver>.register(<plugin>, { prefix })` — emite un
  `IRouterMount { prefix, target }` que `r00014` resuelve
  cross-file.

Emite `IExtractedRoute` con `framework: "fastify"`,
`method: "ALL"` para `.all()`, `method: "GET"` etc. para el
resto, igual que el export de `x00056` ya hace para Hono.

### Paso 2 — `extractHonoRoutesFromProgram`

Walker Babel paralelo al de Fastify, parametrizado sobre los
mismos métodos pero con dos particularidades Hono:

- **Chain**: `app.get('/a', h).post('/b', h)` es válido.
  El walker detecta el `CallExpression` raíz y visita la cadena
  completa, emitiendo un `IExtractedRoute` por método.
- **Mount**: `app.route('/api', subApp)` emite un
  `IRouterMount { prefix: '/api', target: subApp }` que el
  scanner resuelve a las rutas del sub-app (cross-file vive en
  `r00014`; intra-fichero funciona aquí).

Emite `IExtractedRoute` con `framework: "hono"`.

### Paso 3 — `extractRoutes()` unificado

Helper público en
`packages/core/language-frontends/typescript/index.ts`:

```ts
export function extractRoutes(
  source: string,
  filename: string,
  framework: "express" | "fastify" | "hono" | "nestjs",
): IExtractedRoute[];
```

Internamente despacha a
`extractFastifyRoutesFromProgram` / `extractHonoRoutesFromProgram`
/ `extractExpressRoutesFromProgram` (este último se extrae del
scanner Express como parte de S3). El helper vive en el
frontend para que los scanners no tengan que conocer Babel — el
contrato `IExtractedRoute` es agnóstico.

### Paso 4 — rewiring de scanners

`fastify.scanner.ts` y `hono.scanner.ts` pasan de:

```ts
import { findAllBalanced, findOutsideStrings } from "../../core/helpers/source-scan.helper.js";
// ... 200 líneas de regex + balanced parsing
```

a:

```ts
import { extractRoutes } from "../../core/language-frontends/typescript/index.js";
// ... 50 líneas de materialización de IExtractedRoute → ParsedRoute
```

El regex viejo sobrevive **solo como fallback** explícito:

```ts
let routes: IExtractedRoute[];
try {
  routes = extractRoutes(raw, file, "fastify");
} catch (e) {
  routes = legacyRegexParse(raw, file); // sólo si Babel revienta
}
```

Esto da la garantía de "no rompe scanners que ya funcionan"
documentada en Non-goals.

### Por qué NO un walker Babel custom en cada scanner

La razón por la que `x00048` consolidó el parseo en
`buildLanguageIR()` es el **single-parse**. Si cada scanner
mantiene su propio `parse()` + `traverse()`, perdemos ese
beneficio. El wrapper `extractRoutes()` debe reutilizar el
AST de `parseModule()` cuando esté disponible, y solo parsear
por su cuenta si el caller no le pasa el AST. Esto está en la
misma línea del universal §11 (frontend compartido).

## Slices

### S1 — `extractFastifyRoutesFromProgram`

- **Files**:
  - `packages/core/language-frontends/typescript/extract-routes-fastify.helper.ts` (nuevo)
  - `tests/frameworks/extract-routes-fastify.spec.ts` (nuevo)
- **Gate**: `bun run test:frameworks` + `bun run typecheck`
- **Detalle**:
  - Walker Babel que recibe un `Program` y emite
    `IExtractedRoute[]`.
  - Reconoce `get/post/put/delete/patch/options/head/all` sobre
    receivers identificados por:
    - `import Fastify from 'fastify'` → `Fastify()`
    - `import { Router } from '@fastify/router'` → `Router()`
    - `import fastify from 'fastify'` (default con rename) →
      cualquier nombre (vía `IImportBinding.importedName` de
      `x00048`).
  - Forma larga `route({ method, url })` con `method` string o
    array.
  - Forma corta `route(path, handler)`.
  - `.register(plugin, { prefix })` emite `IRouterMount`.
  - Tests focalizados: 8 verbos × 3 receivers (Fastify() /
    Router() / alias) + 4 formas largas + 4 `.register` con
    prefix.
  - Source-position preservada en `IExtractedRoute.range`.

### S2 — `extractHonoRoutesFromProgram`

- **Files**:
  - `packages/core/language-frontends/typescript/extract-routes-hono.helper.ts` (nuevo)
  - `tests/frameworks/extract-routes-hono.spec.ts` (nuevo)
- **Gate**: `bun run test:frameworks` + `bun run typecheck`
- **Detalle**:
  - Mismo contrato `IExtractedRoute` que S1.
  - Soporte de **chain**: `app.get('/a', h).post('/b', h)`
    emite 2 `IExtractedRoute` con el mismo receiver + scope
    compartido.
  - Soporte de `app.route('/api', subApp)` (mount cross-file,
    queda como `IRouterMount` para que `r00014` lo resuelva).
  - Validación de receiver: `import { Hono } from 'hono'` →
    `new Hono()` o `Hono()`. No es sensible a alias
    (`import { Hono as Tanit }`).
  - Tests focalizados: chain de 5 verbos, mount de 3 sub-apps,
    8 verbos × 2 receivers (Hono / alias).
  - `.all()` ya funciona en scanner Hono (x00056); ahora
    funciona en el IR, lo que es lo correcto.

### S3 — `extractRoutes()` + rewiring de scanners

- **Files**:
  - `packages/core/language-frontends/typescript/index.ts` (nuevo `extractRoutes`)
  - `packages/core/language-frontends/typescript/extract-routes-express.helper.ts` (nuevo — extrae la lógica actual del scanner Express)
  - `packages/frameworks/scanners/fastify.scanner.ts`
  - `packages/frameworks/scanners/hono.scanner.ts`
  - `tests/frameworks/extract-routes.spec.ts` (nuevo — verifica la API unificada)
- **Gate**: `bun run test:frameworks` + `bun run validate:examples` + `bun run typecheck`
- **Detalle**:
  - `extractRoutes(source, filename, framework)` despacha al
    helper correcto por framework.
  - Cuando el scanner ya tiene `program` (caso single-parse
    de `x00048` S3), `extractRoutes` consume `program` y evita
    el segundo `parse()`. Esto es lo que mantiene el beneficio
    AST-share que motivó `x00048` S3.
  - `fastify.scanner.ts` y `hono.scanner.ts` migran al
    helper. El regex viejo se queda detrás de un flag
    `legacyFallback` que solo se activa si Babel falla
    (`try/catch` explícito con logging en
    `IParseDiagnostic`).
  - Test crítico: el scan E2E de `example-fastify/` y
    `example-hono/` produce **exactamente** las mismas rutas
    que antes. La suite `bun run validate:examples` ya
    compara el JSON contra el snapshot — si cambia, falla.
    Mientras el JSON no cambie, el refactor es seguro.
  - Dual-emit durante 1 slice (este): la primera mitad del
    test corre el camino nuevo, la segunda mitad corre el
    regex viejo, y compara. Cuando llevan 10 runs idénticos
    en CI, se borra el regex viejo (slice siguiente, fuera
    de esta propuesta).

### S4 — fixtures de cobertura fastify-multi-router y hono-multi-router

- **Files**:
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
  - `docs/FRAMEWORKS.md` (tabla de cobertura actualizada)
- **Gate**: `bun run test:e2e` + `bun run lint:fixtures` + `bun run validate:examples`
- **Detalle**:
  - Cada fixture tiene 2 routers con prefijos distintos
    (`/users`, `/orders`) y al menos un patrón por framework
    que era frágil antes del refactor:
    - Fastify: `route({ method: ['GET', 'POST'], url: '/x' })`,
      `.register(sub, { prefix: '/v1' })`, alias
      `import Fastify from 'fastify'`.
    - Hono: chain `app.get('/a', h).post('/b', h)`,
      `app.route('/api', sub)`, alias
      `import { Hono as T } from 'hono'`.
  - Tests E2E ejecutan el binario contra cada fixture,
    validan que las rutas acaban en el prefijo correcto y
    que no hay prefijos cruzados (paralelo al S3 de `x00055`
    para Express).
  - `docs/FRAMEWORKS.md` actualiza la tabla de cobertura para
    reflejar que Fastify y Hono ahora consumen LanguageIR
    (la fila "parser" pasa de "regex/balanced" a
    "LanguageIR universal").

## Acceptance

`bun run typecheck` verde.

`bun run test:frameworks` verde con los nuevos
`extract-routes-fastify.spec.ts`,
`extract-routes-hono.spec.ts`, `extract-routes.spec.ts`.

`bun run test:e2e` verde con los nuevos
`fastify-multi-router.test.ts` y `hono-multi-router.test.ts`.

`bun run validate:examples` verde — los snapshots de
`example-fastify/` y `example-hono/` no cambian (refactor
invisible para el contrato `ParsedRoute`).

`bun run lint:fixtures` verde — las fixtures nuevas cumplen
el manifest.

`docs/FRAMEWORKS.md` actualizado: tabla de cobertura refleja
el cambio de "regex/balanced" a "LanguageIR universal" para
Fastify y Hono.

La API `extractRoutes()` está publicada y documentada (JSDoc
con ejemplo de uso + link al contrato `IExtractedRoute`).

## Risks

- **Coste AST**: parsear Babel es más caro que regex. Mitigación:
  el helper reutiliza el AST de `parseModule()` cuando el caller
  ya lo tiene (single-parse, igual que `x00048` S3). En el peor
  caso, el scan E2E añade ≤ 15% de latencia. Si el coste real es
  mayor, S3 deja el regex viejo activo en CI y solo cambia el
  contrato — la migración se difiere.
- **Babel API drift**: `@babel/parser` cambia entre majors. La
  mitigación es el patrón ya usado en `buildLanguageIR()`:
  `package.json#resolutions` fija la versión, y los tests
  pinned a sintaxis sintética detectan cualquier breaking
  change antes de que llegue a producción.
- **Regresión silenciosa en fixtures existentes**: el contrato
  `ParsedRoute` no cambia, pero el orden de emisión puede
  cambiar (Babel visita los nodos en source order; el regex
  antes dependía de heurística). Mitigación: `validate:examples`
  compara contra snapshots versionados; cualquier diff falla
  el CI antes de merge.
- **Cross-file mounts sin resolver**: S1 y S2 emiten
  `IRouterMount { prefix, target }` pero la resolución
  cross-file es responsabilidad de `r00014`. Si `r00014` no
  aterriza antes que el consumidor downstream (f00012, f00013),
  el mount queda como "router detectado, rutas no expandidas"
  — el mismo estado que hoy, sin regresión.
