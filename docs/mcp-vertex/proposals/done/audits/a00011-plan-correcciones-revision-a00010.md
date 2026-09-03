---
id: a00011
title: "Plan de correcciones post-revisión a00010 — Rails, orchestrator, merger, schema 3.1 y observabilidad"
kind: audit
date: 2026-09-03
status: done
type: proposal
track: export-to-postman
dependsOn:
  - a00010
related:
  - a00009
  - a00010
---

> **Cierre 2026-09-03.** Los slices C-1 a C-9 quedaron implementados y
> verificados en `develop`. La validación final pasó los 6 typechecks,
> todos los gates de lint, 135 archivos de test con 2820 tests pasados y
> 1 omitido, 21/21 ejemplos válidos y el benchmark de escaneo. C-5 añade
> pruebas concurrentes con datos exclusivos para Hono, Fiber y Rust; C-6
> deriva `[controller]` desde `UsersController`; C-8 resuelve grupos Gin
> anidados; y C-9 hace coherentes score y evidence en Gin, Phoenix y
> Django.

# a00011 — Plan de correcciones post-revisión a00010

Esta propuesta **corrige las observaciones** que la revisión externa
(2026-09-03, post-a00010) dejó como deudas abiertas tras el cierre de
`a00010`. Se ejecuta en una segunda sesión sobre la misma rama `develop`,
sin reabrir `a00010` (que queda `done`).

El veredicto resumido de esa revisión:
- **Dirección técnica**: excelente (9,1/10).
- **Corrección de bugs concretos**: 7,8/10 (un bug nuevo Rails, otro
  IDiscoveryOrchestrator sin tocar, varios en EndpointMerger).
- **Rigor al declarar cerradas**: 6,2/10 (S3 no debe declararse cerrado
  en Rails; S8 en Hono/Fiber/Rust no reproduce realmente el bug).
- **Verificación independiente**: 4,5/10 (CI bloqueada por la
  dependencia `file:../mcp-vertex/...`, fuera del scope de este pase).

Los hallazgos se ejecutan por severidad (🔴 > 🟠 > 🟡), cada uno con su
slice atómica, su test focalizado, su commit Conventional Commits y su
push a `develop`.

---

## 1. Snapshot auditado

- **Rama**: `develop` · **HEAD al empezar**: `b6ca557` (cierre de a00010).
- **Estado del working tree**: cambios no commiteados de sesiones
  paralelas en ~24 ficheros (scanners, tests, contratos) — se miran
  antes de tocar y se acepta la baseline tal como esté en cada paso.
- **Typecheck actual**: 6/6 secciones verdes.
- **Tests**: 2765+ pasan; cobertura por encima de los suelos.

---

## 2. Bugs y observaciones (severidad decreciente)

### 🔴 1. Rails singular param: regresión sobre S3

El commit `2551435` (S3) cambió `resources :users` para emitir
`/users/{user}` en vez de `/users/{id}`. Eso NO es correcto en Rails:
el comportamiento por defecto es `/:id`, configurable con
`param: :otro`.

Lo correcto:
- Volver a `/{id}` por defecto.
- Detectar `param: :nombre` en la línea del `resources` y aplicarlo.
- Mantener la duplicación `update` → PUT + PATCH (esa parte de S3 sí
  era correcta).

### 🔴 2. IDiscoveryOrchestrator: contratos cruzados sin tocar

`packages/contracts/interfaces/core/discovery.interface.ts` declara:
```ts
forceFramework(framework: string, projectRoot: string)
```
mientras la implementación en `discovery.orchestrator.ts` espera:
```ts
forceFramework(projectRoot: string, framework: string)
```
Y existe una segunda `IDiscoveryOrchestrator` (más corta) en
`scanner.interface.ts` que ni siquiera expone ese método.

Esto sigue siendo P1: TypeScript no detecta el intercambio y un
implementador externo perfectamente conforme con el contrato público
recibiría argumentos invertidos sin decir nada.

Fix:
- Unificar a una sola interfaz en `scanner.interface.ts` (casa del
  scanner, evita que dos módulos la declaren distinto).
- Cambiar la firma a objeto nombrado:
  `forceFramework(args: { projectRoot: string; framework: string }): Promise<IDetectedFramework | null>`.
- Eliminar la declaración duplicada de `discovery.interface.ts`.
- Actualizar call-sites en CLI (`generate.script.ts`, `push.script.ts`,
  `ui.script.ts`, `watch.script.ts`).

### 🔴 3. EndpointMerger: identidad contextual

El comentario dice "identidad = method + URI" pero el código usa:
```ts
endpointKey({ method, uri, name })
```
que mete `name` en la clave. Resultado:
- `POST /users` con `name: "Create Users"` (Express)
- `POST /users` con `name: "Create a new user account"` (OpenAPI)
→ no se fusionan.

