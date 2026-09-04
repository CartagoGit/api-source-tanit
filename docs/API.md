<!--
  GENERADO por `bun run docs:api`. No se edita a mano.
  `bun run lint:api` comprueba que sigue al día.
-->

# Referencia de la API importable

Lo que el `exports` del `package.json` deja importar desde fuera del
paquete. Todo lo demás es interno y puede cambiar sin aviso.

```ts
import { generateWithAllFrameworks } from "export-to-postman/frameworks";
import { buildCollection } from "export-to-postman/core/domain/collection-builder.service";
```

Si lo que buscas es la herramienta de línea de comandos y no la
librería, `expostman --help` lista los comandos y las banderas.

> 171 símbolos en 61 módulos.

### `packages/core/adapters/parsed-route-to-spec.adapter.ts`

Universal adapter: `ParsedRoute` (neutral) → `EndpointSpec` (Postman).

#### `toPostmanUri`

```ts
export function toPostmanUri(laravelUri: string): string
```

with the prefix applied from the scanner; here we only normalize the

#### `deriveName`

```ts
export function deriveName(route: ParsedRoute): string
```

Derives a readable name from the HTTP method + URI.

It is exported so it can be tested on its own: it is a pure function
of the route, and the alternative would force assembling an entire
scanner to check what a name looks like.

#### `buildSpecsFromScanner`

```ts
export async function buildSpecsFromScanner( scanner: IRouteScanner, match: IProjectMatch, validation: IValidationSpecProvider | null, ): Promise<AdapterResult>
```

Builds `EndpointSpec[]` from an `IRouteScanner` and, if given, its
`IValidationSpecProvider`. Returns an `AdapterResult` with the same
shape as the legacy `discoverEndpoints`.

#### `_peekSpec`

```ts
export async function _peekSpec(projectRoot: string): Promise<string | null>
```

### `packages/core/discovery/accumulate-routes-by-service.helper.ts`

Accumulates `routesByService` from the per-scanner slice the pipeline has produced. x00025.

#### `accumulateRoutesByService`

```ts
export function accumulateRoutesByService( perScanner: ReadonlyArray<
```

Accumulates and deduplicates routes by `serviceId`.

Order is stable: for each scanner entry, we concatenate `existing`
(what previous scanners with the same `serviceId` already
contributed) followed by `scannerRoutes` (what this scanner
emitted). The first occurrence of each `(method, uri, sourceFile)`
tuple wins.

The `perScanner` parameter takes only the two fields the helper
needs (`serviceId`, `scannerRoutes`) so it does not couple to
`IPerScanner` (which also carries `framework`, `scannerScore`,
`scannerSpecs`). The shape is declared inline because the gate
`lint:contracts` requires types to live in `contracts/` — making
the helper importable for typing alone would defeat that.

@param perScanner What the pipeline collected per scanner.
@returns          Map `serviceId` -> deduplicated union of routes.

### `packages/core/discovery/auth-scheme.helper.ts`

per-service auth + baseUrl wiring — a00013 S4.

#### `pickAuth`

```ts
export function pickAuth( service: IServiceDescriptor, fallback: IEndpointAuth | undefined, ): IEndpointAuth | undefined
```

Resuelve la auth de un servicio: override del descriptor si la trae
(lo que el grafo plantó), o fallback heredado del proyecto.

El retorno es exhaustivo por discriminante: si `service.auth` es
`{ kind: "scheme", scheme: "bearer" }`, devuelve eso exactamente;
no lo convierte a `{ kind: "none" }` ni a `{ kind: "scheme",
scheme: "apiKey" }`. La función no sabe —ni necesita saber— qué
hacer con cada variante: el contrato es "el primer argumento gana
si está definido; si no, el segundo".

Ambos argumentos son `IEndpointAuth | undefined`. Cuando los dos son
`undefined`, devuelve `undefined`. Eso significa "no hay señal de
auth para este servicio" y deja al pipeline decidir si el detector
por-espec debe correr o si el caller ya pasó otro mecanismo.

@param service El descriptor del servicio. `service.auth` puede ser
  `undefined` (hereda del proyecto), `null` no es válido (`baseUrl`
  es `string | null` pero `auth` es estrictamente `IEndpointAuth |
  undefined`).
@param fallback La auth heredada del proyecto. Típicamente el
  resultado de `toIEndpointAuth(detectedFromSpecs)`. Puede ser
  `undefined` cuando el proyecto tampoco tiene señal.

#### `toIEndpointAuth`

```ts
export function toIEndpointAuth(detected: IDetectedAuthScheme): IEndpointAuth
```

Conversión exhaustiva `IDetectedAuthScheme` → `IEndpointAuth`, inversa
semántica de `authSchemeFromEndpointAuth` en
`generation.pipeline.ts`.

Exportada por separado para que los tests de S4 cubran los cuatro
casos del discriminante (`none`, `bearer`, `apiKey`, `oauth2`)
sin tener que arrastrar un IDetectedAuthScheme de mentira por el
pipeline.

El switch es exhaustivo por tipo: si se añade una variante a
`AuthSchemeType` sin mapearla aquí, TypeScript marca el switch como
no-exhaustivo (TS7030 con `noImplicitReturns`). Es el mismo patrón
que `authSchemeFromEndpointAuth` usa en dirección contraria.

#### `buildServiceConfig`

```ts
export function buildServiceConfig( config: ProjectConfig, service: IServiceDescriptor, ): ProjectConfig
```

Aplica los overrides per-service a la `ProjectConfig` **sin mutar
el original**. Devuelve una copia superficial con:
  - `baseUrl`: el del servicio si lo declara y no es `null`,
    si no el del proyecto. Eso es lo que `inferCollectionVariables`
    y `buildCollection` consumen en `buildForService`.
  - `variables`: copia del array, con la entrada `baseUrl`
    sustituida por el valor efectivo para que la variable de
    colección (`{{baseUrl}}`) refleje el override per-service.

Pure: no toca `config`. Una llamada por iteración del loop
multi-service en `buildFor` es independiente — la siguiente
iteración recibe el `discovery.config` original, sin baseUrl
contaminado por el servicio anterior (S4 acceptance #3: `buildForService`
no muta `config.baseUrl` entre iteraciones).

`@see` `IProjectContext` para el contexto raíz. Si en el futuro
entran más overrides per-service (auth global, headers extra,
prefijo de URI, etc.), este helper es el sitio natural para
extenderlos.

### `packages/core/discovery/discovery.orchestrator.ts`

`DiscoveryOrchestrator` — punto de entrada único del discovery framework-agnostic.

#### `DiscoveryOrchestrator`

```ts
export class DiscoveryOrchestrator implements IDiscoveryOrchestrator
```

Decide qué framework es el proyecto y con qué colaboradores se escanea.

Puntúa todos los detectores del registro y ordena por confianza. No se
queda con el primero: un repo con un Express heredado y rutas nuevas de
Next.js casa con dos, y quedarse con uno devolvía un tercio de los
endpoints sin decir nada.

### `packages/core/discovery/effective-project-root.helper.ts`

Raíz efectiva del proyecto — a00014 S1.

#### `effectiveProjectRoot`

```ts
export function effectiveProjectRoot(match: IProjectMatch): string
```

La raíz efectiva del proyecto, honrando `frameworkSearchRoot`.

- Sin `frameworkSearchRoot` → `match.projectRoot` (compatibilidad
  con proyectos planos y con los tests que no rellenan el campo).
- Con `frameworkSearchRoot` → `path.resolve(projectRoot,
  frameworkSearchRoot)`, siempre que el resultado siga dentro de
  `projectRoot`.

Lanza un `Error` claro si `frameworkSearchRoot` apunta fuera de
`projectRoot` (típicamente porque contiene `..` o es absoluto).

#### `effectiveSearchRoot`

```ts
export function effectiveSearchRoot(match: IProjectMatch): string
```

Alias de `effectiveProjectRoot` con el nombre que ya usaban Hono,
NestJS y Next.js en sus helpers inline. Si un scanner está
migrando del helper local al central, puede seguir llamando a su
función favorita sin un cambio extra.

El comportamiento es idéntico al de `effectiveProjectRoot`: misma
resolución, misma guarda, mismo error. Sólo cambia el nombre para
no romper call sites existentes.

#### `rawProjectRoot`

```ts
export function rawProjectRoot(match: IProjectMatch): string
```

La raíz real del proyecto, sin tocar.

Devuelve `match.projectRoot` tal cual. Existe para que un scanner
que necesita la raíz del usuario — el `projectRoot:` del
`IProjectMatch` que devuelve al orquestador, o un `join` con un
`route.sourceFile` ya relativo a `projectRoot` — pase por un
helper en vez de leer `match.projectRoot` directamente. Así el
gate `lint:effective-project-root` puede controlar todas las
referencias a `match.projectRoot` en una sola lista blanca.

### `packages/core/discovery/endpoint-merger.service.ts`

`EndpointMerger`: el reconciliador de endpoints para proyectos híbridos.

#### `EndpointMerger`

```ts
export class EndpointMerger implements IEndpointMerger
```

Implementación por defecto del `IEndpointMerger`. Stateless: el
estado vive en `merge()` (los candidatos), no en la instancia.
Reutilizable entre llamadas concurrentes.

#### `mergeEndpoints`

```ts
export function mergeEndpoints( candidates: ReadonlyArray<IEndpointMergeCandidate>, options: IMergeEndpointsOptions =
```

Punto de entrada de pipeline: recibe la lista plana de candidatos
y devuelve los endpoints fusionados + provenance + warnings.

