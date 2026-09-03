---
id: a00010
title: "Plan consolidado auditoría exhaustiva 2026-09-03 — bugs P1, IR SchemaGraph, AST, fusión híbrida"
kind: audit
date: 2026-09-03
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00009
related:
  - f00010
  - f00011
  - x00012
  - x00013
  - x00014
  - x00020
  - x00021
supersedes:
  - a00008
---

# a00010 — Plan consolidado auditoría exhaustiva 2026-09-03

Esta propuesta **consolida** dos auditorías previas en una hoja de ruta
ejecutable:

1. **`a00009` (2026-09-03)** — hallazgos operativos de CLI, scanners, core,
   UI y plugin (cerrada parcialmente; quedan BUG-005…014 y FEAT/REF/TEST).
2. **Auditoría externa solicitada por el usuario (2026-09-03)** — auditoría
   independiente del código que re-puntúa el proyecto por sección,
   encuentra bugs nuevos (pathFields→query, Gin HEAD/OPTIONS, Laravel
   resource singular, Spring `src/main/kotlin`, singleton scanners con
   `Map<string, T>`) y propone arquitectura nueva (AST por lenguaje,
   SchemaGraph, EndpointMerger, IR rico, provenance/confidence, monorepos).

Sustituye como **foto de plan** a `a00008` (2026-08-29, gates/DoD) y a
`a00009` (2026-09-03, operativa). El árbol de proposals gana una sola
fuente de verdad para el cierre.

---

## 1. Snapshot auditado

- **Rama**: `develop` · **HEAD**: `957bebe` (1 commit ahead de `3f01abb`).
- **Estado del working tree al empezar**: limpio salvo por los
  untracked `a00009`, `f00010`, `f00011`, `x00012`, `x00013`, `x00014`,
  `x00020`, `x00021` — auditorías y propuestas en `ready/`.
- **Typecheck actual**: 6/6 secciones verdes.
- **Tests**: 2716+ pasan; cobertura 83.96 / 73.38 / 88.43 / 85.42
  (stmts / branches / funcs / lines) sobre suelos 73 / 62 / 82 / 75.

---

## 2. Bugs confirmados (contra HEAD actual)

Re-verificados con grep sobre el árbol:

| Id | Bug | Archivo:línea | Severidad | Origen |
|---|---|---|---|---|
| B-01 | `pathFields` se convierten también en `spec.query` (el bug del audit externo) | `packages/core/adapters/parsed-route-to-spec.adapter.ts:303` | **P1** | ext |
| B-02 | Gin filtra HEAD/OPTIONS por `HTTP_METHODS` incompleto | `packages/frameworks/scanners/gin.scanner.ts:34` | **P1** | ext |
| B-03 | Laravel resource usa `/{id}` en vez del parámetro singular | `packages/frameworks/scanners/laravel.scanner.ts` (resource map), `phoenix.scanner.ts:33-43`, `rails.scanner.ts:40-43` | **P1** | ext |
| B-04 | Rails `update` produce solo PUT (falta PATCH) | `packages/frameworks/scanners/rails.scanner.ts:42` | **P1** | ext |
| B-05 | Spring Boot sólo entra por `src/main/java`; `src/main/kotlin` ignorado | `packages/frameworks/scanners/springboot.scanner.ts:detect` (no busca `kotlin/`) | **P1** | ext |
| B-06 | Singleton mutable en 4 scanners: Fastify (`schemas`), Hono (`validators`), Fiber (`bodyStructs`), Rust (`bodyStructs`) | `*.scanner.ts:127/116/84/111` | **P1** | ext |
| B-07 | BUG-005…014 de `a00009` siguen abiertos (regex en stdout, push stderr leak, bin doble, basename env, runner process.cwd, validate-json url array, dry-run frameworks[], namespace muerto, bin cache sin TTL) | varios | P2-Bajo | a00009 |
| B-08 | DOBLE DECLARACIÓN `forceFramework` resuelta en orchestrator (un sólo contrato) | OK ✓ | — | ext |
| B-09 | MCP dependency `file:../../../../mcp-vertex/...` sigue en config; `p00007` blocked | `package.json#workspaces`, `.mcp.json` | P0 | a00008 |

**Bugs del audit externo que YA están cerrados** por el trabajo
reciente (revisar antes de duplicar):

- `forceFramework` con orden de parámetros inconsistente → `r00010`
  arregló el orchestrator; los call-sites en CLI ya respetan el orden.
- `--open` roto, gate `test-all`, 4 `JSON.parse`, plugin build,
  `runner.helper`, paths.service singleton → `x00012`, `x00013`,
  `x00014`, `x00020`, `x00021`, `r00010` (7 commits en HEAD).

