---
id: f00012
title: "Response inference — infer request/response schemas from handlers, signatures, decorators, and explicit annotations"
kind: feat
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-06
dependsOn:
  - r00013
  - r00016
---

# f00012 — Response inference: hoy sabemos qué entra a la API, mañana qué sale

## Goal

Hoy Tanit analiza con rigor **lo que la API recibe** (request shape):
querystring, headers, body, validaciones, decoradores, DTOs Pydantic,
FormRequests de Laravel. Eso se materializa como `EndpointSpec.body`,
`EndpointSpec.fields`, `EndpointSpec.schemaGraph`, `EndpointSpec.query`,
`EndpointSpec.headers` y viaja como ejemplo request a la colección
Postman y al spec OpenAPI.

Lo que la API **devuelve** (response shape, status codes, schema de
éxito y de error) **no se infiere en ningún scanner**. El campo queda
vacío, y la colección / spec sale sin un ejemplo de respuesta y sin
un schema documentado. La auditoría `a00018` lo marca como
**"la mayor mejora de utilidad de todo el roadmap"**: si Tanit
emite el response, el producto pasa de "genera el curl" a
"documenta la API", que es justo el nicho que un *API Source
Discovery* tiene que ocupar.

Esta propuesta aterriza la inferencia de response como contrato
framework-agnóstico (`IResponseInference`) + un motor por framework,
empezando por los dos donde la señal es más fuerte y más barata de
capturar: **NestJS** (decoradores + tipado TS) y **FastAPI** (anotación
de retorno en la signature + AST). El siguiente slice materializa el
resultado en los exporters (Postman examples + OpenAPI 200 schema) para
que el valor llegue al usuario final sin un paso manual.

## Why

La inferencia no es un lujo: cada framework lleva ya encima la
**señal** que necesitamos, solo que nadie la lee todavía.

- **NestJS**: el return type del método sale del compilador TypeScript
  gratis. `return this.repo.find()` con `@Type(() => User)` resuelve a
  `Array<UserDto>`. `@HttpCode(201)` + `@Res({ passthrough: true })` da
  el status code. `@ApiResponse({ status: 200, type: UserDto })` da
  schema explícito. Si la signature es `Promise<UserDto>` también
  funciona. La señal TS es estructural y ya está en el AST que
  `r00013` promueve a LanguageIR universal.
- **FastAPI**: la flecha `-> UserResponse` en la signature es la
  anotación canónica. El parser AST (no regex sobre source crudo,
  como `a00015` ya hizo para SDL GraphQL) la levanta, resuelve
  forward refs contra el módulo, y se queda con el schema Pydantic.
  Decoradores `@app.get(..., response_model=UserResponse,
  status_code=200)` dan lo mismo con un poco más de gramática.
- **Spring**: `produces = MediaType.APPLICATION_JSON_VALUE` +
  `ResponseEntity<UserDTO>` (genérico resuelto por reflection) →
  schema. `@ApiResponses(@ApiResponse(code = 200, message = "ok",
  response = UserDTO.class))` da schema explícito con un poco más de
  sintaxis swagger.
- **ASP.NET**: `[ProducesResponseType(typeof(User), 200)]` →
  schema + status en una sola línea. `[SwaggerResponse(200,
  typeof(User))]` y `[HttpGet("...")]` dan lo mismo por la otra
  gramática swagger.
- **Express**: no hay decorator universal, pero la combinación
  `res.json(value)` + tipos TS en el handler signature (cuando
  existe `tsconfig.json` y el handler está tipado) da un **schema
  parcial** (high confidence cuando la signature dice `User`,
  medium cuando solo dice `unknown`, low cuando no hay signature
  tipada). Es un *nice-to-have* y no se prioriza en esta propuesta.

Cada uno de esos cinco patrones es una **señal real, observable y
dura**. La auditoría `a00018` §10 lo expresa así: *"lo que la API
devuelve no está en ninguna señal que se lea"*. El verbo **se lea** es
la pista: la información ya está ahí, solo hay que levantar el
adaptador framework-específico.

## Non-goals

- **No inventar shapes**: si no hay señal, `EndpointSpec.responses`
  queda vacío. Nunca emitimos un schema de response "razonable" a
  partir de la intuición. La auditoría lo advierte: solo adjuntar
  cuando la señal es real.
