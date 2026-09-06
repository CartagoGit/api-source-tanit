---
id: r00016
title: "SchemaGraph view derivation — EndpointSpec.fields becomes a view of SchemaGraph, not another source of truth"
kind: refactor
status: done
type: proposal
track: api-source-tanit
date: 2026-09-06
shippedIn:
  - 88a5dfe
dependsOn: []
---

# r00016 — SchemaGraph view derivation

## Goal

Hoy `EndpointSpec` mantiene **dos** representaciones de la
misma información:

1. `EndpointSpec.schema?: ISchemaGraph` — grafo tipado con
   soporte nativo para `scalar | enum | object | array |
   tuple | union | intersection | reference | literal |
   nullable`, con `references` cruzadas y `constraints`
   (min/max, pattern, length, format, etc.).
2. `EndpointSpec.fields: EndpointField[]` — lista plana con
   `{name, in, type, required, description, example}` que
   todos los exporters consumen directamente.

El problema: los scanners calculan ambos. Cuando un scanner
añade un campo nuevo al grafo (p. ej. un `discriminator` en
un `union`, o un `format: "uuid"` en un `string`), tiene que
**repetir** el trabajo en `fields` — y, si el scanner se
olvida, los exporters ven un Postman collection que dice
`type: "string"` mientras el OpenAPI emite
`format: "uuid"`. Dos fuentes de verdad = drift garantizado.

El fix: que `fields` deje de ser una fuente y pase a ser una
**view derivada** del grafo. Mantenemos
`spec.schemaGraph?: ISchemaGraph` como la **única**
representación canónica y derivamos `fields` (y, por extensión,
`body` y `query`) perezosamente.

```ts
interface EndpointSpec {
  // source of truth — UN solo campo
  schemaGraph?: ISchemaGraph;

  // view derivada — generada on-demand a partir de schemaGraph
  readonly fields: ReadonlyArray<EndpointField>;

  // helpers expuestos como métodos
  fieldsFromGraph(graph: ISchemaGraph): readonly EndpointField[];
  flattenBody(): readonly EndpointField[];
  flattenQuery(): readonly EndpointField[];
}
```

`EndpointField` deja de tener `type`/`required` como
propiedades "libres": pasan a leerse del nodo del grafo al
que apunta el field. El grafo es quien sabe si un campo es
nullable, qué formato tiene, qué constraints aplica; el field
solo sabe **dónde vive** (path, `in: body|query|path|header`,
required derivado de la presencia en `required[]` del padre).

## Why

La auditoría 2026-09-06 (`a00018`, §6 / §9) lo deja
explícito:

> `SchemaGraph` admite scalar/enum/object/array/tuple/union/
> intersection/reference/literal/nullable con references y
> constraints, pero `EndpointSpec` sigue manteniendo ambos
> mundos (fields plano + schema). Migración: hacer de `fields`
> una **view derivada** del SchemaGraph, no otro source of
> truth.

Es el mismo patrón que ya arreglamos para `routes` per-service
(`a00018` §3.1, commit `787c13e`): si la métrica se puede
derivar de un campo que ya existe, **no se almacena**. Aquí
la métrica es `fields` y la fuente canónica es `schemaGraph`.

El coste de **no** hacerlo se nota en:

- **OpenAPI exporter**: cuando un scanner descubre
  `discriminator` para un `oneOf`, lo escribe en el grafo
  pero el `fields` plano lo pierde, así que Postman collection
  y OpenAPI divergen en cómo muestran el union.
- **Laravel FormRequest scanner**: las reglas de validación
  (`'email' => 'required|email'`, `'age' => 'integer|min:18'`)
  van al grafo como `format: "email"` + `minimum: 18`; el
  field plano solo guarda `type: "string"` + `required: true`
  y se pierde la semántica de validación.