Los candidatos ya vienen ordenados por `scannerScore` descendente
(es lo que hace `discoverSpecs`); el merger los re-ordena dentro
de cada grupo por `frameworkConfidence` y desempata por el orden
de llegada, que coincide con el del orquestador.

#### `candidatesFromSpecs`

```ts
export function candidatesFromSpecs( scannerScore: ReadonlyMap<string, Confidence>, ): ( specs: ReadonlyArray<
```

Wrapper para consumir candidatos desde `EndpointSpec[]` (la forma
que produce el adapter). Conserva el `framework` por candidato a
partir de la metadata del spec: el pipeline marca el spec con
`formRequest` o el nombre del controller, pero la fuente más
fiable es pasar el `framework` explícitamente (que es lo que
hace `discoverSpecs` cuando itera sobre los `usable`).

#### `endpointSpecFromMerged`

```ts
export function endpointSpecFromMerged(m: IMergedEndpoint):
```

Inversa de `candidatesFromSpecs`: convierte un `IMergedEndpoint`
de vuelta a `EndpointSpec` para que el pipeline siga operando con
la forma que ya consumen el resto de servicios.

Copia los campos que el merger decide: identidad (method, uri,
name) y las piezas que ganó (body, fields, description, auth).

Audit 2026-09-04 P1 #6 + segunda revisión #16 #17: el override
por operación del esquema de auth debe sobrevivir al merger.
`spec.auth` se mapea al `authScheme` del candidato (en
generation.pipeline.ts) y el merger propaga el ganador a este
punto. La conversión de vuelta cubre **todas** las ramas del
union `IEndpointAuth`:

  - `type: "none"` → `auth: { kind: "none" }` (override público).
  - `type: "bearer"` → `auth: { kind: "scheme", scheme: "bearer" }`.
  - `type: "apikey"` → `auth: { kind: "scheme", scheme: "apiKey" }`.
  - `type: "oauth2"` → `auth: { kind: "scheme", scheme: "oauth2" }`.

Antes solo la rama `none` se traducía; un override per-op
`bearer`/`apiKey`/`oauth2` se descartaba y `detectAuthScheme`
recalculaba la auth a nivel colección — perdiendo el override.

### `packages/core/discovery/filter-specs-for-service.helper.ts`

Filters the global `discovery.specs` down to the specs that belong to a single `IServiceDescriptor`. x00028.

#### `filterSpecsForService`

```ts
export function filterSpecsForService( discoverySpecs: ReadonlyArray<EndpointSpec>, service: IServiceDescriptor, ): EndpointSpec[]
```

Returns the subset of `discovery.specs` whose `(method, uri)`
matches a route in `service.endpoints`. When the service has no
endpoints, returns `discovery.specs` unchanged (legacy / single
service path).

The returned type is `EndpointSpec[]` (not `ReadonlyArray`)
because downstream helpers — `applyAgnosticInference`,
`inferCollectionVariables`, `detectAuthScheme`,
`hasLoginEndpoint` — mutate the specs in place (e.g.
`applyAgnosticInference` writes `body` and `description`). The
legacy code path `[...discovery.specs]` was already a fresh
mutable copy for that reason; we preserve that contract.

@param discoverySpecs The global catalog produced by `discoverSpecs()`.
@param service        The descriptor for one service in the graph.
@returns              Specs that belong to this service.

### `packages/core/discovery/generation.pipeline.ts`

Pipeline de generación: `projectRoot` → `PostmanCollection`.

#### `MultipleServicesWithoutCombineError`

```ts
export class MultipleServicesWithoutCombineError extends Error
```

Lanzada por `generateCollection()` cuando el proyecto tiene varios
servicios pero el caller NO pidió `--combine-services` (ni
`IGenerationOptions.combineServices === true`).

## Por qué existe

Hasta x00024, el contrato en singular documentaba "una sola
colección" pero el branch multi-servicio hacía `return result[0]` y
descartaba el resto **silenciosamente**. Eso convertía
`await generateCollection(monorepoRoot)` en una llamada que pierde
servicios sin avisar, exactamente el tipo de bug que un caller
jamás detecta en CI. La API plural `generateCollections()` ya
devolvía el array completo.

## Cuándo se lanza

`generateCollection()` invoca `buildFor` y observa tres formas:

  - **Single-service** (un solo match, monorepo de un workspace o
    proyecto plano): `result` es un único `IGenerationResult`. Sin
    throw.
  - **Multi-service + `combineServices: true`**: el caller pidió
    fusionar; `buildFor` ya devuelve un único `IGenerationResult`
    combinado. Sin throw.
  - **Multi-service + `combineServices: false/undefined`**: aquí se
    lanza esta excepción.

El contrato legacy (single-service) sigue funcionando exactamente
igual que antes — esto solo añade un caso nuevo.

## Forma del error

Lleva los datos que la CLI necesita para dar un mensaje útil sin
tener que parsear el texto del `super()`:

  - `serviceCount`: el número de servicios detectados.
  - `serviceIds`: los ids derivados (de `match.frameworkSearchRoot`
    vía `deriveServiceId`); vacío si ninguno tenía id resoluble.