---

## 3. Diseño del cierre

### 3.1 Principios rectores

- **State lives in `ScanResult` or `DiscoveryContext`**, not in scanners.
  Esto se aplica por scanner (S2) y por orquestador.
- **`pathFields` ⇒ path only, never query**. Los path params son una
  cosa conceptualmente distinta; unirlos es un bug semántico.
- **IR se separa en `RouteGraph` + `SchemaGraph` + `Operation`**.
  Esto baja el techo del producto para OpenAPI/HAR/Bruno/Insomnia.
- **Provenance + confidence** desde el día uno, en TODA detección
  (incluyendo OpenAPI, ya veterano).
- **Mejor regex que ninguna** cuando ya no escala; AST por lenguaje
  donde da más retorno (TS primero → 6 scanners).

### 3.2 Slices atómicos

Cada slice es una unidad DoD-verde con su propuesta derivada. Las
propuestas derivadas se abren en `ready/` en paralelo y se cierran una
a una. Los hallazgos de la auditoría externa se distribuyen así:

| Slice | Propuesta derivada | Cierra | Estimación |
|---|---|---|---|
| **S1** | `x00022` fix(adapter): pathFields ⇒ path only, nunca query | B-01 | pequeño |
| **S2** | `r00011` refactor(scanners): state lives in ScanResult, eliminar Maps singleton | B-06 | medio |
| **S3** | `x00023` fix(scanners): Gin HEAD/OPTIONS + Laravel/Rails singular + Rails PATCH | B-02, B-03, B-04 | pequeño |
| **S4** | `x00024` fix(scanner): Spring Boot escanea `src/main/kotlin` + multiline annotations | B-05 | pequeño |
| **S5** | `r00012` feat(core): EndpointMerger para proyectos híbridos con provenance | ext-FEAT-009 | medio |
| **S6** | `r00013` feat(core): SchemaGraph — tipos anidados, refs, unions | ext-IR | grande |
| **S7** | `r00014` feat(scanners): AST TypeScript compartido por Express/Nest/Fastify/Hono/Next/tRPC | ext-AST | grande |
| **S8** | `t00003` test(e2e): dos proyectos mismo framework simultáneos | ext-TEST | pequeño |

`S1`–`S4` cierran **bugs reales del HEAD actual**. `S5`–`S8` son las
mejoras estructurales del audit externo. `S9` (backlog vivo) cierra
esta auditoría derivando FEAT/REF/TEST pendientes de `a00009` que no
estén ya en `f00010`/`f00011`.

### 3.3 Excluido del plan (con motivo)

- **Plugin MCP dependencia externa (`file:../mcp-vertex/...`)** — vive
  en `p00007 blocked` y depende de que se publique `@mcp-vertex/core`.
  No es trabajo de esta propuesta.
- **Plan de releases / npm publish** — vive en `c00002 done` y en
  flujo de release del repositorio.
- **Nuevos frameworks (Axum, Chi, Echo, Elysia…)** — quedan como
  features separados en backlog, no son bugs.

---

## 4. Slices — diseño por slice

### S1 — pathFields ⇒ path only, nunca query

- **Archivos**: `packages/core/adapters/parsed-route-to-spec.adapter.ts`.
- **Cambio**: las `pathFromRules` actuales, que se concatenan a
  `spec.query`, deben ir a `spec.pathParams` (nuevo campo) o al
  `displayName`/`description` del endpoint. **Nunca a `spec.query`.**
- **Tests**:
  - Unit: `tests/core/adapters/parsed-route-to-spec.spec.ts` con un
    fixture Fastify/Hono que declare `pathFields`; verificar
    `spec.query` queda **vacío** y el path param se documenta aparte.
  - E2E: `tests/e2e/fastify.test.ts` con un endpoint
    `GET /users/{id}` que tenga un schema con `location: 'path'`;
    verificar que la colección NO lleva `?id=` en la URL.
- **Definition of done**: nuevo campo `IEndpointArgsSpec.pathParams`
  en `packages/contracts/interfaces/core/postman.interface.ts`;
  exporter Postman los pinta como `variable` (path variable); OpenAPI
  exporter los pinta como `parameters` con `in: path`.

### S2 — State lives in ScanResult, no en scanners

- **Archivos**:
  - `packages/frameworks/scanners/fastify.scanner.ts`
  - `packages/frameworks/scanners/hono.scanner.ts`
  - `packages/frameworks/scanners/fiber.scanner.ts`
  - `packages/frameworks/scanners/rust.scanner.ts`