- **Express Zod/Joi scanner** (recién aterrizado): idem —
  `.min(3).max(20)` se aplana a `type: "string"` y Postman
  no puede renderizar el constraint visualmente.
- **Fastify schema scanner**: igual — `type: "object",
  properties: { ... }, required: [...]` se duplica en `fields`
  y cualquier validación declarativa en Fastify (`ajv`)
  se pierde en el view plano.

Mientras `fields` siga siendo "lo que los exporters leen",
los scanners van a seguir optimizando para **ese** contrato
(en vez del grafo), y el grafo va a quedar cada vez más
desconectado del producto final.

## Non-goals

- **No se borra `fields` en este proposal.** Cada exporter
  (Postman, OpenAPI, HAR, Bruno, Insomnia, curl) consume
  `fields` directamente hoy. La migración es **uno a uno**:
  este proposal añade la nueva representación canónica
  (`schemaGraph`), expone los helpers de derivación, y deja
  `fields` marcado como **view deprecada** con un
  `@deprecated` JSDoc + un `console.warn` la primera vez que
  un exporter lo lee. La eliminación real queda para un
  proposal posterior (S4, deferred).
- **No se cambia `EndpointField` a un type-only**: sigue
  siendo un interface con campos. Lo que cambia es **quién
  lo rellena** — pasa de "el scanner, a mano" a "el helper
  `fieldsFromGraph()`, automáticamente".
- **No se reescribe la inferencia de tipos en los scanners.**
  Los scanners siguen construyendo el grafo como hoy (eso es
  lo que ya está bien hecho); este proposal solo cambia la
  capa de salida.
- **No se introduce un SchemaGraph en los exporters que aún
  no lo soporten.** Los exporters siguen leyendo `fields`;
  el que tenga `schemaGraph` presente y sepa interpretarlo
  (OpenAPI es el primero) usa el grafo directamente. El resto
  sigue con la view.

## Slices

### S1 — `schemaGraph` field + helpers de derivación

**Files**:
- `packages/contracts/src/endpoint.ts` (modificar `EndpointSpec`)
- `packages/contracts/src/schema/index.ts` (exportar `ISchemaGraph`)
- `packages/core/src/lib/schema/view.ts` (nuevo — `fieldsFromGraph`,
  `flattenBody`, `flattenQuery`)
- `packages/core/tests/src/lib/schema/view.spec.ts` (nuevo — tests
  unitarios de los helpers con grafos sintéticos)

**Gate**: `lint` + `type`.

**Detalle**:

1. Añadir `schemaGraph?: ISchemaGraph` a `EndpointSpec`
   (campo opcional para no romper specs existentes — los
   scanners que ya emiten `fields` siguen funcionando igual).
2. Marcar `fields: EndpointField[]` con `@deprecated
   "View derived from schemaGraph via fieldsFromGraph().
   Will be removed in r00016-S4. Migrate exporters to read
   schemaGraph directly or call fieldsFromGraph()."`.
3. Implementar `view.ts`:

   ```ts
   export function fieldsFromGraph(
     graph: ISchemaGraph
   ): readonly EndpointField[] {
     // walk graph, emit one EndpointField per leaf-property
     // of an object, per tuple element, per union arm.
     // Honor 'in' by where the parent was attached
     // (body | query | params | headers).
   }

   export function flattenBody(
     spec: EndpointSpec
   ): readonly EndpointField[] { ... }

   export function flattenQuery(
     spec: EndpointSpec
   ): readonly EndpointField[] { ... }
   ```

   Los helpers son **puros** — reciben un grafo y devuelven
   un array. Sin side effects, sin caché. La caché, si hace
   falta, la añade el caller (en S2 con el scanner enrichment).
4. Tests cubren: scalar primitive, object con `required`,
   array de objects, union con discriminator, intersection,
   reference (`$ref`) resolviendo al nodo apuntado, literal
   (`"foo" | "bar"`), nullable (`string | null`), enum con
   `format`.

