---
id: r00015
title: "Confidence scoring end-to-end — cada endpoint y cada campo lleva confianza + razón"
kind: refactor
status: done
type: proposal
track: api-source-tanit
date: 2026-09-06
shippedIn:
  - 171f6ad
  - c3f92d7
  - bf2259b
dependsOn:
  - a00018
---

# r00015 — Confidence scoring end-to-end

## Goal

Llevar la noción de **confianza** desde la detección de frameworks
(hoy `IProjectScanner.detect()` ya devuelve `score` + `evidence`,
auditoría §16) hasta **cada `EndpointSpec`** y, con ello, hasta
los exporters (Postman, OpenAPI). El usuario debe poder mirar
una colección y distinguir de un vistazo:

- un endpoint **bien detectado** (confianza alta, sin razón);
- un endpoint **detectado pero heurísticamente** (confianza
  media/baja + razón legible).

El disparador concreto está en la auditoría §17 (Pages Router
Next.js). Hoy `packages/frameworks/scanners/nextjs.scanner.ts`
(`parsePageRouteFile`, líneas 365-400) hace esto:

```ts
const methods = new Set<string>();
for (const m of raw.matchAll(/(?:req\.method|request\.method)\s*(?:===|!==|==|!=)\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/gi)) {
  methods.add(m[1].toUpperCase());
}
for (const m of raw.matchAll(/case\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']\s*:/gi)) {
  methods.add(m[1].toUpperCase());
}
if (methods.size === 0) methods.add("GET");
for (const method of methods) {
  out.push({ method, uri: routePath, ... });
}
```

Cuando el handler es un `export default function handler(req, res)`
con un `switch (req.method)` de cinco ramas (`case "GET": …`,
`case "POST": …`, etc.) el scanner emite **5 endpoints
sintéticos**: `GET /api/foo`, `POST /api/foo`, `PUT /api/foo`,
`PATCH /api/foo`, `DELETE /api/foo`. Los 5 son **el mismo
handler**. Para Postman / OpenAPI esto es ruido: el cliente que
lea la colección verá cinco requests idénticos salvo por el
verbo, y no tiene manera de saber que no hay cinco rutas reales
sino una sola función sirviendo cinco verbos.

El usuario prefiere ver:

```text
ANY /api/foo
  confidence: low
  reason: "Pages Router handler method dispatch not statically resolved"
```

(una sola entrada con `method: "ALL"` —el mismo sentinel que ya
existe para Hono `.all()`, ver `postman.interface.ts:159`—,
confianza baja, y la razón que explica por qué). Es el mismo
contrato que Postman y OpenAPI ya saben pintar: `ANY` es la
forma de "este endpoint sirve cualquier método" y
`x-tanit-confidence` es la forma de "esto lo detectó Tanit con
matices".

## Why

La auditoría 2026-09-06 (`a00018` §16, §17) ya marca este
hueco como P2 UX: hay `evidence` en la detección y `score` en
el resultado del detector, pero **nada de eso llega al endpoint
ni al exporter**. Las consecuencias son tres:

1. **Postman / OpenAPI mienten por exceso**. Una colección
   generada sobre un proyecto Pages Router pequeño puede
   contener 40 requests de las cuales 25 son repeticiones del
   mismo handler bajo verbos distintos. El usuario lo lee como
   "mi API expone 25 endpoints" cuando en realidad expone 5.
2. **No hay forma de distinguir "lo vi en código" de "lo
   inferí"**. OpenAPI, por ejemplo, sabe exportar
   `x-tanit-source: "hono.all"` para que el lector sepa que ese
   `ALL` viene de un `.all()`. No hay nada equivalente para la
   confianza: ni el exporter ni el usuario pueden saber que un
   endpoint fue detectado por regex sobre `case "GET":` y no
   por la firma del handler.
3. **El refinamiento futuro queda atado a este cableado**. La
   auditoría ya menciona (§16) que `f00012` (response inference)
   y `r00016` (SchemaGraph derivation) querrán anotar campos
   concretos con confianza (`field X: confianza baja porque el
   tipo es `any` en el handler`). Sin un campo `confidence` en
   `EndpointSpec` y un formato estable en los exporters, cada
   propuesta hija tendrá que reinventar el canal.

## Non-goals

- **No** se reemplaza `formRequest` todavía. La auditoría
  menciona (§9, §10) que un bloque `validation` más rico
  podría llevar tanto la fuente (`formRequest` / DTO / zod
  inline) como la confianza por campo. Eso es un slice
  posterior —`r00016` (SchemaGraph derivation) + `f00012`
  (response inference) — y aquí sólo se añade el canal
  `confidence` a nivel de endpoint, no se rehace el cableado
  de validación.