El mensaje incluye la sugerencia ("use --combine-services or
generateCollections()") para que un usuario que vea el error en
crudo sepa qué hacer.

Vive en este mismo `.pipeline.ts` (no en `packages/core/errors/`)
porque la regla `lint:naming` de `packages/core/` solo admite los
sufijos `.service`, `.pipeline`, `.orchestrator`, `.adapter` y
`.helper`. Un error class no encaja en ninguno, así que se queda
donde se lanza — el mismo patrón que `PostmanApiError` en
`domain/postman-api.service.ts`.

#### `generateCollection`

```ts
export async function generateCollection( projectRoot: string, options: IGenerationOptions, ): Promise<IGenerationResult>
```

Descubre los endpoints de un proyecto y construye su colección.

`projectRoot` manda, y llega **como argumento** hasta abajo: el
contexto se resuelve una vez aquí y viaja explícito por el pipeline,
el loader y los scanners.

Antes esto iba envuelto en `withProjectRoot()`, que fijaba variables
de entorno globales, ejecutaba y las restauraba. Funcionaba, pero al
precio de una cola: dos llamadas concurrentes se pisaban el estado,
así que había que serializarlas. Dos análisis a la vez tardaban lo que
la suma.

Ya no. `tests/e2e/concurrent-projects.test.ts` genera dos proyectos de
frameworks distintos con `Promise.all` y comprueba que ninguno se
cruza: ni en endpoints, ni en nombre, ni en la raíz del contexto.

#### `generateCollections`

```ts
export async function generateCollections( projectRoot: string, options: IGenerationOptions, ): Promise<ReadonlyArray<IGenerationResult>>
```

Variante multi-service de `generateCollection`. Devuelve TODAS
las colecciones, una por servicio, en el orden de descubrimiento.

- Sin flag `--combine-services` y con N>1 servicios: array de N
  colecciones (cada una con `collectionName` derivado del
  serviceId).
- Con flag `--combine-services` o N===1: array de longitud 1
  (la coleccion legacy).

El CLI genera un fichero por entrada; el plugin MCP y la web
exponen el array tal cual.

### `packages/core/discovery/group-by-service.helper.ts`

`groupByService` — a00013 S1.

#### `deriveServiceId`

```ts
export function deriveServiceId(match: IProjectMatch): string
```

Deriva el id estable de un match. Dos matches con el mismo
`frameworkSearchRoot` producen el mismo id.

- Si hay `frameworkSearchRoot`, se usa como base del id (que es
  exactamente la regla que introdujo a00010).
- Si no, cae a `<framework>@<projectRoot>` para evitar
  colisiones entre un servicio single-framework en dos raíces
  distintas.

#### `groupByService`

```ts
export function groupByService(input: IGroupByServiceInput): IServiceGraph
```

Forma un `IServiceGraph` a partir de los matches y rutas del
discovery.

Lanza `Error` si:
- Falta una entrada en `routesByMatch` para un match.
- `matches` está vacío y `detectedMonorepo === false` (un
  proyecto que no es monorepo **debe** tener al menos un match,
  si no el caller no entendió los contratos). El caller puede
  silenciar este chequeo pasando `detectedMonorepo === true` con
  un array vacío — es el caso "monorepo declarado pero sin
  workspaces enumerados".

### `packages/core/discovery/monorepo-detector.helper.ts`

Detección de monorepo workspace — f00011 S3.

#### `detectMonorepo`

```ts
export async function detectMonorepo( projectRoot: string, ): Promise<IMonorepoDetection>
```

Punto de entrada: devuelve la detección para una raíz de proyecto.

`projectRoot` debe ser absoluto (los scanners y el pipeline ya lo
absolutizaron antes). Si llega relativo, se devuelve "no es monorepo"
con `null` por todas partes — el orquestador no debería tener que
adivinar cuál es la raíz.

### `packages/core/discovery/output-paths.helper.ts`

Resolución de rutas de salida a partir de un `IProjectContext` explícito.

#### `resolveOutputDir`

```ts
export function resolveOutputDir( context: IProjectContext | undefined, argv: ReadonlyArray<string> = process.argv, env: Readonly<Record<string, string | undefined>> = process.env, ): string
```

Directorio donde se escriben los artefactos, con la misma precedencia
que tenía `outputDir(context?)` antes.

Aceptar `argv` y `env` como parámetros —en lugar de leer
`process.argv` y `process.env`— es lo que permite testear la
precedencia sin tocar el proceso. Los valores por defecto siguen
siendo los globales para que los call sites existentes no cambien.

`context` es opcional a propósito: cuando un comando se lanza sin
contexto de proyecto (la rama `catch` de `validate-json`, que corre
solo con el JSON ya generado), el helper cae a la resolución por
`argv` / `env`. Mantener esa puerta abierta es el comportamiento
histórico y no introduce un singleton: el helper sigue siendo puro
respecto a sus argumentos, y solo lee los globales cuando no le
pasan contexto.

#### `outputCollectionPath`

```ts
export async function outputCollectionPath( context: IProjectContext | undefined, projectName?: string, argv: ReadonlyArray<string> = process.argv, env: Readonly<Record<string, string | undefined>> = process.env, ): Promise<string>
```

Ruta absoluta al JSON principal. Crea el directorio si no existe.

Acepta `argv` y `env` igual que `resolveOutputDir` para que tests y
procesos de vida larga puedan inyectar el contexto sin mutar el
proceso. Por defecto son los globales.

#### `outputEnvironmentPath`

```ts
export async function outputEnvironmentPath( context: IProjectContext | undefined, envName: string, projectName?: string, argv: ReadonlyArray<string> = process.argv, env: Readonly<Record<string, string | undefined>> = process.env, ): Promise<string>
```

Ruta absoluta al environment Postman para un entorno dado.

El nombre del environment se slugifica igual que antes: NFD →
quitar diacríticos → kebab-case → trim de guiones. Quien necesita el
comportamiento original lo hace pasando el `projectName` ya
normalizado.

#### `describeDiscoveredPaths`

```ts
export function describeDiscoveredPaths( context: IProjectContext, projectName?: string, argv: ReadonlyArray<string> = process.argv, ): string
```

La traza que el CLI imprime antes de escanear, en texto.

Sin nombre de proyecto dice `<nombre-del-proyecto>` en lugar de
inventarse uno: la traza existe para descartar que se esté mirando
la carpeta equivocada, y mentir ahí la hace peor que no decir nada.

Las carpetas `routes` y `requests` que aparecen son **del proyecto
que se escanea**, derivadas con `projectDirs(context)`. Esa parte es
la heurística heredada del camino Laravel; un scanner moderno
resuelve sus propias rutas, pero la traza del CLI las sigue
mostrando porque a una persona le sirve ver si existen.

### `packages/core/discovery/project-context.service.ts`

Resolución explícita del contexto de un proyecto.

#### `resolveProjectContext`

```ts
export function resolveProjectContext( options: IResolveContextOptions =
```

Construye el contexto de un proyecto.

Prioridad de la raíz: parámetro explícito → `--project-root` en argv →
`POSTMAN_PROJECT_ROOT` en env. Lanza si no hay ninguna, porque
continuar con una raíz adivinada produce colecciones vacías sin decir
por qué (fue exactamente el bug del CLI con `--project-root`).

#### `projectDirs`

```ts
export function projectDirs(context: IProjectContext): IProjectDirs
```

#### `fromProjectRoot`

```ts
export function fromProjectRoot(context: IProjectContext, relPath: string): string
```

#### `toProjectRelative`

```ts
export function toProjectRelative(context: IProjectContext, absPath: string): string
```

Ruta relativa al proyecto, en formato POSIX.

Antes se hacía `normalized.startsWith(context.projectRoot)`, pero
`startsWith` no entiende de fronteras de segmento: `/home/u/api-secret`
matchea falsamente `/home/u/api` (x00022, audit 2026-09-04). Ahora se
usa la misma fórmula canónica que
`packages/core/helpers/path-containment.helper.ts`: `relative()` más
la guarda de prefijo `..${sep}` / absoluto.

Si `absPath` es exactamente la raíz del proyecto, se devuelve la
cadena vacía para preservar la idempotencia `fromProjectRoot ∘
toProjectRelative`.

#### `hasProjectDir`

```ts
export function hasProjectDir(context: IProjectContext, relPath: string): boolean
```

### `packages/core/discovery/project-loader.service.ts`

Carga la configuración del proyecto host de forma agnóstica.

#### `detectProjectName`

```ts
export async function detectProjectName( context: IProjectContext, ): Promise<string>
```

Devuelve el nombre del proyecto host.

La lectura de manifiestos vive en `project-name.service`: aquí solo
se resuelve la raíz. Antes esta función miraba únicamente
`composer.json`, con lo que Laravel se llamaba como su paquete y los
otros once frameworks como su carpeta.

#### `detectFilePrefixes`

```ts
export async function detectFilePrefixes( context: IProjectContext, ): Promise<Record<string, string[]>>
```

Lee `RouteServiceProvider.php` para extraer el mapa
`archivo → prefijos` desde los métodos `mapXxxRoutes()`.

Ejemplo Laravel:
  protected function mapExternalApiRoutes(): void {
    Route::prefix('api/externo')
      ->group(base_path('routes/externo.php'));
  }

→ `{ "routes/externo.php": ["api", "externo"] }`

#### `buildZeroConfig`

```ts
export async function buildZeroConfig( context: IProjectContext, ): Promise<ProjectConfig>
```

Genera un ProjectConfig mínimo viable sin archivo del host.
Útil para que el paquete funcione "out-of-the-box" en cualquier proyecto.

`baseUrl` por defecto es el origen (`DEFAULT_BASE_URL`). El sufijo
`/api` **no** se añade automáticamente: solo aparece cuando una de
las fuentes documentadas en `BASE_PATH_SOURCES` lo aporta. Esto
cierra el bug que producía `http://localhost/api/users` en proyectos
Express/Flask/Gin/FastAPI sin prefijo global (a00012 H-P2e, S4).

#### `resolveConfigPath`

```ts
export async function resolveConfigPath( argv: ReadonlyArray<string> = [], context: IProjectContext, ): Promise<string>
```

Resuelve la ruta del módulo de configuración del host.

Orden:
  1. `--config <path>` (CLI)
  2. `POSTMAN_CONFIG` (env)
  3. `${projectRoot}/resources/postman/examples/...` o `${projectRoot}/examples/...`
  4. Si nada → devuelve sentinel "__zero__" para que loadProject use
     buildZeroConfig().

#### `loadProject`

```ts
export async function loadProject( argv: ReadonlyArray<string> = [], context: IProjectContext, ): Promise<LoadedProject>
```

El contexto es obligatorio para que el loader sea seguro en procesos
de vida larga y no vuelva a leer la raíz cacheada del singleton
retirado de `paths.service` en r00010 S2 (2026-09-03).

#### `_internal`

```ts
export const _internal =
```

Piezas internas expuestas **solo** para sus tests.

El guion bajo es la señal: no forman parte del contrato del módulo y
pueden cambiar sin aviso.

### `packages/core/discovery/project-name.service.ts`

Nombre del proyecto, leído del manifiesto de su ecosistema.

#### `detectProjectNameIn`

```ts
export async function detectProjectNameIn(projectRoot: string): Promise<string>
```

Nombre del proyecto en `projectRoot`.

Nunca lanza: si no hay manifiesto legible, cae al nombre de la
carpeta, que siempre existe.

### `packages/core/discovery/scan-root.helper.ts`

Raíz efectiva de escaneo de un scanner — a00012 S1.b.

#### `effectiveScanRoot`

```ts
export function effectiveScanRoot(match: IProjectMatch): string
```

La raíz donde un scanner debe mirar sus fuentes.

- Sin `frameworkSearchRoot` → `match.projectRoot` (compatibilidad
  con proyectos planos y con los tests que no rellenan el campo).
- Con `frameworkSearchRoot` → `path.resolve(projectRoot,
  frameworkSearchRoot)`, siempre que el resultado siga dentro de
  `projectRoot`.

Lanza un `Error` claro si `frameworkSearchRoot` apunta fuera de
`projectRoot` (típicamente porque contiene `..` o es absoluto).

#### `safeScanRoot`

```ts
export function safeScanRoot(match: IProjectMatch): string
```

Alias de `effectiveScanRoot` con un nombre que enfatiza que el
helper **puede lanzar** cuando la ruta de búsqueda escapa de la
raíz del proyecto. Útil cuando el llamante quiere dejar explícito
que está haciendo una verificación de contención (por ejemplo, en
pipelines de varios pasos donde conviene que el `try`/`catch`
quede claro).

El comportamiento es idéntico al de `effectiveScanRoot`: misma
resolución, misma guarda, mismo error. Sólo cambia el nombre para
que el código que la usa pueda expresar su intención.

### `packages/core/discovery/summary.service.ts`

`summary` — qué ve la herramienta en un proyecto, sin escribir nada.

#### `summarizeProject`

```ts
export async function summarizeProject( projectRoot: string, orchestrator: DiscoveryOrchestrator, legacyFallback?: ILegacyDiscovery, ): Promise<IProjectSummary>
```

Inspecciona `projectRoot` y devuelve un resumen sin escribir archivos.

Lanza si el directorio no existe. Si no reconoce el proyecto,
devuelve un resumen con cero endpoints y el aviso correspondiente —
que es una respuesta honesta, no un error.

El catálogo de frameworks y el fallback se inyectan, igual que en el
pipeline: este servicio es del núcleo y no puede conocer los scanners
concretos. Para el catálogo completo hay `summarizeWithAllFrameworks()`
en `packages/frameworks/`.

### `packages/core/discovery/to-service-graph.helper.ts`

toServiceGraph - a00013 S2.

#### `toServiceGraph`

```ts
export function toServiceGraph(input: IToServiceGraphInput): IServiceGraph
```

Forma el IServiceGraph desde el estado actual del discovery.

El helper no infiere nada que no venga en el input. Si el caller
aun no popula routesByService/authByService/etc., devuelve un
grafo con la identidad de cada servicio y arrays vacios - que es
exactamente lo que S2 quiere: el shape del grafo listo para que
S3/S4 lo rellenen sin tener que cambiar el contrato.

#### `decorateServices`

```ts
export function decorateServices( graph: IServiceGraph, overrides:
```

Variante de toServiceGraph que aplica los overrides del caller
sobre cada descriptor despues de haberlos calculado. Util cuando
el caller quiere producir un IServiceGraph decorado sin tener
que re-implementar la propagacion de auth/baseUrl/variables.

Por ahora vive aqui mismo porque solo se usa desde S2 y los
tests; si S3 o S4 lo necesitan mas, se promociona a helper
independiente.

### `packages/core/discovery/workspace-glob.helper.ts`

Resolver de globs de workspaces — a00012 S1.a.

#### `resolveWorkspaceGlobs`

```ts
export async function resolveWorkspaceGlobs( projectRoot: string, globs: ReadonlyArray<string>, ): Promise<ReadonlyArray<string>>
```

Materializa una lista de globs de workspaces en directorios reales.

@param projectRoot Raíz absoluta del proyecto (los callers ya la
  absolutizaron fuera de este helper).
@param globs Globs en formato POSIX relativo, posiblemente
  prefijados con `!` para excluirlos.
@returns Directorios existentes bajo `projectRoot`, en formato
  POSIX relativo, ordenados lexicográficamente y deduplicados.
  Una ruta raíz inválida devuelve `[]`.

### `packages/core/domain/auth-flow.service.ts`

Authentication flow for the collection.

#### `hasLoginEndpoint`

```ts
export function hasLoginEndpoint( specs: ReadonlyArray<
```

If the project exposes a session endpoint, based on the specs.

`detectAuthFlow` answers the same question but for the **already-built
collection**, and some callers need to know before building it: the
authentication scheme determines which headers each request carries, so it
cannot be resolved afterward.

It intentionally shares patterns with `detectAuthFlow`. If two lists of
login routes drift, the collection could say there is bearer while the flow
wires no token, or the other way around.

#### `detectAuthFlow`

```ts
export function detectAuthFlow(collection: PostmanCollection): IAuthFlow | null
```

Locates the login, refresh, and logout endpoints in the collection.
Returns `null` if the project has none.

#### `applyAuthFlow`

```ts
export function applyAuthFlow( collection: PostmanCollection, options: IApplyAuthFlowOptions =
```

Wires the authentication flow onto an already-built collection:

  - Login and refresh save the token when they respond with 2xx.
  - The login body references `{{authUsername}}` / `{{authPassword}}`.
  - Logout clears the token.
  - The flow is documented in the login description.

Returns the applied flow, or `null` if the collection has no auth.

#### `authEnvironmentVariables`

```ts
export function authEnvironmentVariables(): Array<
```

Variables the environment needs for the auth flow.
They are added only if the collection has login.

#### `warnMissingCredentials`

```ts
export function warnMissingCredentials( warning: Omit<IMissingCredentialsWarning, "kind">, ): void
```

Emits a structured warning when the login body does not expose recognizable
credentials. The function is exported for tests and so a caller can
redirect it if another sink is needed.

The warning type lives in
`packages/contracts/interfaces/cli/auth-warning.interface.ts`; defining it
here would pull this service in just to type it, which is exactly what
`lint:contracts` prohibits.

#### `detectLaravelTokenPath`

```ts
export async function detectLaravelTokenPath(root: string): Promise<string | undefined>
```

Heuristically detects the token dot-path in a Laravel project's
AuthController. It inspects the files
`app/Http/Controllers/*Auth*Controller.php` and searches for response
patterns. If it finds nothing, it returns undefined.

### `packages/core/domain/auth-scheme.service.ts`

What authentication scheme the API uses, inferred from its endpoints.

#### `detectAuthScheme`

```ts
export function detectAuthScheme( specs: ReadonlyArray<EndpointSpec>, hasLoginFlow: boolean, ): IDetectedAuthScheme
```

Infers the API's authentication scheme.

`hasLoginFlow` is passed by the pipeline: it is whether the project exposes
a session endpoint that the auth flow has recognized and wired in.

#### `toPostmanAuth`

```ts
export function toPostmanAuth(scheme: IDetectedAuthScheme): IPostmanAuth | null
```

Translates the detected scheme to the Postman `auth` block.

Returns `null` for `none`: a collection **without** an `auth` block is
different from one with an empty block. With a block, Postman sends an
`Authorization` header with an unresolved value on every request, and the
API returns 401 for a reason unrelated to what was being tested.

#### `authVariablesFor`

```ts
export function authVariablesFor( scheme: IDetectedAuthScheme, ): Array<
```

Environment variables that need to be filled in for this scheme.

They are empty and marked as secrets: the person using the collection
supplies the value, and it must not end up in a versioned file.

### `packages/core/domain/collection-builder.service.ts`

Builds a Postman v2.1.0 collection from an `EndpointSpec` catalog, grouping the endpoints into folders automatically.

#### `buildCollection`

```ts
export function buildCollection( specs: EndpointSpec[], config: ProjectConfig, /** * API authentication scheme. * * If not passed, it is inferred from the endpoints themselves. The * parameter exists so the pipeline -- which is the only one who
```

Builds the Postman collection from the endpoint catalog and the
project configuration.

@param specs Endpoint catalog of the project.
@param config Project configuration (name, variables, zones...).

### `packages/core/domain/endpoint-merge.service.ts`

Merge of discovered endpoints with the host's manual overrides.

#### `mergeWithManual`

```ts
export function mergeWithManual( auto: EndpointSpec[], manual: EndpointSpec[], ): EndpointSpec[]
```

Merges auto-discovered specs with an optional manual catalog.
The manual spec wins on normalized method+URI (name, body, folder, description).

Exported because manual overrides are not a Laravel-specific concern:
any project can declare an `endpoints.constant.ts` to correct or extend
what the scanner infers.

### `packages/core/domain/environment-builder.service.ts`

Generates agnostic Postman v2.1.0 environments.

#### `buildEnvironment`

```ts
export function buildEnvironment( name: string, variables: PostmanVariable[], overrides: Record<string, string> =
```

Builds ONE environment.

@param name         Environment name (e.g. "Dev" or "My App · dev").
@param variables    Merged variables (config + base + path).
@param overrides    Map that OVERWRITES final values (e.g. baseUrl).
@param color        Tag color in Postman.
@param collectionId ID of the collection it belongs to; included in the
                    environment ID seed so two projects with a "Local"
                    environment do not collide.

#### `buildEnvironments`

```ts
export function buildEnvironments( specs: EndpointSpec[], configVariables: PostmanVariable[], envs: EnvironmentDef[], collectionId = "", ): PostmanEnvironment[]
```

Builds multiple environments by applying each set of `overrides` to the
base set of variables.

#### `defaultEnvironments`

```ts
export function defaultEnvironments( baseUrl: string, ): EnvironmentDef[]
```

### `packages/core/domain/param-inferrer.service.ts`

Agnostic inference of path params, query params, and body for endpoints WITHOUT an associated FormRequest.

#### `extractPathParams`

```ts
export function extractPathParams(uri: string): string[]
```

#### `exampleForPathParam`

```ts
export function exampleForPathParam(name: string): string
```

#### `exampleForQueryField`

```ts
export function exampleForQueryField(name: string): string
```

A plausible example value for a query parameter, based on its name.

`page` gives a number and `search` gives text. It is pure heuristics: it
makes the request runnable without editing it; it does not aim to be exact.

#### `inferBodyForSpec`

```ts
export function inferBodyForSpec(spec: EndpointSpec): BodyInference | null
```

Attempts to produce a useful body for an endpoint without a FormRequest using
REST-agnostic heuristics:

  - POST action without path params (e.g. `/usuarios/despersonar`): `{}`.
  - POST action with a path param (e.g. `/productos/{{id}}/reindexa`):
    adds a `force: true` field if the final segment suggests "reindex",
    "cancel", "force", etc.
  - PUT/PATCH always includes at least one agnostic boolean/flag field.

Returns `null` if it cannot find a safe heuristic.

#### `inferQueryForSpec`

```ts
export function inferQueryForSpec(spec: EndpointSpec): Array<
```

Generates default query params for a GET endpoint without a FormRequest.

- If the URI has path params that suggest a single resource (show), adds
  only `with=all` to force relationships.
- If it looks like a list/index (URI without `{`, last segment is a
  common plural or not a verb), adds pagination + search.

Conservative: if it matches nothing, returns `[]`.

#### `inferCollectionVariables`

```ts
export function inferCollectionVariables( specs: EndpointSpec[], configVariables: Array<
```

Builds a set of `{{...}}` variables from an `EndpointSpec` catalog.
It is used as a fallback when `ProjectConfig` does not provide a variable
list.

Agnostic rules:
  - `baseUrl`, `token` are always included.
  - Any `{{something}}` appearing in URIs is included if it was NOT
    already present in `configVariables`.
  - The default value is inferred with `exampleForPathParam()`.

#### `applyAgnosticInference`

```ts
export function applyAgnosticInference( specs: EndpointSpec[], options:
```

Enriches specs WITHOUT a FormRequest with inferred body and query in an
agnostic way. It does NOT touch specs that already have FR or manually
supplied body/query.

#### `_internals`

```ts
export const _internals =
```

Internal pieces exposed **only** for their tests.

The underscore is the signal: they are not part of the module contract.

### `packages/core/domain/postman-api.service.ts`

Client for the public Postman API.

#### `PostmanApiError`

```ts
export class PostmanApiError extends Error
```

#### `pushCollection`

```ts
export async function pushCollection( collection: PostmanCollection, options: IPostmanApiOptions, ): Promise<IPushResult>
```

Uploads the collection: updates it if one with the same `_postman_id`
already exists; otherwise, creates it.

#### `pushEnvironment`

```ts
export async function pushEnvironment( environment: IPostmanEnvironmentPayload, options: IPostmanApiOptions, ): Promise<IPushResult>
```

#### `verifyApiKey`

```ts
export async function verifyApiKey( options: IPostmanApiOptions, ): Promise<
```

### `packages/core/domain/project-health.service.ts`

Health of a project's documentation: percentages by category.

#### `computeProjectHealth`

```ts
export function computeProjectHealth( specs: ReadonlyArray<EndpointSpec>, ): IProjectHealth
```

Computes the project's health from the final specs.

With zero endpoints, all percentages are `0`: there is nothing to
document, and a `NaN` or a 100 without routes would be the two possible
lies. With routes, each percentage is the quotient of endpoints that
include the piece, rounded to an integer so the CLI and MCP tool display
it as-is.

The body counts if the spec carries one—from resolved rules or from
agnostic inference, which has already run before this point. Examples
count when the body has a value or params have a value; these are the two
ways the collection teaches the user **one** valid value.

### `packages/core/domain/request-doc.service.ts`

Description of a request: what the endpoint accepts, in a table.

#### `buildRequestDescription`

```ts
export function buildRequestDescription( base: string | undefined, fields: ReadonlyArray<IEndpointField> | undefined, ): string
```

Builds the Markdown description that Postman renders in the
request's documentation panel.

`base` is what the request already contained (the handler name, or the
`summary` of an OpenAPI spec). It is kept at the top: it is something
someone intentionally wrote, and replacing it with a generated table
would trade information for presentation.

### `packages/core/domain/test-script.service.ts`

Las aserciones que lleva cada request de la colección.

#### `buildTestScript`

```ts
export function buildTestScript(spec: EndpointSpec): PostmanEvent
```

#### `appendTestScript`

```ts
export function appendTestScript( existing: ReadonlyArray<PostmanEvent> | undefined, spec: EndpointSpec, ): PostmanEvent[]
```

Añade las aserciones a un item sin pisar lo que ya tuviera.

El endpoint de login ya trae su script de guardar el token, y el de
logout el de borrarlo. Sustituir el array entero se los llevaría por
delante y la colección dejaría de autenticar sola — que es la razón de
ser del flujo de auth.

### `packages/core/domain/watcher.service.ts`

Watches the project and reports when something changes.

#### `shouldIgnore`

```ts
export function shouldIgnore( relativePath: string, extraIgnored: ReadonlySet<string> = new Set(), ): boolean
```

Whether a relative path should be ignored.

Pure and exported intentionally: this is the piece that prevents the
infinite loop, and a piece like that must be testable without mounting a
filesystem.

#### `createDebouncer`

```ts
export function createDebouncer( ms: number, fn: (batch: readonly string[]) => void, ):
```

Batches consecutive calls into one, `ms` after the last one.

It also returns a `cancel` function so it can close without leaving a
timer running: otherwise the process does not terminate on Ctrl+C because
the event loop still has pending work.

#### `watchProject`

```ts
export function watchProject(options: IWatchOptions): IWatchHandle
```

Watches `root` and calls `onChange` with the changed paths.

It uses recursive `fs.watch` without polling. If the operating system does
not support it —`recursive` is not available on all BSDs— it throws a message
explaining that instead of watching only the first level and missing
everything.

There are never two `onChange` calls at once: if a change arrives while
regeneration is running, it is queued and runs afterward. Two simultaneous
generations would write the same file at the same time.

### `packages/core/exporters/bruno.exporter.ts`

Bruno exporter.

#### `BrunoExporter`

```ts
export class BrunoExporter implements IExportTarget
```

### `packages/core/exporters/export-registry.service.ts`

The catalog of output formats.

#### `registeredFormats`

```ts
export function registeredFormats(): string[]
```

The formats this registry actually produces.

It is not the catalog — the catalog is `EXPORT_FORMATS`, in
contracts — but **what the registry delivers**. A test compares the
two: a parallel list is not dangerous, an uncompared parallel list
is.

#### `describeFormats`

```ts
export function describeFormats(): Array<
```

#### `exporterFor`

```ts
export function exporterFor(format: string): IExportTarget | null
```

#### `parseFormats`

```ts
export function parseFormats(raw: string | null | undefined): IParsedFormats
```

Interprets `--format a,b,c`.

It fails **before** scanning if any format does not exist, and lists
the valid ones. Discovering a misspelled name at the end — after
walking the project and without having written the requested file
— says nothing about what happened. It is the same decision as in
`--framework`.

#### `exportTo`

```ts
export function exportTo( formats: ReadonlyArray<string>, input: IExportInput, ): IExportArtifact[]
```

Serializes the project to all requested formats.

`postman` is skipped: the pipeline writes it on its own.

#### `exportWarnings`

```ts
export function exportWarnings( formats: ReadonlyArray<string>, input: IExportInput, ): string[]
```

What the requested formats **cannot** represent.

Returned separately from the artifacts because it does not prevent
generating them: the file comes out the same, just incomplete, and
whoever requested it must know.

### `packages/core/exporters/har.exporter.ts`

Exporters to HAR 1.2 and to cURL.

#### `HarExporter`

```ts
export class HarExporter implements IExportTarget
```

#### `CurlExporter`

```ts
export class CurlExporter implements IExportTarget
```

### `packages/core/exporters/insomnia.exporter.ts`

Insomnia v4 exporter.

#### `InsomniaExporter`

```ts
export class InsomniaExporter implements IExportTarget
```

### `packages/core/exporters/openapi.exporter.ts`

Exportador a OpenAPI 3.1.0.

#### `buildOpenApiDocument`

```ts
export function buildOpenApiDocument(input: IExportInput): Record<string, unknown>
```

El documento OpenAPI como objeto, antes de serializarlo.

Se exporta para poder comprobar su **estructura** con aserciones
precisas en vez de buscando subcadenas en un YAML. Que el YAML sea
correcto es otro problema, y lo cubre `yaml.helper.spec.ts`.

#### `OpenApiExporter`

```ts
export class OpenApiExporter implements IExportTarget
```

### `packages/core/helpers/argv.helper.ts`

Leer un flag de la línea de comandos, una sola vez.

#### `readFlag`

```ts
export function readFlag( argv: ReadonlyArray<string>, name: string, ): string | undefined
```

El valor de `--flag valor`, o `undefined` si no está.

Acepta también `--flag=valor`, que es como lo escribe la mitad de la
gente y como lo generan casi todos los scripts. Antes solo funcionaba
la forma con espacio y la otra se ignoraba en silencio: el flag
parecía no estar.

#### `hasFlag`

```ts
export function hasFlag(argv: ReadonlyArray<string>, name: string): boolean
```

### `packages/core/helpers/atomic-write.helper.ts`

Escribir un fichero entero, o no escribirlo.

#### `writeFileAtomic`

```ts
export async function writeFileAtomic( destino: string, contenido: string, ): Promise<void>
```

Escribe `contenido` en `destino` de forma atómica.

Crea el directorio si hace falta. Si algo falla, `destino` se queda
exactamente como estaba y no queda ningún temporal por el medio.

#### `writeJsonAtomic`

```ts
export async function writeJsonAtomic( destino: string, valor: unknown, espacios = 2, ): Promise<void>
```

Lo mismo, para JSON.

Serializa **antes** de tocar el disco: si el objeto tiene un ciclo o
un `BigInt`, `JSON.stringify` lanza y no se ha abierto ningún fichero.
Serializar mientras se escribe es como se acaba con un fichero a
medias sin que el proceso llegue a morirse.

#### `appendFileAtomic`

```ts
export async function appendFileAtomic( destino: string, contenido: string, ): Promise<void>
```

Append atómico de `contenido` al final de `destino`.

Se diferencia de `writeFileAtomic` en lo que protege:

  - `writeFileAtomic` escribe el fichero **entero**: un `rename`
    dentro del mismo sistema de ficheros es atómico, pero el fichero
    se trunca antes del rename. Es lo que se quiere para una
    colección de Postman, donde el lector necesita la versión
    completa o nada.

  - `appendFileAtomic` añade `contenido` al final: usa `appendFile`,
    que abre el destino con `O_APPEND`. En POSIX eso es atómico
    por cada `write(2)`: dos procesos que escriben a la vez no se
    pisan —sus bytes van al final en algún orden, pero ninguno se
    pierde a medias—. Es lo que se quiere para un log en JSONL:
    cada línea es una entrada, y leer las últimas N líneas debe ser
    seguro aunque haya otra escritura en curso.

Si el fichero no existe, lo crea (mkdir recursivo del directorio,
igual que `writeFileAtomic`). Si la escritura falla, no deja
contenido parcial visible: `appendFile` no trunca antes de escribir,
así que un fallo a mitad de línea se ve como un prefijo sin newline,
y eso lo maneja la lectura tratándolo como línea corrupta.

### `packages/core/helpers/collection-file.helper.ts`

Read the collection from disk, or explain why it cannot be.

#### `readCollection`

```ts
export async function readCollection(path: string): Promise<CollectionRead>
```

Reads and parses the collection.

Distinguishes the three failures that matter, because each has a
different output: that it does not exist (need to generate), that it
cannot be read (permissions), and that it is not valid JSON (it was
written halfway, which is what `atomic-write.helper` exists to
prevent).

#### `explainReadFailure`

```ts
export function explainReadFailure( failure: Extract<CollectionRead,
```

Prints the failure in the same format as the rest of the CLI and
returns 1, so a command can do `return explain(result)` without
repeating the `console.error` block in each one.

### `packages/core/helpers/collection-identity.helper.ts`

Identidad estable de los artefactos Postman.

#### `stableUuid`

```ts
export function stableUuid(seed: string): string
```

UUID v5 determinista a partir de una semilla.

@param seed Texto que identifica al artefacto (nombre del proyecto,
            nombre del entorno…). Se normaliza para que diferencias de
            mayúsculas o espacios no produzcan IDs distintos.

#### `collectionIdFor`

```ts
export function collectionIdFor(identity: ICollectionIdentity): string
```

ID de la colección de un proyecto.

Si el host declara `collectionId`, se respeta tal cual: es la vía para
conservar la colección en Postman aunque se renombre o se mueva el
proyecto de carpeta.

#### `environmentIdFor`

```ts
export function environmentIdFor(collectionId: string, environmentName: string): string
```

### `packages/core/helpers/collection-invariants.helper.ts`

Invariants a collection must satisfy for Postman to import it and be usable.

#### `checkCollectionInvariants`

```ts
export function checkCollectionInvariants( collection: PostmanCollection, ): ICollectionIssue[]
```

Checks all invariants and returns the violations. Empty list = the
collection is correct.

#### `collectionErrors`

```ts
export function collectionErrors(collection: PostmanCollection): ICollectionIssue[]
```

### `packages/core/helpers/fs-walk.helper.ts`

Recorrido recursivo de directorios para los scanners.

#### `collectFiles`

```ts
export async function collectFiles( root: string, matches: (fileName: string) => boolean, options: ICollectFilesOptions =
```

Rutas absolutas de todos los ficheros bajo `root` (recursivo) cuyo
nombre pasa el filtro.

Nunca lanza. Un directorio ilegible o un ciclo de enlaces se saltan y
el resto del árbol se recorre igual — que es lo que esta función
prometía y no cumplía.

#### `collectFilesFrom`

```ts
export async function collectFilesFrom( roots: ReadonlyArray<string>, matches: (fileName: string) => boolean, options: ICollectFilesOptions =
```

Igual que `collectFiles` sobre varias raíces, sin repetidos y
saltándose las que no existen.

#### `isSourceJsTsFile`

```ts
export function isSourceJsTsFile(name: string): boolean
```

### `packages/core/helpers/module-path.helper.ts`

Directory of the current module, in a portable way.

#### `moduleDir`

```ts
export function moduleDir(importMetaUrl: string): string
```

#### `repoRoot`

```ts
export function repoRoot(importMetaUrl: string): string
```

Repo/package root: walks up from the module until it finds a
`package.json`.

Before, each script counted its own `".."` to the root. That works
until the file moves to a different folder, and then `PACKAGE_ROOT`
points elsewhere **without failing**: the script simply does not find
anything and says "no proposals found". It happened with four gates
at once when reorganizing into `packages/`.

Counting levels is coupling a file to its depth in the tree.
Looking for the marker is not.

#### `findRepoRoot`

```ts
export function findRepoRoot(importMetaUrl: string): string | null
```

Like `repoRoot()`, but returns `null` instead of throwing.

Production code needs this: inside the compiled binary the modules
live in a virtual file system (`/$bunfs/root/`) where there is no
`package.json`, so there is no root to find. Throwing there crashes
the whole binary at startup — it happened when this helper was
introduced, and the binary-without-runtime test was what caught it.

Rule: gates and tests use `repoRoot()`, which throws because a
failure there is a repo failure. Code that ends up inside the binary
uses this one and has a plan B.

### `packages/core/helpers/parse-json.helper.ts`

Parsear JSON ajeno sin que `any` se cuele en el resto del programa.

#### `parseJson`

```ts
export function parseJson(raw: string): JsonRead
```

Parsea, distinguiendo "no se pudo" de "parseó a `null`".

Los dos casos se confundían: `JSON.parse("null")` devuelve `null`, y
un `catch` que también deja `null` hace que un fichero corrupto y uno
que legítimamente contiene `null` acaben iguales. Solo uno de los dos
merece un aviso.

#### `isRecord`

```ts
export function isRecord(value: unknown): value is Record<string, unknown>
```

#### `readObject`

```ts
export function readObject( value: unknown, key: string, ): Record<string, unknown> | undefined
```

#### `readString`

```ts
export function readString(value: unknown, key: string): string | undefined
```

#### `readArray`

```ts
export function readArray(value: unknown, key: string): unknown[] | undefined
```

#### `declaredDependencies`

```ts
export function declaredDependencies(pkg: unknown): Record<string, string>
```

Las dependencias declaradas en un `package.json`, fundidas.

`dependencies` y `devDependencies` juntas, porque la pregunta que los
scanners hacen es «¿este proyecto usa X?» y un framework en
`devDependencies` sigue siendo el framework del proyecto. Unos
scanners las miraban y otros no, así que el mismo proyecto se
detectaba o no según cuál preguntara.

### `packages/core/helpers/path-containment.helper.ts`

Does this path escape where it's supposed to write?

#### `ensureInside`

```ts
export async function ensureInside( root: string, target: string, ): Promise<ContainmentResult>
```

Is `target` inside `root`?

The root itself counts as inside. Returns the already-resolved path
so the caller uses that and not the original: checking one and
writing in another is how these checks get bypassed.

#### `ensureInsideAny`

```ts
export async function ensureInsideAny( roots: ReadonlyArray<string>, target: string, ): Promise<ContainmentResult>
```

Is `target` inside **any** of the roots?

Several, not just one, because a single one does not describe the
legitimate use. An agent may ask "generate for project X and leave
the output in my working folder", and those are two distinct and
both reasonable locations. With a single root that was rejected, and
a guard that blocks normal use eventually gets removed.

What does stay out is the rest of the disk: the output goes with the
project, inside the workspace, or in a temp dir — not to anyone's
`$HOME` because a `../` slipped into an argument.

### `packages/core/helpers/postman.helper.ts`

Helpers reutilizables para recorrer y analizar colecciones Postman.

#### `pathToSegments`

```ts
export function pathToSegments(rawUrl: string): string[]
```

#### `uriFromRaw`

```ts
export function uriFromRaw(rawUrl: string): string
```

#### `walkCollection`

```ts
export function walkCollection( collection: PostmanCollection, ): CollectionRequest[]
```

Recorre la colección y devuelve todos los requests planos.
Si `folder` se pasa, se usa como prefijo del path de carpetas.

#### `countItems`

```ts
export function countItems(collection: PostmanCollection):
```

### `packages/core/helpers/read-files.helper.ts`

Read many files without reading them one at a time.

#### `readAllFiles`

```ts
export async function readAllFiles( paths: ReadonlyArray<string>, limit: number = READ_CONCURRENCY, ): Promise<IReadFile[]>
```

Same, but into an array.

For those who need the whole list anyway (a `Map` of module → content,
for example). If it is only going to be walked once, use the generator:
it spends bounded memory instead of all of it.

### `packages/core/helpers/regex.helper.ts`

Shared regexes used without stepping on each other.

#### `ownRegex`

```ts
export function ownRegex(shared: RegExp): RegExp
```

An own copy of a shared regex.

It starts with `lastIndex` at zero and nobody else touches it, so it
can be used with `exec` without coordinating with the rest of the
process.

### `packages/core/helpers/resolve-root.helper.ts`

Where the project root comes from, in one place.

#### `resolveRoot`

```ts
export function resolveRoot(options: IResolveRootOptions =
```

The project root: `--project-root`, then `POSTMAN_PROJECT_ROOT`, and
as a last resort the current directory.

The order is the one two of the three commands already had, so it
changes nobody's behavior — it just makes it consistent across all
of them and adds where it came from.

#### `guessedRootNotice`

```ts
export function guessedRootNotice(resolved: IResolvedRoot): string
```

The notice that the root has been guessed, or an empty string.

Returned instead of printed so the caller decides where it goes —
`console.log`, a JSON report, the GUI — and so it can be tested
without capturing output.

### `packages/core/helpers/route-identity.helper.ts`

What makes two endpoints the same endpoint.

#### `endpointKey`

```ts
export function endpointKey(identity: IEndpointIdentity): string
```

The key of an operation. Same operation, same key.

The URI is always normalized, so `/api/users` and `api/users` are not
counted as two. The name and body only enter when present: adding
them empty would make a route with a name and the same one without
it stop matching, which is the opposite of what we want.

#### `describeEndpoint`

```ts
export function describeEndpoint(identity: IEndpointIdentity): string
```

How an operation is called when it has to be shown to someone.

`POST /graphql` repeated three times says nothing: the name is needed
to know which one is missing. This is what turns a list of three
identical lines into a useful list.

#### `needsNameToDisambiguate`

```ts
export function needsNameToDisambiguate( routes: ReadonlyArray<IEndpointIdentity>, ): boolean
```

Does this protocol distinguish operations by name?

It is not a list of frameworks: it is a property of the routes that
arrive. If several share method and URI, the name is the only thing
left — and it does not matter whether it is GraphQL, tRPC, or a
hand-written JSON-RPC. Asking this way avoids a list that has to be
maintained every time a new framework is supported.

### `packages/core/helpers/source-scan.helper.ts`

Source-code scanning primitives shared by the scanners.

#### `stripJsComments`

```ts
export function stripJsComments(src: string): string
```

Strips block and line comments from a JS/TS source.

The `//` is dropped only if it is not preceded by `:`, to avoid
breaking URLs (`https://…`) that appear in string literals.

#### `findClosingParen`

```ts
export function findClosingParen(text: string, openIndex: number): number
```

Finds the `)` that closes the `(` located at `openIndex`, respecting
nesting. Returns `-1` if the parenthesis is never closed.

#### `findAllBalanced`

```ts
export function findAllBalanced(text: string, pattern: RegExp): IBalancedCall[]
```

All occurrences of `pattern` in `text`, each with the balanced
position of its call.

`pattern` must describe the prefix of a call (e.g.
`/z\.object\s*\(/`); the `(` is searched from the start of the match.
The regex is always re-created with the `g` flag, so it does not
matter how the caller declared it.

#### `findNearestBalanced`

```ts
export function findNearestBalanced( text: string, pattern: RegExp, nearLine: number, ): IBalancedCall | null
```

Of all calls that match `pattern`, the closest (by line count) to
`nearLine`. Used to associate a schema with the handler that uses it
when a single file declares several.

#### `countLinesBefore`

```ts
export function countLinesBefore(text: string, index: number): number
```

#### `splitTopLevel`

```ts
export function splitTopLevel(body: string): string[]
```

Splits the inside of an object literal by top-level commas.

Ignores commas inside strings (`'`, `"`, backtick, with escapes) and
inside nested `()`, `{}` or `[]`. The depth starts at 1 because the
received text includes the outer braces of the object.

#### `unwrapObjectLiteralItem`

```ts
export function unwrapObjectLiteralItem(item: string): string
```

Removes the outer braces and trailing whitespace from an item
returned by `splitTopLevel` (the first drags the `{`, the last the `}`).

#### `maskStringLiterals`

```ts
export function maskStringLiterals(src: string): string
```

Replaces the **contents** of strings with spaces, keeping the quotes
and the total length.

Used to answer a question the scanners ask all the time without
knowing it: *is this call actually in the code, or is it inside a
string?* A file with

    const help = 'use router.get("/x") to register';

produced a `GET /x` endpoint that does not exist. The text of a
string is not code, but for a regex it reads the same.

Length is preserved on purpose: this way the offsets on the mask are
valid on the original source, and we can search on the mask and read
from the original. Without that we'd need to maintain a position
map, which is the kind of thing that desyncs.

Covers single quotes, double quotes, and templates. Inside a
template, what goes in `${…}` **is** code and is preserved: that is
where the interpolations live that other lints need to see.

#### `findOutsideStrings`

```ts
export function findOutsideStrings( src: string, pattern: RegExp, ): Array<
```

The occurrences of `pattern` that are **outside** any string.

The trick has two halves and both are needed:

  1. We **search** on the mask, where the contents of the strings
     are spaces. So a call written inside a text —
     `'use router.get("/x")'`— does not appear.
  2. We **read** from the original source, at the same position. The
     mask preserves length exactly for this: the path of a real
     route IS a string, so on the mask it comes out blank and
     reading it from there would give empty paths.

Skipping the second half is easy and the failure is silent: the
captured groups come out full of spaces and the paths are discarded
one by one without anything saying so.

### `packages/core/helpers/uri.helper.ts`

Helpers to normalize URIs before comparing.

#### `normalizeForComparison`

```ts
export function normalizeForComparison(uri: string): string
```

Helpers to normalize URIs before comparing.

URIs have five forms that must match:
  - Laravel: `{client}` or `{client:code}`
  - Express: `:clientId`
  - FastAPI: `{client_id}` (same format as Laravel)
  - Django:  `<id>`, `<int:id>`, `<str:slug>`, `<uuid:token>`
  - Postman: `{{clientId}}`

`normalizeForComparison` reduces any parameterized token to `:p`
(same marker regardless of name). This is enough for the vast
majority of cases. The exception are endpoints that differ only by
parameter name and by a `where()` regex in Laravel (e.g.
`/search/{historic}` vs `/search/{plate}`); these are documented in
the catalog with different names and the generation script reports
them as separate requests even though they normalize the same.

#### `stripApiPrefix`

```ts
export function stripApiPrefix(uri: string): string
```

#### `joinRoutePath`

```ts
export function joinRoutePath(...segments: string[]): string
```

Joins the segments of a path (class/group prefix + method path) into
a normalized URI.

The trailing slash is preserved **only if the last non-empty segment
declared it**. That distinction matters:

  - Django: `path("<int:id>/", …)` brings it on purpose. With
    `APPEND_SLASH = True` (the default), calling without it returns
    a 301 and a POST loses its body on the redirect.
  - NestJS, Spring Boot, ASP.NET and Flask: `@Controller("orders")` +
    `@Get()` concatenated `"orders" + "/" + ""` and produced `orders/`.
    There the slash is an artifact, not a decision.

#### `topGroupFor`

```ts
export function topGroupFor( uri: string, uriGroupOverrides: Record<string, string> =
```

Returns the logical top-level group of a URI (first meaningful
segment). For example:

  "api/customers"             → "customers"
  "api/customers/{customer}"  → "customers"
  "api/erp/products"          → "erp"
  "api/orders/history"        → "orders"
  "alive" / "login"           → "login" / "alive"

If the URI starts with `api/`, it is skipped. Special cases are
configured via `uriGroupOverrides` (e.g. `{ "tol/tecdoc": "tol/tecdoc" }`).

@param uri URI to analyze.
@param uriGroupOverrides Map of prefix → group key (from `ProjectConfig`).

#### `prettyGroupName`

```ts
export function prettyGroupName(topGroup: string): string
```

The human-readable name of a folder from its key.

`erp-products` becomes `Erp Products`. Only affects what is read in
Postman: the key is still the one that groups.

### `packages/core/helpers/yaml.helper.ts`

YAML serializer for flat data.

#### `toYaml`

```ts
export function toYaml(value: YamlValue): string
```

### `packages/core/helpers/zone.helper.ts`

Logical-zone helpers.

#### `zoneForUri`

```ts
export function zoneForUri(uri: string, config: ProjectConfig): string
```

Computes the logical zone from the endpoint URI and the project
configuration.

#### `zonesToDisplay`

```ts
export function zonesToDisplay( present: Iterable<string>, config: Pick<ProjectConfig, "zoneOrder" | "defaultZone">, ): string[]
```

The order in which zones that **have content** are shown.

`zoneOrder` is the preference of whoever configures the project, not
the list of zones that exist. And in zero-config — the normal case,
the 21 examples — it comes **empty**, with all endpoints falling into
`defaultZone`.

`list` and `stats` used to walk `zoneOrder` directly to print, so in
zero-config they printed **nothing**: `list` said "9 endpoints in the
collection, grouped by zone:" and then left the screen blank. It was
not a GraphQL failure or a specific framework's — it happened in all
twenty-one, and the entire command served no purpose.

Here we return the zones actually present: first those that
`zoneOrder` names, in their order, then the rest sorted
alphabetically so two runs produce the same. Empty zones are omitted,
which is what the previous code did right.

### `packages/core/language-frontends/typescript/typescript.parser.ts`

`parse(source, filename): TSFile` — the TypeScript frontend.

#### `parse`

```ts
export function parse(source: string, filename: string): TSFile
```

Parses `source` (TS/JS code) and returns the normalized AST.

`filename` is attached to the AST so adapters can report errors and
scanners can show it to the user. It is not used internally — Babel
accepts it but we do not care here.

If Babel cannot parse the file, throws `SyntaxError`. Callers that
want to degrade silently use `parseModule` with an
`IParseDiagnostic` array (a00011 C-7 / B-rev-13).

The order within each `TSFile` collection is top-down with respect
to the file: at the end of the parse each collection is sorted by
`(line, column)` ascending, so the contract does not depend on the
internal order of the walker (a00011 C-7 / B-rev-11).

Audit 2026-09-04 P2 #7: the `jsx` plugin is activated when
`filename` ends in `.tsx`/`.jsx`. Without this, Babel rejected JSX
syntax (`<Foo />`) with a syntax error and the scanner lost
Next.js / React components.

#### `parseModule`

```ts
export function parseModule( source: string, filename: string, diagnostics?: Array<IParseDiagnostic>, ): TSFile | null
```

Non-throwing variant of `parse`: if Babel rejects the file, returns
`null` and records the reason in `diagnostics` (if the array came
in) instead of swallowing the error silently.

The scanner keeps working — a file with invalid syntax does not
abort the scan — but the failure stays visible to whoever wants to
report it (today: `IScanResult.diagnostics`).

### `packages/core/schema/build-schema-graph.helper.ts`

Build a `SchemaGraph` from `IValidationSpec[]`.

#### `createObjectNode`

```ts
export function createObjectNode( id: SchemaNodeId, children: ReadonlyArray<ISchemaEdge>, options: ICompositeOptions =
```

Builds an `object` node with the given children.

`children` is copied: mutating the caller's array afterwards does
not affect the node. The id is provided by the caller (typically the
builder) to avoid collisions in graphs under construction.

#### `createArrayNode`

```ts
export function createArrayNode( id: SchemaNodeId, itemId: SchemaNodeId, options: ICompositeOptions =
```

Builds an `array` node whose only child is `itemId`.

The item lives in an `ISchemaEdge` with `name: "items"` and
`required: true` — an array without an item is not an array, and an
optional item in an array does not exist in JSON Schema (`items`
always applies to every element).

#### `SchemaGraphBuilder`

```ts
export class SchemaGraphBuilder
```

`SchemaGraph` builder.

Keeps a local id counter and a node map. Each `add*` returns the id
of the created node, so the caller can chain references without
inventing ids. The builder is **single-use**: after `build()`, it
accepts no more `add*`.

#### `buildSchemaGraph`

```ts
export function buildSchemaGraph( specs: ReadonlyArray<IValidationSpec>, options: IBuildOptions =
```

Builds a minimum `SchemaGraph` from `IValidationSpec[]`.

The root node is an `object` with one child per spec. Each spec is
translated with `SchemaGraphBuilder.addFromSpec`. The resulting graph
serves exporters that know how to read it and, with `flatten-helper`,
those that do not.

### `packages/core/schema/flatten.helper.ts`

Flatten a `SchemaGraph` into the flat `IEndpointField[]` list.

#### `flatten`

```ts
export function flatten( graph: ISchemaGraph, location: TFieldLocation = "body", ): IEndpointField[]
```

Flattens the graph starting from its root.

Shortcut for `flattenFrom(graph, graph.root, "body")`.

#### `flattenFrom`

```ts
export function flattenFrom( graph: ISchemaGraph, rootId: SchemaNodeId, location: TFieldLocation, ): IEndpointField[]
```

Flattens a subgraph starting at a specific node.

`rootId` must be in `graph.nodes`. If it is not, returns `[]`: the
graph does not contain the root, so there is nothing to flatten.

`location` is the location assigned to the emitted fields. The same
graph can be flattened once with `body` and once with `query` if the
caller cares (not the case today, but the function accepts it without
cost).

### `packages/core/schema/reference.helper.ts`

Reference nodes and `$ref` resolution in the `SchemaGraph`.

#### `createReferenceNode`

```ts
export function createReferenceNode( ref: SchemaNodeId, id: SchemaNodeId, options: IReferenceOptions =
```

Builds a `reference` node.

The id referenced by the node (`ref`) must exist in the target graph.
Checking it at build time would be O(n) per node and would become
brittle on graphs under construction: the builder usually adds the
target **after** the `reference`, so early verification would fail.
The invariant is validated at closure (`resolveReference` or in
`flatten-helper`), not on every `add`.

#### `resolveReference`

```ts
export function resolveReference( graph: ISchemaGraph, ref: SchemaNodeId, ): ISchemaNode | undefined
```

Resolves a local `$ref`.

If the graph contains the target, returns the node. Otherwise returns
`undefined`: the caller decides whether to treat it as an error
(strict validation) or to emit the literal `$ref` (lax exporter).

#### `deriveLocalRefName`

```ts
export function deriveLocalRefName( node: ISchemaNode, fallback: (node: ISchemaNode) => string = (n) => n.id, ): string
```

Derives a stable name to use as a nominal `$ref`.

If the node has a `name`, it is used as-is: it is the logical name
the scanner set and the one expected in the target document.
Otherwise, it falls back to the id: less pretty, but it guarantees
two calls with the same input produce the same name.

Exporters that prefer not to invent names for anonymous nodes should
check `node.name !== undefined` before calling here.

### `packages/core/schema/scalar.helper.ts`

Scalar node constructors for the `SchemaGraph`.

#### `createScalarNode`

```ts
export function createScalarNode( scalarType: ScalarType, id: SchemaNodeId, options: IScalarOptions =
```

Builds a `scalar` node.

The id is provided by the caller: usually it comes from the
`SchemaGraphBuilder`, which keeps the single registry of nodes.
Passing ids from outside the builder would cause silent collisions.

#### `createEnumNode`

```ts
export function createEnumNode( values: ReadonlyArray<string>, id: SchemaNodeId, options: IScalarOptions =
```

Builds an `enum` node.

`values` is not validated here: the caller knows what they are
declaring, and an empty list is a real case (an `enum` declared in
code that the scanner did not populate). What is frozen is the
reference: an `enum` should not mutate after being built.

#### `createLiteralNode`

```ts
export function createLiteralNode( literal: unknown, id: SchemaNodeId, ): ISchemaNode
```

Builds a `literal` node.

`literal` is `unknown` because it accepts any JSON primitive value:
a `42`, a `"foo"`, a `true`, a `null`. What the exporter does with it
depends on the target format: JSON Schema renders it as
`{ const: <value> }`.

#### `constraintsFromValidationSpec`

```ts
export function constraintsFromValidationSpec( spec: IValidationSpec, ): ISchemaConstraints | undefined
```

Translates the constraints of an `IValidationSpec` to `ISchemaConstraints`.

Constraints live **outside the node**: a `scalar` node carries its
type (`string`, `integer`…) and this object carries the adornments
(`format`, `minimum`, `pattern`…). Separating them makes clear that
they are orthogonal, and that `flatten-helper` can treat constraints
as metadata without walking the graph.

Returns `undefined` if there are no constraints: `ISchemaNode`
distinguishes between "has no constraints" and "has empty
constraints", and we respect that distinction here.

### `packages/core/schema/serialize.helper.ts`

Serialization of the `SchemaGraph` for process boundaries.

#### `createSchemaGraph`

```ts
export function createSchemaGraph( nodes: ReadonlyMap<SchemaNodeId, ISchemaNode>, root: SchemaNodeId, ): ISchemaGraph
```

Builds an `ISchemaGraph` from a `Map` and a root id.

Returns an object with `toDTO()` bound to the map. This is the only
valid way to satisfy the interface from external code: literals of
the form `{ nodes: map, root }` no longer compile because the
interface requires `toDTO`.

If you need a graph from a DTO, use `fromDTO(dto)` (which in turn
delegates here).

#### `toDTO`

```ts
export function toDTO(graph: ISchemaGraph): ISchemaGraphDTO
```

Converts an `ISchemaGraph` to its JSON-serializable DTO.

Implements the interface's `toDTO()` method and is also exported as
a free function. Both paths produce the same result:
`graph.toDTO() === toDTO(graph)` for any graph.

The `nodes` array comes out in the underlying `Map`'s iteration
order (insertion order). That guarantees two calls on the same
graph produce the same DTO, and `fromDTO(toDTO(graph))` recovers
the same graph by content equality.

#### `fromDTO`

```ts
export function fromDTO(dto: ISchemaGraphDTO): ISchemaGraph
```

Rebuilds an `ISchemaGraph` from a DTO.

Creates a new `Map` from the DTO entries and wraps it with
`createSchemaGraph` (which adds `toDTO`). Useful on the opposite
boundary: if the graph comes as JSON from MCP, cache, or a persisted
snapshot, this function returns it in the in-memory form exporters
work with.

#### `sortByLocation`

```ts
export function sortByLocation(graph: ISchemaGraph): ISchemaGraph
```

Returns a copy of the graph with nodes in stable order.

Today: the copy keeps the iteration order of the original `Map`
(insertion order), so the result is stable for the same input
graph.

Tomorrow: when `ISchemaNode` carries `location?: { line, column }`,
this function sorts by `(line, column, id)` — the same order in
which they appear in the source file. The AST frontend
(`a00010 S7`) produces that top-down order; this helper preserves
it when crossing the JSON boundary.

### `packages/core/schema/union.helper.ts`

Union and intersection nodes for the `SchemaGraph`.

#### `createUnionNode`

```ts
export function createUnionNode( alternatives: ReadonlyArray<SchemaNodeId>, id: SchemaNodeId, options: ICompositeOptions =
```

Builds a `union` node (`oneOf`).

`alternatives` may have a single element: `oneOf` with a single
candidate is legal and flattens to that candidate. We do not flatten
it here: if the caller wants it flat, they build it flat. The helper
only respects the shape it receives.

#### `createIntersectionNode`

```ts
export function createIntersectionNode( alternatives: ReadonlyArray<SchemaNodeId>, id: SchemaNodeId, options: ICompositeOptions =
```

Builds an `intersection` node (`allOf`).

Empty: an `allOf` without candidates equals `true` in JSON Schema,
which is a pathological case. The caller decides whether to pass an
empty list (the helper respects it without error) or reject it before
calling.

### `packages/core/validation/validation-enricher.service.ts`

Registry of framework-agnostic validation enrichers.

#### `registerValidationEnricher`

```ts
export function registerValidationEnricher(e: IValidationEnricher): void
```

Registers (or replaces) an enricher for its provider.

Idempotent: registering the same provider twice leaves the second
one active. The contract says "one enricher per provider", so
double registrations are a programming error — but the registry
does not complain because a test that registers a stub and then the
real one (or vice versa) is still useful as long as they behave the
same.

#### `getValidationEnricher`

```ts
export function getValidationEnricher( p: ValidationProvider, ): IValidationEnricher | undefined
```

#### `runValidationEnrichers`

```ts
export function runValidationEnrichers(spec: EndpointSpec): EndpointSpec
```

Runs the enricher registered for the spec's `provider`.

  - No `validationSource` → nothing to enrich; returns the spec unchanged.
  - With `validationSource` but no registered enricher → not an
    error: it means that framework has not migrated yet. The spec
    comes back unchanged.
  - With a registered enricher → returns `enricher.enrich(spec)`.

The function is pure and synchronous. Phase 1 only needs this;
moving I/O into the enrichers is follow-up for the next phase (each
provider already loads its rules when building the spec, in the
adapter).

#### `_resetValidationEnrichersForTests`

```ts
export function _resetValidationEnrichersForTests(): void
```

### `packages/frameworks/index.ts`

Capa de frameworks — todo lo que sabe de un framework concreto.

#### `generateWithAllFrameworks`

```ts
export function generateWithAllFrameworks( projectRoot: string, options: IGenerateOptions =
```

Genera la colección con **todos** los frameworks soportados.

Es el atajo para el 99% de los casos: el CLI, el plugin y el gate no
quieren elegir catálogo, quieren el completo. Quien sí necesite un
subconjunto (un test que solo debe ver un framework, un consumidor
que embebe la librería) llama a `generateCollection()` directamente y
le pasa el suyo.

#### `summarizeWithAllFrameworks`

```ts
export function summarizeWithAllFrameworks( projectRoot: string, ): Promise<IProjectSummary>
```

Inspecciona un proyecto con todos los frameworks soportados.

El equivalente de `generateWithAllFrameworks()` para el camino de
solo lectura: `summary`, el modo `--inspect` y el tool del plugin.