Fix:
- Detectar `needsNameToDisambiguate(framework)` (ya existe) y usar:
  - `REST`: `(method, uri)` como clave.
  - `RPC multiplexado` (GraphQL, tRPC): `(method, uri, name)`.

### 🔴 4. EndpointMerger: field merge por `fieldName` choca entre locations

`Map<string, IValidationSpec>` keyed por `fieldName` mezcla:
- `path.id`
- `query.id`
- `body.id`
- `header.id`

Fix: clave compuesta `${field.location}:${field.fieldName}`.

### 🔴 5. EndpointMerger: `mergeFieldSpecs()` no cumple su contrato

El comentario promete:
- `minLength` 3 vs 5 → gana 5.
- Conflictos de `type` → warning.
- Intersección de `enum`.

Pero la implementación solo compara `required`, `ranking del tipo` y
presencia de `format`. Falta:
- `minimum` (max de mínimos)
- `maximum` (min de máximos)
- `minLength` / `maxLength`
- `pattern` (intersección o más restrictivo)
- `enumValues` (intersección; warning si vacía)

Y la heurística `integer > number > string > object` no es válida:
dominios disjuntos. Para `type` conflictivo → ganar por
`confidence`/`provenance` y emitir warning.

### 🔴 6. SchemaGraph: `nullable` no es OpenAPI 3.1

El exporter emite:
```yaml
{ ...inner, nullable: true }
```
OpenAPI 3.1 usa JSON Schema 2020-12: nulabilidad = `type: ["T", "null"]`
o composición. `nullable: true` está deprecado en 3.1.

Fix: el `buildOperation` del exporter produce:
```ts
{ type: inner.type === "scalar" ? [scalar, "null"] : undefined, ...rest }
```
o `oneOf: [{...inner}, {type: "null"}]` para object/unión.

### 🔴 7. SchemaGraph: interfaces duplicadas

`packages/contracts/interfaces/core/schema.interface.ts` define dos
veces cada uno de: `IScalarOptions`, `ICompositeOptions`,
`IReferenceOptions`, `ICompositeNodeOptions`. TypeScript los fusiona,
pero es desorden que hay que limpiar antes de que más código importe.

Fix: deduplicar a una única declaración de cada uno.

### 🟠 8. Laravel singularizer naïve

`users → user` está bien; `categories → categorie`, `statuses → statuse`,
`people → people` no. Hace falta un pluralizer real.

Fix: dependencia `pluralize` (npm) o implementar `pluralize/singularize`
con las reglas del inglés para casos comunes + fallback a `{id}` cuando
el singularizer falla o produce una forma degenerada.

Además: si `Route::resource(..., param: :otro)` aparece, respetarlo.

### 🟠 9. Tests concurrentes Hono/Fiber/Rust no reproducen la contaminación

Los fixtures no llevan `zValidator` / `BodyParser<T>` / `web::Json<T>`
distintos y las aserciones son sólo `metrics.routes > 0`.

Fix: copiar exactamente el patrón Fastify:
- Hono: dos `zValidator` con campos exclusivos (`tag_a` / `tag_b`).
- Fiber: dos `BodyParser<CreateA>` / `BodyParser<CreateB>`.
- Rust: dos structs `web::Json<CreateA>` / `web::Json<CreateB>`.

Aserciones cruzadas negativas: `A` contiene `tag_a`, NO contiene `tag_b`;
`B` contiene `tag_b`, NO contiene `tag_a`.

### 🟠 10. Spring multilínea: aún sin arreglar

`@GetMapping(path = "/users", produces = "...")` no se parsea porque el
regex aplica línea por línea.

Fix: o balanced annotation block, o pre-merge de líneas hasta cerrar
paréntesis balanceados antes de pasar el regex.

### 🟠 11. AST frontend TypeScript: orden top-down violado

Contrato: "el orden dentro de cada colección es el del archivo,
top-down". Implementación: stack LIFO en el walker (`pop()`).

Fix: usar queue o invertir el orden de push, o ordenar por `(line,
column)` al final del parse.

### 🟠 12. AST frontend: imports sin bindings locales

`import { Router as R } from "express"` se pierde el alias. Para llegar
al grafo de mounts cross-file, esto es imprescindible.

Fix: añadir a `TSImport`: `localNames: { local: string; imported: string;
isDefault: boolean }[]`. Walker ya recoge esa info.

### 🟠 13. AST frontend: `parseAstSafe()` se traga el error

El comentario dice que el error se reporta; el código devuelve `null`
silencioso.

Fix: añadir `diagnostics?` a `IScanResult` con `{ file, severity,
reason }`.

### 🟠 14. SchemaGraph en fronteras de proceso: `ReadonlyMap` no serializa

Si el grafo cruza MCP / JSON / UI / cache, `JSON.stringify(new Map(...))`
lo pierde.