- **No** se añade confianza por campo en este slice. Sólo por
  endpoint. La granularidad por campo llega cuando `r00016`
  derive los campos del SchemaGraph y los exporters los
  consuman.
- **No** se cambia `IProjectScanner.detect()` ni su modelo de
  `score` / `evidence`. Eso ya está bien y no se duplica.
- **No** se cambia el comportamiento de los exporters ante
  endpoints de baja confianza en términos de **si** se emiten.
  Se emiten igual, sólo se anotan. La política de "omitir
  automáticamente los de baja confianza" es decisión de UX
  aparte.
- **No** se mete un modelo probabilístico. La confianza es
  categórica (`high` / `medium` / `low`) con razones en texto
  llano. Un score numérico sigue siendo del detector de
  frameworks, no del endpoint.
- **No** se cambia el contrato `ParsedRoute.framework`.

## Approach

Una interfaz nueva, un campo opcional en `EndpointSpec`, los
scanners la rellenan, y los exporters la proyectan.

### El tipo

```ts
// packages/contracts/interfaces/core/postman.interface.ts
/**
 * Confianza con la que el scanner afirma este endpoint.
 *
 * `level` es categórico:
 *   - "high":   el scanner identificó la ruta por una firma
 *               inequívoca (App Router `export async function
 *               GET(request)`, OpenAPI path+verb, Hono
 *               `app.get/post/...`, Fastify `fastify.get(...)`,
 *               etc.).
 *   - "medium": el scanner combinó varias señales (regex +
 *               estructura del módulo) pero ninguna es
 *               inequívoca. No es ruido pero conviene revisarlo.
 *   - "low":    el scanner tuvo que recurrir a una heurística
 *               amplia (Pages Router multi-verb, NestJS
 *               `@Body() any`, fixtures sin tipos).
 *
 * `reasons` son líneas en lenguaje natural —cortas, una por
 * señal— que justifican el nivel. Aparecen tal cual en la
 * descripción del request (Postman) y en `x-tanit-confidence`
 * (OpenAPI). El usuario no debería tener que abrir el código
 * para entender por qué Tanit dice "low".
 *
 * r00015 S1.
 */
export interface IEndpointConfidence {
  readonly level: "high" | "medium" | "low";
  readonly reasons: ReadonlyArray<string>;
}

export interface EndpointSpec {
  // ... campos existentes ...
  /**
   * Confianza con la que este endpoint fue detectado.
   *
   * Si está ausente, los exporters asumen `"high"` sin razón
   * —la ausencia del campo significa "lo tengo claro". Los
   * scanners que tengan dudas lo rellenan siempre; los que
   * tienen la firma inequívoca pueden omitirlo.
   *
   * r00015.
   */
  confidence?: IEndpointConfidence;
}
```

### Política por scanner (lo que S1 implementa)

| Scanner                                | Confianza por defecto | Cuándo baja                                                                                  | Razón literal                                                                                            |
| -------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `openapi.scanner.ts`                   | `high`                | —                                                                                            | —                                                                                                        |
| `fastify.scanner.ts`                   | `high`                | —                                                                                            | —                                                                                                        |
| `spring.scanner.ts`                    | `high`                | —                                                                                            | —                                                                                                        |
| `express.scanner.ts`                   | `high`                | — (regex pero inequívoca sobre `router.METHOD(path, h)`)                                     | —                                                                                                        |
| `hono.scanner.ts`                      | `high`                | — (`.all()` es API explícita; `x-tanit-source: "hono.all"` ya documenta el sentinel)         | —                                                                                                        |
| `nestjs.scanner.ts`                    | `high`                | `@Body() any` o `@Body() foo: any` en la firma del handler                                   | `"@Body() any — body type not statically typed"`                                                          |
| `nextjs.scanner.ts` (App Router)       | `high`                | — (la firma `export async function GET/POST/...` es inequívoca)                              | —                                                                                                        |
| `nextjs.scanner.ts` (Pages Router)     | `medium`              | si el handler tiene `req.method` checks / `case` claros → `medium`                          | `"Pages Router method dispatch inferred from req.method/case statements"`                                 |
| `nextjs.scanner.ts` (Pages Router)     | `low`                 | si el set de verbos detectado tiene ≥2 entradas **o** la heurística cayó al fallback `GET`   | `"Pages Router handler method dispatch not statically resolved"`                                          |

El Pages Router es el caso central de la propuesta. La
heurística actual (`parsePageRouteFile`) emite un endpoint por
cada verbo que detecta del `switch` / `if (req.method === "X")`.
Con la confianza en mano hay dos formas de legar al "1 endpoint
`ALL` + razón":

1. **S1 (esta propuesta)**: emitir un único `method: "ALL"` con
   `confidence.level: "low"` y la razón. Es lo que el usuario
   pidió.