- **Cambio**: el `Map<routeKey, T>` actual se mueve a un objeto
  `IScanContext` que **se construye al inicio de `scan()`** y se
  descarta al final. La signature cambia a
  `scan(match, ctx): Promise<ParsedRoute[]>` con
  `ctx: { schemas?; validators?; structs? }` opcional por scanner.
- **Tests**:
  - E2E `tests/e2e/concurrent-projects.test.ts` ya cubre el caso
    Fastify vs Fastify: ahora verificar también Hono vs Hono, Fiber
    vs Fiber, Rust vs Rust.
  - Verificar: tras un scan que declare `POST /users` con schema A y
    un segundo scan que declare `POST /users` sin schema, el primer
    resultado NO contiene schema A.
- **Definition of done**: `private readonly` mutable fields fuera de
  las 4 clases; lint nuevo `lint:no-instance-mutable-maps-in-scanners`
  lo enforza para que no vuelva.

### S3 — Gin HEAD/OPTIONS, Laravel/Rails singular, Rails PATCH

- **Gin** (`gin.scanner.ts:34`): `HTTP_METHODS` se amplía con `head` y
  `options` (lowercase) — el regex ya los captura.
- **Laravel / Rails resource map**: la expansión de `resources :users`
  debe producir `/users/{user}` (singular del recurso), no `/users/{id}`.
  - Rails: añadir un mapa `singularize` o consumir el nombre del
    recurso directamente; el resource `:comments do resources :posts end`
    anida como `/users/{user_id}/posts` (no es scope de S3, queda
    registrado para refactor posterior).
  - Laravel: idem, pero verificando `php artisan route:list` style
    con `Route::resource('users', UserController::class)` →
    `/users/{user}`.
- **Rails update**: añadir una segunda entrada `update` con método
  PATCH además de PUT, manteniendo PUT por retro-compat.
- **Tests**:
  - `tests/frameworks/gin-scanner.spec.ts`: fixture con `.HEAD(...)`
    y `.OPTIONS(...)`; verificar que ambos llegan al output.
  - `tests/frameworks/rails-scanner.spec.ts`: fixture con
    `resources :users`; verificar `/users/{user}` (no `/{id}`).
  - `tests/frameworks/laravel-scanner.spec.ts`: idem para Laravel.

### S4 — Spring Boot `src/main/kotlin` + multiline annotations

- **Detect** (`springboot.scanner.ts`):
  - Aceptar también `src/main/kotlin/` y `src/main/kotlin` como
    evidencia; añadir artifact.
  - Bajar score (no es un blocker — el `pom.xml`/`build.gradle`
    sigue mandando).
- **Parser**: anotar que las annotations multilinea
  (`@RequestMapping(\n  value = "/api",\n  ...)`) son válidas.
- **Tests**:
  - Fixture nuevo `tests/smoke-fixtures/springboot-kotlin/`.
  - Verificar que `detect()` devuelve score ≥ 0.7 y que el
    route scanner produce las mismas rutas que un equivalente
    Java.

### S5 — EndpointMerger (proyectos híbridos)

- **Nuevo contrato** en `packages/contracts/interfaces/core/merge.interface.ts`:
  - `IEndpointMerger` con `merge(candidates): MergedEndpoint`.
  - `MergedEndpoint.routes[]` (todos los matchers) +
    `provenance: { route, body, auth, server, params }` indicando
    de qué scanner vino cada pieza.
- **Core**: nuevo servicio
  `packages/core/discovery/endpoint-merger.service.ts` con reglas
  explícitas:
  - `route.uri + route.method` ⇒ identidad primaria.
  - Body: gana el de mayor confianza (OpenAPI > Fastify schema >
    heurística regex).
  - Auth: gana el explícito sobre el deducido; si hay conflicto, warning.
- **Pipeline**: `generation.pipeline.ts` invoca el merger tras la
  detección híbrida; el `IGenerationResult` lleva `provenance` por
  endpoint.

### S6 — SchemaGraph (IR rico)

- **Nuevo modelo** en `packages/contracts/interfaces/core/schema.interface.ts`:
  - `SchemaNode` con `kind: 'scalar' | 'enum' | 'object' | 'array' |
    'tuple' | 'union' | 'intersection' | 'reference' | 'literal' |
    'nullable'`, `id`, `name?`, `children?`, `ref?`.
  - `SchemaGraph { nodes: Map<string, SchemaNode>; root: string }`.
  - `OperationSpec { request: SchemaNodeRef; responses: Map<status, SchemaNodeRef> }`.