- **No cubrir todos los frameworks en este slice**. NestJS y FastAPI
  son el *first-class set* porque (a) la señal es más fuerte y
  más barata, (b) `r00013` ya deja LanguageIR universal listo para
  que el scanner NestJS consuma el AST TS, y (c) los fixtures ya
  existen. Spring, ASP.NET y Express se quedan como follow-ups de
  esta propuesta con `nonGoals` explícito.
- **No inferir error responses** en esta primera versión. Solo 200 /
  201 / 204 (lo que el decorador o la signature digan). Errores 4xx
  / 5xx requieren correlación cross-file entre handlers y middleware
  de error, que es trabajo de `r00014` (SymbolGraph cross-file).
- **No cambiar el contrato `EndpointSpec.request`**. Body / query /
  headers / fields / schemaGraph siguen siendo la fuente de verdad
  para el request. Solo añadimos un campo **opcional** `responses`.
- **No re-emitir la colección Postman ni el spec OpenAPI por
  inferencia**. La inferencia es **decorativa** (ejemplo de
  response en Postman, schema en OpenAPI), no autoritativa: si el
  usuario tiene un OpenAPI externo con el schema real, ese sigue
  mandando.

## Approach

### Contrato framework-agnóstico

```ts
export interface IResponseInference {
  /** HTTP status code inferred from the handler. */
  status: number;
  /**
   * Inferred schema, when a signal exists. May be undefined even
   * when the rest of the inference succeeds (e.g. Express
   * handler typed `void` + `res.status(204).send()`).
   */
  schema?: ISchemaGraph;
  /**
   * Confidence in the inference. Exported so the UI / the
   * downstream exporter can decide whether to render or hide.
   *
   * - "high":   explicit decorator / annotation that names the
   *             type (e.g. `@ApiResponse({ type: UserDto })`,
   *             `-> UserResponse`, `[ProducesResponseType(
   *             typeof(User), 200)]`).
   * - "medium": implicit via return type / generic resolution
   *             (e.g. NestJS `Promise<UserDto>`, FastAPI
   *             `-> UserResponse` sin decorator, Spring
   *             `ResponseEntity<UserDTO>`).
   * - "low":    partial signal (Express `res.json()` + tipado
   *             parcial, ASP.NET sin `[ProducesResponseType]`).
   */
  confidence: "high" | "medium" | "low";
  /**
   * Why this inference was made. Always non-empty: even
   * `confidence: "low"` carries a human-readable reason so the
   * user knows what signal fired.
   */
  reason: string;
}
```

Extensión de `EndpointSpec`:

```ts
export interface EndpointSpec {
  // ... existing fields unchanged
  /**
   * Inferred response schemas, ordered by status code (200 first,
   * then 201, then error codes). Empty when no signal exists.
   *
   * Multiple entries with the same status are allowed when the
   * handler emits different shapes for different conditions
   * (e.g. NestJS `@ApiResponse({ status: 200, type: UserDto })`
   * + `@ApiResponse({ status: 200, type: UserSummary })` for
   * a query-param variant). Exporters use the first one for
   * the canonical example; the rest go into the description.
   */
  responses?: ReadonlyArray<IResponseInference>;
}
```

### Motor de inferencia

```ts
export interface IResponseInferrer {
  framework: string;
  /** Return [] when no signal exists. Never throw. */
  infer(
    spec: EndpointSpec,
    source: IFrameworkSourceFile,
  ): ReadonlyArray<IResponseInference>;
}

/**
 * Convenience entry point used by the exporters.
 * Composes all registered IResponseInferrers against `spec`
 * and `source`. Returns [] when no inferrer produced output.
 */
export function inferResponses(
  spec: EndpointSpec,
  source: IFrameworkSourceFile,
): ReadonlyArray<IResponseInference>;
```

El contrato `IResponseInferrer` es **un inferrer por framework**,
igual que hoy tenemos un scanner por framework. El dispatcher
`inferResponses()` vive en `packages/frameworks/responses/` (nuevo
paquete, mismo nivel que `scanners/`). Cada framework plug-in se
registra ahí:

- NestJS: `nestjs.response-inferrer.ts` (S2).
- FastAPI: `fastapi.response-inferrer.ts` (S3).
- Spring / ASP.NET / Express: follow-ups (no en esta propuesta).

El dispatcher es **fail-soft**: si un inferrer lanza (p.ej. un AST
malformado), se loguea como warning y se continúa con el resto.
Nunca abortamos la generación por culpa de la inferencia.