Fix: definir un DTO serializable (`nodes: Record<string, ISchemaNode>`)
para el límite de proceso. Mantener `Map` internamente.

### 🟠 15. `frameworkConfidence` no se respeta en `sortCandidates()`

`EndpointMerger` acepta tabla configurable de confidence, pero
`sortCandidates` sigue usando la constante global.

Fix: usar siempre la tabla del merger, en todas las comparaciones.

### 🟡 16. Evidence weight ≠ score (Gin `main.go` sin cmd)

Gin detecta `score = 1` con suma de evidence = 0.9. El contrato
describe `weight` como incremento al score; deben sumar a `score`.

Fix: contract test + clamp a `[0, 1]`.

### 🟡 17. CI bloqueada por `mcp-vertex` sibling path (fuera de scope aquí)

Vive en `p00007 blocked`. No hacer nada en esta pasada; sólo dejarlo
documentado.

### 🟡 18. Nomenclatura documental: S7 ≠ "AST todo migrado"

Commit S7 deja claro: sólo Express migrado. Renombrar la heading
interna y la propuesta derivada a "S7.a — AST TS frontend + Express
migration" para que no induzca a error.

### 🟡 19. ASP.NET path constraints (`{id:int}`, `{id:guid}`) y
`[Route("api/[controller]")]` no se resuelven. El audit externo lo
marca como siguiente paso. Entra aquí como sub-scope: añadir el path
constraint y el placeholder token parsing.

### 🟡 20. Gin nested groups como grafo

`api := r.Group("/api")` + `users := api.Group("/users")` debería
producir `/api/users` resolviendo el grafo de prefixes; hoy conserva sólo
el último. Ajustar `groupPrefix` a `Map<symbol, prefix>` y propagar en
el match del call.

---

## 3. Diseño del cierre

### 3.1 Principios rectores

- **El merger sigue method+uri como identidad REST** y `(method, uri,
  name)` para RPC multiplexado. Lo decide
  `needsNameToDisambiguate(framework)`.
- **El field merge** usa clave compuesta `location:fieldName` con
  resolución real de `minimum/maximum/minLength/maxLength/pattern/enum`.
- **El IR SchemaGraph** se vuelve a serializar como objeto plano en
  todas las exportaciones MCP / JSON / UI.
- **OpenAPI 3.1** en el exporter: nulabilidad con `type: [T, "null"]`,
  jamás `nullable: true`.
- **`IDiscoveryOrchestrator`** vive en `scanner.interface.ts` con
  firma de objeto nombrado. La interfaz duplicada se borra.
- **Rails vuelve a `/:id` por defecto**; soporta `param:` cuando
  esté; PATCH extra para `update` se queda.

### 3.2 Slices atómicos

| Slice | Cubre | Tamaño |
|---|---|---|
| C-1 | 🔴 1, 8 — Rails/Laravel singular param real | pequeño |
| C-2 | 🔴 2 — IDiscoveryOrchestrator unificado | pequeño |
| C-3 | 🔴 3, 4, 5, 15 — EndpointMerger identidad + fields + confidence | medio |
| C-4 | 🔴 6, 7, 14 — SchemaGraph nullable 3.1 + interfaces duplicadas + DTO serializable | medio |
| C-5 | 🟠 9 — Tests concurrentes Hono/Fiber/Rust con `tag_a/tag_b` | pequeño |
| C-6 | 🟠 10, 19 — Spring multilínea + ASP.NET path constraints | pequeño |
| C-7 | 🟠 11, 12, 13 — AST frontend: orden, bindings, diagnostics | pequeño |
| C-8 | 🟠 20 — Gin nested groups como grafo | pequeño |
| C-9 | 🟡 16 — Evidence weight contract test | trivial |

### 3.3 Excluido (con motivo)

- **CI `mcp-vertex` sibling path** — vive en `p00007 blocked`.
- **Nuevos frameworks (Axum, Chi, …)** — backlog separado.
- **gRPC, WebSockets, AsyncAPI** — backlog separado.

---

## 4. Definición de done

- `bun run validate` verde tras C-9.
- Las 9 slices abiertas en `ready/`, cada una commiteada y pusheada.
- Comentarios de los slices anteriores actualizados (C-7 deja S7 ya
  como "PoC AST TS + Express migrated" en vez de "AST done").
- `a00011` se mueve a `done/audits/` con cierre narrado.
- `INDEX.md` actualizado.

---

## 5. Cómo se ejecuta

Cada slice se delega a un subagente `implementation-runner` con
instrucciones precisas. Yo (orquestador) verifico entre slices:
- `bun run typecheck` antes de commitear.
- `bun run test:coverage` antes de mergear.
- Cualquier regresión que aparezca se anota en frontmatter y se cierra
  antes de pasar al siguiente slice.

Cuando los 9 sub-slice estén verdes, `a00011` se archiva.