### S2 — Scanner enrichment (Laravel, Express Zod/Joi, Fastify)

**Files**:
- `packages/core/src/lib/scanners/laravel/form-request.ts` (adjuntar
  `schemaGraph` además del `fields` actual)
- `packages/core/src/lib/scanners/express/zod-joi.ts` (id.)
- `packages/core/src/lib/scanners/fastify/schema.ts` (id.)
- `packages/core/tests/src/lib/scanners/laravel/form-request.spec.ts`
  (nuevo caso: spec lleva `schemaGraph` + `fields` consistente)
- `packages/core/tests/src/lib/scanners/express/zod-joi.spec.ts` (id.)
- `packages/core/tests/src/lib/scanners/fastify/schema.spec.ts` (id.)

**Gate**: `lint` + `type` + `e2e`.

**Detalle**:

1. Cada scanner empieza por el grafo (es lo que ya hace
   internamente — solo cambia la **salida**): ahora adjunta
   el `ISchemaGraph` construido al `EndpointSpec` resultante
   **además** de seguir emitiendo `fields` para no romper
   exporters.
2. Cada spec recién construida se valida con un test nuevo
   `graphAndFieldsAreConsistent(spec)` que comprueba que
   `fieldsFromGraph(spec.schemaGraph)` produce exactamente
   el mismo array que `spec.fields`. Si falla, el scanner
   está mintiendo en una de las dos representaciones y el
   test lo caza antes de que llegue al exporter.
3. Smoke fixtures: añadir un caso Laravel con validación
   rica (`'email' => 'required|email'`,
   `'age' => 'integer|min:18'`) para que el e2e vea la
   mejora visual del grafo cuando aterrice S3.

### S3 — OpenAPI exporter consume `schemaGraph` con fallback a `fields`

**Files**:
- `packages/frameworks/src/exporters/openapi/emitter.ts` (rama
  `if (spec.schemaGraph) ... else ...`)
- `packages/frameworks/tests/src/exporters/openapi/emitter.spec.ts`
  (nuevos casos: spec con `schemaGraph` solo / spec con
  `fields` solo / spec con ambos / spec sin ninguno)

**Gate**: `lint` + `type` + `e2e`.

**Detalle**:

1. En `emitter.ts`, el helper que hoy recorre `spec.fields`
   para construir el `requestBody.content."application/json".schema`
   pasa a:

   ```ts
   if (spec.schemaGraph) {
     return emitSchemaFromGraph(spec.schemaGraph);
   }
   // legacy fallback — will be removed in r00016-S4
   return emitSchemaFromFields(spec.fields);
   ```

2. `emitSchemaFromGraph` produce directamente
   `components.schemas.*` con `$ref` cuando aplica, preserva
   `oneOf` / `anyOf` / `allOf`, y mete los constraints
   (`minimum`, `maximum`, `pattern`, `format`, `minLength`,
   `maxLength`, `enum`) en el sitio correcto del JSON Schema.
3. Tests pin **ambas** ramas: con y sin `schemaGraph`.
   Esto es importante porque durante el rollout va a haber
   specs viejas (sin grafo) mezcladas con specs nuevas
   (con grafo) — el exporter tiene que comportarse igual
   en ambos casos **al byte** mientras no se haya migrado
   un scanner concreto.
4. Snapshot diff: el test e2e del OpenAPI exporter compara
   el JSON emitido con la fixture golden. Si la rama
   `schemaGraph` produce algo distinto (aunque sea "mejor"),
   se actualiza la golden **explícitamente** con un commit
   dedicado y un mensaje que diga "migrated from fields to
   schemaGraph, expected diff because graph preserves X".

### S4 — Eliminar `fields` (DEFERRED)

**No se hace en este proposal.** Queda como un proposal
hijo posterior (probablemente `r00017-fields-removal`)
- que se abrirá **únicamente** cuando todos los exporters
estén migrados. En ese momento:

1. `EndpointField` deja de existir como tipo público.
2. Cada exporter lee directamente del `schemaGraph` (o de
   `fieldsFromGraph()` si necesita el array plano por
   compatibilidad con Postman v2.1, que no soporta
   `oneOf`/`anyOf`).
3. Los scanners dejan de emitir `fields`.
4. El `@deprecated` JSDoc se convierte en error de
   `noImplicitAny`.

La regla para abrir `r00017`: cada exporter tiene su test
S3 verde (rama `schemaGraph` y rama `fields` produciendo el
mismo output). Cuando los 6 exporters (Postman, OpenAPI,
HAR, Bruno, Insomnia, curl) pasen, S4 es seguro.

## Acceptance

- `pnpm run -w typecheck` verde (los `EndpointSpec.fields`
  siguen existiendo como `@deprecated`, no rompen tipos
  aguas abajo).
- `pnpm run -w lint` verde.
- Tests nuevos verdes:
  - `packages/core/tests/src/lib/schema/view.spec.ts` (S1,
    ≥ 8 casos: scalar, object, array, union, intersection,
    reference, literal, nullable).
  - 3 specs de scanner con `graphAndFieldsAreConsistent` (S2).
  - 4 specs de `openapi/emitter` con/sin `schemaGraph` (S3).
- `tests/e2e/cli-export.spec.ts` verde — el smoke fixture
  Laravel con validación rica sigue produciendo el mismo
  Postman collection (porque la rama legacy sigue activa
  en exporters no migrados).
- `docs/delendai/proposals/INDEX.md` regenerado
  (`pnpm proposals:sync`) reflejando `r00016` en `ready/`.

## Risks

1. **`schemaGraph` es más pesado que `fields` en memoria.**
   Un OpenAPI grande (cientos de endpoints, cada uno con un
   grafo de 50+ nodos con references) puede inflar el
   snapshot en memoria. Mitigación: `fieldsFromGraph`,
   `flattenBody`, `flattenQuery` son **puros y perezosos** —
   no se cachea el resultado, se recomputa si el caller lo
   pide. Si en profiling vemos que es un problema, S1 ya
   deja la puerta abierta a añadir un `WeakMap<ISchemaGraph,
   readonly EndpointField[]>` en `view.ts` sin cambiar la
   API pública.

2. **Drift silencioso entre `schemaGraph` y `fields` durante
   el rollout.** Mientras los exporters no estén migrados,
   las dos representaciones conviven. Si un scanner futuro
   modifica una y se olvida de la otra, vuelve el bug que
   estamos arreglando. Mitigación: el helper
   `graphAndFieldsAreConsistent(spec)` del S2 se ejecuta en
   los **tests** del scanner (no en producción, para no
   pagar el coste), y un script `pnpm run
   consistency:endpoint-spec` lo corre sobre los smoke
   fixtures en CI. Si rompe CI, el scanner está mintiendo.

3. **El grafo no cubre todo lo que `fields` expresa.** Hay
   campos opcionales en `EndpointField` que el grafo todavía
   no modela (`description` por nodo, `example`, `deprecated`
   por field). Mitigación: ampliar `ISchemaGraph` con esos
   tres atributos antes de S3, en un commit previo. Si se
   queda corto, el fallback a `fields` sigue siendo válido
   para esos casos puntuales — y el test S3 lo cubre.

4. **Migración de exporters uno a uno deja una ventana de
   "comportamiento distinto" entre los 6.** Hasta que
   Postman/HAR/Bruno/Insomnia/curl lean del grafo, solo
   OpenAPI se beneficia. Mitigación: S3 solo toca OpenAPI a
   propósito; los otros 5 siguen con `fields` plano y
   resultados idénticos al byte. Cuando se decida migrar
   cada uno, se abre un slice nuevo (`r00017-postman-from-graph`,
   etc.) con su propio DoD.