### Materialización en exporters

Una vez que `EndpointSpec.responses` está poblado, los exporters
lo materializan:

- **Postman**: la primera entrada con `status === 200` (o 201 si no
  hay 200) se traduce en un array `response[]` con un `example`
  derivado del schema. Si `confidence: "low"`, el example queda
  etiquetado como `// inferred (low confidence): ${reason}` para que
  el usuario sepa que es heurístico.
- **OpenAPI**: la(s) entrada(s) se traducen en
  `responses.{status}.content."application/json".schema` con la
  `description` igual al `reason`. `confidence` no se exporta al
  spec (sería ruido) pero queda accesible vía `x-tanit-confidence`
  para que la UI pueda filtrar.

## Slices

### S1 — Extensión de tipos + contrato `inferResponses`

- **Files**:
  - `packages/contracts/interfaces/core/responses.interface.ts`
    (nuevo: `IResponseInference`, `IResponseInferrer`)
  - `packages/contracts/interfaces/core/postman.interface.ts`
    (añadir `EndpointSpec.responses?`)
  - `packages/contracts/index.ts` (re-export)
  - `packages/frameworks/responses/infer-responses.ts` (nuevo:
    `inferResponses()` dispatcher)
  - `packages/frameworks/responses/index.ts` (re-export)
  - `packages/frameworks/responses/infer-responses.spec.ts`
    (nuevo: 6 tests del dispatcher + tipos)
- **Gate**: `bun run test:contracts` + `bun run test:frameworks`
  + `bun run typecheck`
- **Detalle**:
  - Definir `IResponseInference` y `IResponseInferrer` en
    `packages/contracts` (mismo paquete que `EndpointSpec`).
  - Añadir `responses?: ReadonlyArray<IResponseInference>` a
    `EndpointSpec` con JSDoc explicando el ordenamiento y el
    comportamiento cuando hay varias entradas con el mismo status.
  - Crear `packages/frameworks/responses/` (nuevo paquete) con el
    dispatcher `inferResponses()`. Internamente: un registry
    framework → inferrer, alimentado por `registerResponseInferrer()`
    que cada scanner plugin llama en su `init`.
  - Fail-soft: `inferResponses()` envuelve cada inferrer en un
    try/catch, loguea warning con framework + spec id, y devuelve
    lo que los demás inferrers produzcan.
  - Tests del dispatcher: (a) registry vacío → `[]`,
    (b) inferrer que devuelve `[]` → `[]`,
    (c) inferrer que lanza → `[]` + log,
    (d) dos inferrers encadenados → resultado concatenado,
    (e) inferrer con `confidence: "high"` se preserva,
    (f) ordenamiento estable por `(status, confidence desc)`.

### S2 — Inferrer NestJS (decorador + return type via TS)

- **Files**:
  - `packages/frameworks/scanners/nestjs/nestjs.response-inferrer.ts`
    (nuevo)
  - `packages/frameworks/scanners/nestjs/index.ts` (registrar
    el inferrer)
  - `packages/frameworks/scanners/nestjs/nestjs.response-inferrer.spec.ts`
    (nuevo: 5 tests)
- **Gate**: `bun run test:frameworks` + `bun run lint:naming`
- **Detalle**:
  - Consumir el LanguageIR que `r00013` deja universal (mismo
    AST TS que ya usa el scanner NestJS hoy).
  - **Señales que se leen**:
    - `@HttpCode(201)` / `@HttpCode(HttpStatus.CREATED)` → `status`.
    - `@ApiResponse({ status: 200, type: UserDto })` →
      `{ status: 200, schema: schemaFromType(UserDto), confidence: "high", reason: "@ApiResponse" }`.
    - `@ApiOkResponse({ type: UserDto })` →
      `{ status: 200, schema: schemaFromType(UserDto), confidence: "high", reason: "@ApiOkResponse" }`.
    - `@ApiCreatedResponse({ type: UserDto })` →
      `{ status: 201, schema: schemaFromType(UserDto), confidence: "high", reason: "@ApiCreatedResponse" }`.
    - Return type del método (extraído del AST TS): si es
      `Promise<UserDto>` / `Observable<UserDto>` y NO hay
      `@ApiResponse` que coincida → `{ status: 200, schema: schemaFromType(UserDto), confidence: "medium", reason: "NestJS return type" }`.
    - `@Type(() => User)` en el DTO → array<T> cuando el scanner
      ya sabe que el return type es `User[]` o `Promise<User[]>`.
  - Sin decorador swagger + sin tipado en el handler → `[]`.
    **Nunca** inventar shapes: la auditoría lo repite.
  - Tests:
    - Handler con `@ApiOkResponse({ type: UserDto })` →
      `[{ status: 200, confidence: "high", schema: {...} }]`.
    - Handler con `Promise<UserDto>` sin decorator swagger →
      `[{ status: 200, confidence: "medium", schema: {...} }]`.
    - Handler con `@HttpCode(201)` + `@ApiCreatedResponse({ type: UserDto })` →
      `[{ status: 201, confidence: "high", ... }]`.
    - Handler sin tipado ni decorators → `[]`.
    - `@ApiResponse({ type: [UserDto] })` para array → schema
      `array<UserDto>` con `confidence: "high"`.