2. (Futuro, no en r00015) refinar la heurística para casos
   triviales (`if (req.method === "GET") … else …` → `GET` con
   `medium`) sin perder la anotación.

S1 hace la (1): un endpoint, `ALL`, baja confianza, razón. El
postman exporter materializa `ALL` como `ANY` (ya lo hace vía
`postmanMethodFor`, `x00056`). El openapi exporter lo expande a
los 7 verbos estándar con `x-tanit-source: "hono.all"` o, en este
caso, `x-tanit-source: "pages-router.unresolved"`.

### Lo que ven los exporters

**Postman** (`collection-builder.service.ts` →
`buildRequestDescription`): si `endpoint.confidence` está
presente y `level !== "high"`, se añade al final de la
descripción del request, en una línea aparte:

```
confidence: low
reason: Pages Router handler method dispatch not statically resolved
```

**OpenAPI** (`openapi.exporter.ts`): se añade
`x-tanit-confidence: { level: "low", reasons: [...] }` a la
operación, y el mismo texto aparece en `description` (igual que
en Postman, para que ambas colecciones cuenten la misma
historia).

## Slices

- global_gate: type

### S1 — Tipo `IEndpointConfidence` y población en los 8 scanners

- **Status**: done
- **Files**:
  - `packages/contracts/interfaces/core/postman.interface.ts`
    (definir `IEndpointConfidence`, añadir `confidence?` a
    `EndpointSpec`).
  - `packages/core/adapters/parsed-route-to-spec.adapter.ts`
    (cablear el campo `confidence` desde `ParsedRoute` hasta
    `EndpointSpec`).
  - `packages/frameworks/scanners/openapi.scanner.ts` (no
    emite — `confidence` queda ausente y los exporters
    asumen `high`).
  - `packages/frameworks/scanners/fastify.scanner.ts` (idem).
  - `packages/frameworks/scanners/spring.scanner.ts` (idem).
  - `packages/frameworks/scanners/express.scanner.ts` (idem).
  - `packages/frameworks/scanners/hono.scanner.ts` (idem).
  - `packages/frameworks/scanners/nestjs.scanner.ts`
    (detecta `@Body() any` / `@Body() foo: any` en la firma
    del handler y emite `confidence: low` con la razón
    correspondiente; en otro caso, ausente).
  - `packages/frameworks/scanners/nextjs.scanner.ts`
    (`parsePageRouteFile` emite **un único** `method: "ALL"`
    con `confidence.level: "low"` y la razón
    `"Pages Router handler method dispatch not statically
    resolved"` cuando el set detectado tiene ≥2 verbos o cae
    al fallback `GET`. App Router sigue como está: sin campo
    `confidence`).
- **Gate**: type
- acceptance:
  - "`IEndpointConfidence` está exportado desde
    `postman.interface.ts`"
  - "`EndpointSpec.confidence?` es opcional y serializa igual
    que el resto del spec"
  - "Los 8 scanners compilan; el adapter propaga el campo"
  - "NestJS con `@Body() any` emite `level: 'low'` y la razón
    exacta"
  - "Pages Router multi-verb emite un único endpoint con
    `method: 'ALL'`, `confidence.level: 'low'` y la razón
    exacta"

### S2 — Postman exporter pinta `confidence: <level> reason: <razón>` en la descripción del request

- **Status**: done
- **DependsOn**: [S1]
- **Files**:
  - `packages/core/domain/collection-builder.service.ts`
    (`buildRequestDescription` añade dos líneas al final
    cuando `endpoint.confidence` está presente y `level !==
    "high"`; cuando es `high` o el campo está ausente, no
    añade nada para no contaminar la descripción de los
    endpoints bien detectados).
  - `tests/core/collection-builder.spec.ts` (caso:
    endpoint sin `confidence` → descripción intacta; caso:
    endpoint con `confidence.level: "low"` → descripción
    contiene `confidence: low` y el texto de la razón).
- **Gate**: e2e
- acceptance:
  - "Un endpoint OpenAPI / Fastify / Hono (sin `confidence`)
    no cambia de bytes en la descripción del request"
  - "Un endpoint Pages Router multi-verb aparece como
    `ANY /api/foo` con la descripción acabada en
    `confidence: low\\nreason: Pages Router handler method
    dispatch not statically resolved`"
  - "Un endpoint NestJS con `@Body() any` lleva la razón
    correspondiente en su descripción"

### S3 — OpenAPI exporter emite `x-tanit-confidence` y replica la razón en `description`