- **Helpers** en `packages/core/schema/`:
  - `scalar.helper.ts` — mapea JS tipos / TypeBox / Zod / Pydantic.
  - `reference.helper.ts` — `$ref` resolution local primero,
    network opcional.
  - `union.helper.ts` — `oneOf` / `anyOf` / `allOf`.
- **Exporters**: OpenAPI exporter consume SchemaGraph nativo (no
  emite `items: string` cuando hay objeto anidado); Postman exporter
  aplana a su modelo conservando la mayor fidelidad posible.
- **Tests**: fixtures con objetos anidados, arrays de objetos,
  unions, refs cruzadas; golden tests por exporter.

### S7 — AST TypeScript

- **Dependencia**: `@typescript-eslint/parser` o
  `typescript` (compiler API, ya viene con la toolchain).
- **Frontend** en `packages/core/language-frontends/typescript/`:
  - `parse(file): TSFile` con `symbols`, `imports`, `decorators`,
    `literalCalls`, `assignments`.
- **Refactor**: Express, NestJS, Fastify, Hono, Next.js, tRPC
  consumen el frontend; los regex específicos se quedan sólo como
  fallback declarativo.
- **Costo**: el primer scanner migrado es el que más réditos da
  (Express o Nest). El refactor es iterativo.

### S8 — E2E: dos proyectos mismo framework simultáneos

- **Archivo**: `tests/e2e/concurrent-projects.test.ts` (extender).
- **Cobertura nueva**: Fastify A vs Fastify B, Hono A vs Hono B,
  Fiber A vs Fiber B, Rust A vs Rust B — con misma ruta y schemas
  contradictorios.
- **Asserciones**: tras el run concurrente, los resultados son
  puros (sin contaminación cruzada).

### S9 — Cierre de auditoría y backlog

- Esta propuesta se mueve a `done/audits/` con un bloque "Cierre
  2026-09-03" arriba, citando qué slices se cerraron, qué quedó
  fuera y qué propuestas derivadas siguen en `ready/`.
- `INDEX.md` se actualiza para reflejar el cierre.

---

## 5. Top 5 prioridades

1. **S1 pathFields ⇒ path only** — bug visible hoy; un usuario con
   cualquier framework ve `?id=123` donde no debe.
2. **S2 state in ScanResult** — bug oculto hoy; explota sólo con
   concurrencia o proyectos consecutivos del mismo framework.
3. **S3 Gin/Rails/Laravel correctness** — falsos negativos visibles.
4. **S4 Spring Boot Kotlin** — feature flag declarado y no
   implementado.
5. **S5/S6/S7** son estructurales; **S1–S4** son los bugs del
   HEAD. La división entre bug y mejora se respeta: **primero los
   bugs, luego la estructura**.

---

## 6. Cómo se ejecutará

- **Subagentes del orchestrator MCP**: cada slice se delega a
  `implementation-runner` con el `agent_lock` correspondiente.
- **DoD por slice**: `bun run validate` verde + el test focalizado
  del slice + commit Conventional Commits + push a `develop`.
- **Sincronización**: cuando un subagente entrega una slice, el
  orchestrator la marca en `a00010` (frontmatter `slices:` con
  `S1: status done`) y mueve la propuesta derivada a
  `done/<kind>/`.
- **Conflicto con paralelos**: si otro agente cierra una slice
  antes (como pasó en `a00008`), se acepta y se anota
  (`closes-by-other` en frontmatter).

---

## 7. Definition of done

- [ ] Slices S1–S4 cerradas con test focalizado verde.
- [ ] Slices S5–S8 ejecutadas al menos parcialmente (S6 y S7 pueden
      partirse en sub-slices S6.a, S6.b si el costo lo justifica).
- [ ] `bun run validate` verde tras cada slice.
- [ ] `a00010` se mueve a `done/audits/` con cierre narrado.
- [ ] `INDEX.md` actualizado.
- [ ] Commit y push de la propuesta misma al cerrar.

---

## 8. Referencias cruzadas

- `a00009` (operativa) — fuente de BUG-005…014 y FEAT-001…010.
- `f00010`, `f00011` (FEAT nuevos detectores / lenguajes) — viven
  en `ready/`; consumen evidencia de esta auditoría.
- `x00012`, `x00013`, `x00014`, `x00020`, `x00021` (fixes ya en
  HEAD) — citados como precedentes de cómo se cierran slices.
- `r00010` (paths.service) — precedente de cómo se cierra el
  singleton de los 4 scanners (S2).
- `p00007` (blocked) — MCP dependencia externa; fuera de scope.