### S3 — Inferrer FastAPI (signature return type via AST)

- **Files**:
  - `packages/frameworks/scanners/fastapi/fastapi.response-inferrer.ts`
    (nuevo)
  - `packages/frameworks/scanners/fastapi/index.ts` (registrar
    el inferrer)
  - `packages/frameworks/scanners/fastapi/fastapi.response-inferrer.spec.ts`
    (nuevo: 5 tests)
- **Gate**: `bun run test:frameworks` + `bun run lint:naming`
- **Detalle**:
  - Parser AST Python (mismo árbol que el scanner FastAPI ya
    construye). Nada de regex sobre source crudo — `a00015`
    marcó ese camino como un anti-patrón.
  - **Señales que se leen**:
    - Flecha `-> UserResponse` en la signature → resolver el
      forward ref contra el módulo, levantar la `BaseModel` /
      `TypedDict`, convertir a `ISchemaGraph` → `{ status: 200, schema: ..., confidence: "high", reason: "FastAPI return annotation" }`.
    - `@app.get("/x", response_model=UserResponse)` →
      `{ status: 200, schema: ..., confidence: "high", reason: "FastAPI response_model" }`.
    - `@app.get("/x", status_code=201)` → status 201.
    - `-> list[UserResponse]` → schema `array<UserResponse>` con
      `confidence: "high"`.
    - `-> None` o ausencia de flecha → status 204 (cuando el método
      es POST/PUT/DELETE) o `[]` (cuando no hay señal).
  - Forward refs (string entre comillas `"UserResponse"`) se
    resuelven buscando el nombre en el módulo; si no se
    encuentra, `confidence` baja a `"medium"` y el `reason` lo
    dice.
  - Tests:
    - `@app.get("/users/{id}", response_model=UserResponse)` →
      `[{ status: 200, confidence: "high", schema: UserResponse }]`.
    - `def create() -> UserCreate: ...` con `@app.post(..., status_code=201)` →
      `[{ status: 201, confidence: "high", schema: UserCreate }]`.
    - `def list() -> list[User]: ...` → schema `array<User>` con
      `confidence: "high"`.
    - `def delete() -> None: ...` con `@app.delete(...)` →
      `[{ status: 204, confidence: "high", reason: "no body" }]`.
    - Forward ref no resuelto (`-> "MissingModel"`) →
      `confidence: "medium"` y `reason` lo declara.

### S4 — Exporters Postman + OpenAPI emiten `responses`

- **Files**:
  - `packages/frameworks/exporters/postman.exporter.ts`
  - `packages/frameworks/exporters/openapi.exporter.ts`
  - `packages/frameworks/exporters/postman.exporter.spec.ts`
    (nuevo: 3 tests)
  - `packages/frameworks/exporters/openapi.exporter.spec.ts`
    (nuevo: 3 tests)
- **Gate**: `bun run test:frameworks` + `bun run lint:fixtures`
- **Detalle**:
  - **Postman**: para cada `EndpointSpec.responses[0]` con
    `status === 200` (o 201 si no hay 200), emitir un array
    `response` con un `example` derivado del schema (un solo
    objeto JSON vacío con la forma del schema). Si
    `confidence: "low"`, el `_postman_previewlanguage` se setea
    a `// inferred (low confidence): ${reason}` para que el
    usuario sepa que es heurístico.
  - **OpenAPI**: para cada entrada en `EndpointSpec.responses`,
    emitir `responses.{status}.content."application/json".schema`.
    `description` = `reason`. Si `confidence === "low"`,
    añadir `x-tanit-confidence: "low"` (extensión del spec, no
    rompe validación).
  - Cuando `EndpointSpec.responses` está vacío, los exporters
    siguen comportándose como hoy (sin cambios retroactivos).
  - Tests e2e: ejecutar el binario contra las fixtures
    `examples/example-nestjs/` y `examples/example-fastapi/`,
    validar que el JSON resultante tiene el `response[]` /
    `responses.{200}.schema` poblado.
  - Validar también que la fixture Express
    (`examples/example-express/`) **no** cambia (sigue sin
    response porque el inferrer Express no está en esta
    propuesta).