- **Status**: done
- **DependsOn**: [S1]
- **Files**:
  - `packages/core/exporters/openapi.exporter.ts`
    (operación lleva `x-tanit-confidence: { level, reasons }`
    cuando el campo está presente; `description` recibe el
    mismo bloque de dos líneas que Postman).
  - `tests/core/openapi-exporter.spec.ts` (caso: openapi
    puro → operación sin `x-tanit-confidence`; caso: pages
    router multi-verb → operación con
    `x-tanit-confidence.level: "low"` y la razón en
    `description`).
- **Gate**: e2e
- acceptance:
  - "El openapi spec resultante lleva `x-tanit-confidence` en
    las operaciones de baja confianza y no lo lleva en las
    de alta"
  - "`description` coincide textual con la descripción
    Postman (mismas dos líneas, mismo orden)"
  - "`x-tanit-source` y `x-tanit-confidence` coexisten sin
    colisionar en las operaciones que ya llevan el source
    marker"

### S4 — Tests pinean la confianza de cada scanner

- **Status**: done
- **DependsOn**: [S1, S2, S3]
- **Files**:
  - `tests/frameworks/scanner-confidence.spec.ts`
    (tabla de 8 scanners × casos representativos; pinea
    explícitamente:
    - OpenAPI / Fastify / Spring / Express / Hono / App Router
      → `EndpointSpec.confidence` queda **ausente** (no `high`,
      ausente —la ausencia es la forma "alta confianza sin
      ruido"—).
    - NestJS con `@Body() any` → `level: "low"` con la razón.
    - NestJS con DTO → ausente.
    - Pages Router multi-verb → `method: "ALL"`,
      `level: "low"`, razón exacta.
    - Pages Router con un único `case "GET":` → `medium` con
      la razón `"Pages Router method dispatch inferred from
      req.method/case statements"`.
  - `tests/fixtures/pages-router-multi-verb/` (fixture nueva,
    un `pages/api/foo.ts` con un `switch (req.method)` de 5
    ramas que ejercita el caso central de la propuesta).
- **Gate**: e2e
- acceptance:
  - "Cada scanner tiene al menos un test que pinea su
    confianza por defecto"
  - "El fixture `pages-router-multi-verb` se detecta como un
    único endpoint `ALL` con `low` + razón; el número total
    de endpoints baja respecto a la versión anterior de la
    colección (5 → 1)"
  - "Las 21 colecciones de ejemplo siguen generándose sin
    cambios de bytes **excepto** las que tienen Pages Router
    multi-verb o NestJS `@Body() any`"

## Acceptance

- `bun run typecheck` y `bun run lint` en verde.
- Los 4 slices shipped con sus tests asociados.
- El fixture `pages-router-multi-verb` produce una colección
  Postman y un spec OpenAPI con un único endpoint `ANY /
  ALL` con `confidence: low` y la razón esperada.
- Las 21 colecciones de ejemplo no cambian de bytes fuera de
  los casos descritos.
- `INDEX.md` regenerado (`delendai_proposals_sync_proposals`).

## Risks

- **Colecciones más verbosas**. La descripción de los
  endpoints de baja confianza lleva dos líneas extra. Es
  deliberado y reversible (basta con filtrar las líneas en
  el exporter si se decide que satura).
- **`--allow-empty`**. La propuesta no debe romper este flag
  del CLI. Endpoints de baja confianza siguen siendo
  endpoints — se emiten, sólo se anotan. El flag
  `--allow-empty` (que afecta a "0 endpoints detectados") no
  entra: si el scanner detecta ≥1 endpoint, los emite; si
  detecta 0, sale con error salvo que el flag esté presente.
  La confianza no cambia este contrato. Verificación extra
  en CI: tests que ejecutan el CLI con `--allow-empty` sobre
  fixtures de baja confianza y comprueban exit 0 + colección
  no vacía.
- **Tests snapshot existentes**. La adición de dos líneas a
  `description` puede romper tests que pineaban la
  descripción al byte. Estos tests se actualizan como parte
  de S2/S3 — no se acepta "ajustar el snapshot" como motivo
  para saltarse la verificación del contenido (la línea
  `confidence: low` tiene que estar).
- **Migración a per-field confidence**. Cuando `r00016` y
  `f00012` aterricen, querrán anotar campos individuales con
  confianza. El formato `level + reasons` se mantiene, pero
  el campo pasará de `EndpointSpec.confidence` a una lista
  por campo (`EndpointSpec.fields[].confidence`). r00015 no
  lo hace; lo deja listo para esa migración.

## Por qué ahora

Es hija directa de `a00018` (auditoría §16, §17) y no
bloquea ni depende de `r00013`, `r00014` ni `r00016`. El
tipo `IEndpointConfidence` es aditivo, así que se puede
shippear independientemente. Las tres hijas que se le unan
después (per-field confidence en `f00012`, response inference
con confianza en campos derivados en `r00016`) consumen el
canal que r00015 deja plantado.