## Acceptance

- `bun run typecheck` verde (los nuevos tipos compilan limpio
  contra el resto del monorepo).
- `bun run lint` verde (naming consistente: `inferResponses`,
  `IResponseInference`, `IResponseInferrer`).
- `bun run test:frameworks` verde con los tests nuevos:
  - S1 dispatcher: 6/6 verde.
  - S2 NestJS inferrer: 5/5 verde.
  - S3 FastAPI inferrer: 5/5 verde.
  - S4 Postman + OpenAPI exporters: 6/6 verde.
- E2E con fixtures:
  - `examples/example-nestjs/` → colección Postman con
    `response[]` poblado en al menos un endpoint.
  - `examples/example-fastapi/` → spec OpenAPI con
    `responses.200.schema` poblado en al menos un endpoint.
  - `examples/example-express/` → **sin cambios** (output
    idéntico bit-a-bit al de `develop` antes de esta propuesta;
    garantía de que añadir response inference no introduce
    ruido en frameworks que aún no tienen inferrer).
- `bun run lint:fixtures` sigue verde (las fixtures existentes
  no se tocan).
- `bun run validate` verde end-to-end.

## Risks

- **Coste del parseo TS en NestJS (S2)**. Levantar el AST TS
  por cada handler tiene coste no trivial. Mitigación: el
  scanner NestJS **ya** levanta el AST hoy; el inferrer lo
  consume del LanguageIR universal que `r00013` deja, sin
  parsear dos veces. Si el coste sigue siendo alto en monorepos
  grandes, el siguiente paso es cachear el `ISchemaGraph` por
  `(sourceFile, lineNumber)` en el `IScanResult`.
- **Falsos positivos en shapes inferidos**. Si un handler tiene
  return type `any` o `Promise<any>`, el inferrer puede emitir
  un schema vacío que parece "respuesta" pero no dice nada.
  Mitigación: `confidence: "low"` + `reason: "untyped return"`;
  el exporter OpenAPI añade `x-tanit-confidence: "low"` y el
  Postman example queda etiquetado como heurístico. La UI / el
  usuario pueden decidir ignorar.
- **Inferencia parcial = ruido visual**. Un `response[]` con
  un solo objeto JSON vacío y `description: "inferred"` puede
  ensuciar la colección. Mitigación: gate configurable
  `responses.minConfidence` en `delendai.config.json#plugins.
  export-to-postman.options` (default `"medium"`) que descarta
  las entradas con confianza por debajo del umbral. Documentado
  en el README.
- **Cobertura asimétrica entre frameworks**. NestJS y FastAPI
  quedan cubiertos; Spring, ASP.NET y Express no. La auditoría
  lo asume: la propuesta cierra la utilidad **para los dos
  frameworks más comunes** y deja follow-ups explícitos para el
  resto. Si la demanda tira de Spring o ASP.NET, se reabre con
  un slice S5 / S6 siguiendo el mismo patrón.
- **Conflicto con OpenAPI externo**. Si el usuario ya tiene un
  `openapi.yaml` autoritativo y `EndpointSpec.responses` está
  poblado por el inferrer, ¿gana el inferrer o el externo?
  Mitigación documentada en el README: el OpenAPI externo
  siempre gana cuando `--openapi-in <file>` está presente; el
  inferrer solo rellena huecos. Esto ya es el comportamiento
  para `schemaGraph` hoy, así que es consistencia.
- **La auditoría lo repite**: *"lo que la API devuelve no está
  en ninguna señal que se lea"*. La promesa de esta propuesta
  es exactamente esa: leer la señal. Si en algún caso la señal
  no existe, `responses` queda vacío y **no inventamos**. La
  regla "`confidence: low` siempre lleva `reason` no vacío" es
  la salvaguarda final para que el usuario entienda qué pasó.
