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

> 135 símbolos en 42 módulos.

### `projects/core/adapters/parsed-route-to-spec.adapter.ts`

Adapter universal: `ParsedRoute` (neutro) → `EndpointSpec` (Postman).

#### `toPostmanUri`

```ts
export function toPostmanUri(laravelUri: string): string
```

prefix aplicado desde el scanner; aquí solo normalizamos el formato

#### `deriveName`

```ts
export function deriveName(route: ParsedRoute): string
```

Deriva un nombre legible a partir del método HTTP + URI.

Se exporta para poder probarla sola: es una función pura de la ruta, y
lo contrario obligaría a montar un scanner entero para comprobar cómo
queda un nombre.

#### `buildSpecsFromScanner`

```ts
export async function buildSpecsFromScanner( scanner: IRouteScanner, match: IProjectMatch, validation: IValidationSpecProvider | null, ): Promise<AdapterResult>
```

Construye `EndpointSpec[]` a partir de un `IRouteScanner` y, si
se da, su `IValidationSpecProvider`. Devuelve un `AdapterResult`
con la misma forma que el `discoverEndpoints` legacy.

#### `_peekSpec`

```ts
export async function _peekSpec(projectRoot: string): Promise<string | null>
```

### `projects/core/discovery/discovery.orchestrator.ts`

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

### `projects/core/discovery/generation.pipeline.ts`

Pipeline de generación: `projectRoot` → `PostmanCollection`.

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

### `projects/core/discovery/paths.service.ts`

Fachada con estado sobre `project-context.service.ts`.

#### `projectRootWasExplicit`

```ts
export function projectRootWasExplicit(): boolean
```

¿La raíz del proyecto la eligió alguien, o se cayó al directorio
actual?

`projectRoot()` **nunca** devuelve `null`: si no hay `--project-root`
ni `POSTMAN_PROJECT_ROOT`, acaba en `process.cwd()`. Eso deja muerta
la rama «no se pudo determinar la raíz» que varios comandos tienen
escrita, y —peor— hace que lanzar la herramienta desde el sitio
equivocado escanee ese árbol entero sin decir nada.

Se midió: `watch --once` lanzado desde `/tmp` recorrió el directorio,
encontró un proyecto suelto y generó su colección. Desde `$HOME`
recorrería la casa.

No se cambia el fallback —es cómodo y hay quien lo usa—, pero quien
llama puede preguntar y avisar. Un comportamiento implícito deja de
ser una trampa en cuanto se dice en voz alta.

#### `resetPathCache`

```ts
export function resetPathCache(): void
```

#### `withScopedPaths`

```ts
export async function withScopedPaths<T>( scope: IPathScope, fn: () => Promise<T>, ): Promise<T>
```

Ejecuta `fn` con las rutas del scope fijadas, y restaura el estado
anterior al terminar (también si `fn` lanza).

Existe porque `outputDir()` y `projectRoot()` leen `process.argv` y
`process.env`, no argumentos. Quien invoca un comando **en el mismo
proceso** —el asistente interactivo llamando a `generate`— le pasa un
array de flags que esas funciones no miran: leen el argv del proceso,
que es el del asistente. El resultado era que la opción "escribir en
otra carpeta" del asistente aceptaba la carpeta, la mostraba, y
escribía en la de por defecto.

#### `withProjectRoot`

```ts
export async function withProjectRoot<T>( root: string, fn: () => Promise<T>, ): Promise<T>
```

Ejecuta `fn` con la raíz del proyecto fijada a `root`.

Atajo de `withScopedPaths` para el caso más común. Restaura el estado
anterior al terminar, también si `fn` lanza.

#### `packageRoot`

```ts
export function packageRoot(): string
```

#### `projectRoot`

```ts
export function projectRoot(): string | null
```

#### `routesDir`

```ts
export function routesDir(): string | null
```

#### `appDir`

```ts
export function appDir(): string | null
```

#### `requestsDir`

```ts
export function requestsDir(): string | null
```

#### `projectBasename`

```ts
export function projectBasename(): string
```

#### `packageBasename`

```ts
export function packageBasename(): string
```

Nombre de **este** paquete, no del proyecto que se escanea.

La distinción importa: cuando la herramienta está instalada dentro del
proyecto, los dos nombres conviven y confundirlos hace que la colección
salga llamándose `export-to-postman` en vez de como la API.

#### `outputDir`

```ts
export function outputDir(): string
```

Devuelve el directorio donde se escriben los artefactos.
Regla:
  1. CLI `--output-dir <path>` o `--output <file>` (parent).
  2. Env `POSTMAN_OUTPUT_DIR`.
  3. Si el paquete está **dentro** del proyecto → `${packageRoot}/export-to-postman/`.
     Si NO → `${projectRoot}/export-to-postman/`.
  4. `process.cwd()/export-to-postman/` fallback.

#### `outputBasename`

```ts
export function outputBasename(projectName?: string): string
```

Nombre base del JSON de salida.
Prioridad: env `POSTMAN_OUTPUT_BASENAME` → nombre del proyecto.

#### `outputCollectionPath`

```ts
export async function outputCollectionPath( projectName?: string, ): Promise<string>
```

#### `outputEnvironmentPath`

```ts
export async function outputEnvironmentPath( envName: string, projectName?: string, ): Promise<string>
```

#### `toProjectRelative`

```ts
export function toProjectRelative(absPath: string): string
```

Convierte una ruta absoluta del proyecto a una relativa al proyecto
(formato POSIX). Lanza si no hay raíz de proyecto conocida.

#### `fromProjectRelative`

```ts
export function fromProjectRelative(relPath: string): string
```

Convierte una ruta relativa al proyecto escaneado en absoluta.

Ojo: relativa al **proyecto que se escanea**, no a este paquete. Es la
distinción que hace que un scanner pueda emitir `src/routes/x.ts` sin
saber dónde está instalado.

#### `describeDiscoveredPaths`

```ts
export function describeDiscoveredPaths(projectName?: string): string
```

Las rutas resueltas, en texto, para la traza del CLI.

Se imprime antes de escanear a propósito: cuando la salida no es la
esperada, lo primero que hay que descartar es que se esté mirando otra
carpeta.

## Por qué recibe el nombre del proyecto

Porque sin él **mentía**, y justo en la línea que existe para no
mentir. `outputBasename()` sin argumento se cae a `projectBasename()`,
que es el nombre del **directorio**; el fichero real se llama como el
proyecto dice llamarse en su manifiesto. Sobre una copia de
`example-express` en una carpeta `api/`, la traza anunciaba
`api.postman_collection.json` y el CLI escribía
`sample-express.postman_collection.json` tres líneas más abajo.

Quien la imprime todavía no ha cargado la configuración —esa es la
gracia de imprimirla antes—, así que el nombre es opcional: sin él se
dice que aún no se sabe, en vez de inventarse uno.

### `projects/core/discovery/project-context.service.ts`

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

#### `hasProjectDir`

```ts
export function hasProjectDir(context: IProjectContext, relPath: string): boolean
```

### `projects/core/discovery/project-loader.service.ts`

Carga la configuración del proyecto host de forma agnóstica.

#### `detectProjectName`

```ts
export async function detectProjectName( context?: IProjectContext, ): Promise<string>
```

Devuelve el nombre del proyecto host.

La lectura de manifiestos vive en `project-name.service`: aquí solo
se resuelve la raíz. Antes esta función miraba únicamente
`composer.json`, con lo que Laravel se llamaba como su paquete y los
otros once frameworks como su carpeta.

#### `detectFilePrefixes`

```ts
export async function detectFilePrefixes( context?: IProjectContext, ): Promise<Record<string, string[]>>
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
export async function buildZeroConfig( context?: IProjectContext, ): Promise<ProjectConfig>
```

Genera un ProjectConfig mínimo viable sin archivo del host.
Útil para que el paquete funcione "out-of-the-box" en cualquier proyecto.

#### `resolveConfigPath`

```ts
export async function resolveConfigPath( argv: string[] = process.argv, context?: IProjectContext, ): Promise<string>
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
export async function loadProject( argv: string[] = process.argv, context?: IProjectContext, ): Promise<LoadedProject>
```

`context` es opcional y no es un descuido.

Quien lo pasa —el pipeline— deja de depender del singleton de
`paths.service` para saber qué proyecto está cargando. Quien no lo
pasa —los comandos del CLI, un proceso por proyecto— sigue funcionando
igual, porque ahí el estado global no puede confundirse con nada.

La diferencia importa en consumidores de vida larga: el servidor MCP
cargaba la config del proyecto A al pedirle el B, porque `projectRoot()`
se resuelve una vez por proceso.

#### `_internal`

```ts
export const _internal =
```

Piezas internas expuestas **solo** para sus tests.

El guion bajo es la señal: no forman parte del contrato del módulo y
pueden cambiar sin aviso.

### `projects/core/discovery/project-name.service.ts`

Nombre del proyecto, leído del manifiesto de su ecosistema.

#### `detectProjectNameIn`

```ts
export async function detectProjectNameIn(projectRoot: string): Promise<string>
```

Nombre del proyecto en `projectRoot`.

Nunca lanza: si no hay manifiesto legible, cae al nombre de la
carpeta, que siempre existe.

### `projects/core/discovery/summary.service.ts`

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
en `projects/frameworks/`.

### `projects/core/domain/auth-flow.service.ts`

Flujo de autenticación de la colección.

#### `hasLoginEndpoint`

```ts
export function hasLoginEndpoint( specs: ReadonlyArray<
```

Si el proyecto expone un endpoint de sesión, mirando los specs.

`detectAuthFlow` responde a lo mismo pero sobre la **colección ya
construida**, y hay quien necesita saberlo antes de construirla: el
esquema de autenticación decide qué cabeceras lleva cada petición, así
que no se puede resolver después.

Comparte los patrones con `detectAuthFlow` a propósito. Dos listas de
rutas de login se desincronizan, y entonces la colección diría que hay
bearer mientras el flujo no cablea ningún token, o al revés.

#### `detectAuthFlow`

```ts
export function detectAuthFlow(collection: PostmanCollection): IAuthFlow | null
```

Localiza los endpoints de login, refresh y logout en la colección.
Devuelve `null` si el proyecto no tiene ninguno.

#### `applyAuthFlow`

```ts
export function applyAuthFlow( collection: PostmanCollection, options: IApplyAuthFlowOptions =
```

Cablea el flujo de autenticación sobre una colección ya construida:

  - Login y refresh guardan el token al responder 2xx.
  - El body del login referencia `{{authUsername}}` / `{{authPassword}}`.
  - Logout limpia el token.
  - Se documenta el flujo en la descripción del login.

Devuelve el flujo aplicado, o `null` si la colección no tiene auth.

#### `authEnvironmentVariables`

```ts
export function authEnvironmentVariables(): Array<
```

Variables que el environment necesita para el flujo de auth.
Se añaden solo si la colección tiene login.

#### `detectLaravelTokenPath`

```ts
export async function detectLaravelTokenPath(root: string): Promise<string | undefined>
```

Detecta heurísticamente el dot-path del token en el AuthController de
un proyecto Laravel.
Mira los archivos `app/Http/Controllers/*Auth*Controller.php` y busca
patrones de respuesta. Si no encuentra nada, devuelve undefined.

### `projects/core/domain/auth-scheme.service.ts`

Qué esquema de autenticación usa la API, deducido de sus endpoints.

#### `detectAuthScheme`

```ts
export function detectAuthScheme( specs: ReadonlyArray<EndpointSpec>, hasLoginFlow: boolean, ): IDetectedAuthScheme
```

Deduce el esquema de autenticación de la API.

`hasLoginFlow` lo pasa el pipeline: es si el proyecto expone un
endpoint de sesión que el flujo de auth ha reconocido y cableado.

#### `toPostmanAuth`

```ts
export function toPostmanAuth(scheme: IDetectedAuthScheme): IPostmanAuth | null
```

Traduce el esquema detectado al bloque `auth` de Postman.

Devuelve `null` para `none`: una colección **sin** bloque `auth` es
distinta de una con uno vacío. Con bloque, Postman manda una cabecera
`Authorization` con un valor sin resolver en cada petición, y la API
contesta 401 por un motivo que no tiene nada que ver con lo que se
estaba probando.

#### `authVariablesFor`

```ts
export function authVariablesFor( scheme: IDetectedAuthScheme, ): Array<
```

Las variables de entorno que hace falta rellenar para ese esquema.

Van vacías y marcadas como secreto: el valor lo pone quien usa la
colección, y no debe acabar en un fichero versionado.

### `projects/core/domain/collection-builder.service.ts`

Genera una colección Postman v2.1.0 a partir de un catálogo de `EndpointSpec` agrupando los endpoints en carpetas automáticamente.

#### `buildCollection`

```ts
export function buildCollection( specs: EndpointSpec[], config: ProjectConfig, /** * Esquema de autenticación de la API. * * Si no se pasa, se deduce de los propios endpoints. El parámetro * existe para que el pipeline —que es quien sabe si hay flujo de
```

Construye la colección Postman a partir del catálogo de endpoints
y la configuración del proyecto.

@param specs Catálogo de endpoints del proyecto.
@param config Configuración del proyecto (nombre, variables, zonas…).

### `projects/core/domain/endpoint-merge.service.ts`

Fusión de los endpoints descubiertos con los overrides manuales del host.

#### `mergeWithManual`

```ts
export function mergeWithManual( auto: EndpointSpec[], manual: EndpointSpec[], ): EndpointSpec[]
```

Fusiona specs auto-descubiertos con un catálogo manual opcional.
El manual gana en method+uri normalizado (name, body, folder, description).

Exportado porque los overrides manuales no son una cosa de Laravel:
cualquier proyecto puede declarar un `endpoints.constant.ts` para
corregir o ampliar lo que el scanner deduce.

### `projects/core/domain/environment-builder.service.ts`

Genera environments Postman v2.1.0 agnósticos.

#### `buildEnvironment`

```ts
export function buildEnvironment( name: string, variables: PostmanVariable[], overrides: Record<string, string> =
```

Construye UN environment.

@param name         Nombre del environment (ej. "Dev" o "Mi App · dev").
@param variables    Variables fusionadas (config + base + path).
@param overrides    Mapa que SOBREESCRIBE valores finales (ej. baseUrl).
@param color        Color de la etiqueta en Postman.
@param collectionId Id de la colección a la que pertenece; entra en la
                    semilla del id del environment para que dos
                    proyectos con un entorno "Local" no colisionen.

#### `buildEnvironments`

```ts
export function buildEnvironments( specs: EndpointSpec[], configVariables: PostmanVariable[], envs: EnvironmentDef[], collectionId = "", ): PostmanEnvironment[]
```

Construye múltiples environments aplicando cada `overrides` al set
base de variables.

#### `defaultEnvironments`

```ts
export function defaultEnvironments( baseUrl: string, ): EnvironmentDef[]
```

### `projects/core/domain/param-inferrer.service.ts`

Inferencia agnóstica de path params, query params y body para endpoints SIN FormRequest asociado.

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

Un valor de ejemplo plausible para un parámetro de query, por su nombre.

`page` da un número y `search` da texto. Es heurística pura: sirve para
que la request se pueda lanzar sin editarla, no para acertar.

#### `inferBodyForSpec`

```ts
export function inferBodyForSpec(spec: EndpointSpec): BodyInference | null
```

Intenta producir un body útil para un endpoint sin FormRequest usando
heurísticas REST-agnósticas:

  - action POST sin path params (p. ej. `/usuarios/despersonar`): `{}`.
  - action POST con path param (p. ej. `/productos/{{id}}/reindexa`):
    añade campo `force: true` si el segmento final sugiere "reindex",
    "cancel", "force", etc.
  - PUT/PATCH siempre lleva al menos un campo booleano/flag agnóstico.

Devuelve `null` si no encuentra una heurística segura.

#### `inferQueryForSpec`

```ts
export function inferQueryForSpec(spec: EndpointSpec): Array<
```

Genera query params por defecto para un endpoint GET sin FormRequest.

- Si la URI tiene path params que sugieran un único recurso (show),
  añade solo `with=all` para forzar relaciones.
- Si parece un listado/index (URI sin `{`, último segmento es plural
  común o no es un verbo), añade paginación + búsqueda.

Conservador: si no encaja con nada, devuelve `[]`.

#### `inferCollectionVariables`

```ts
export function inferCollectionVariables( specs: EndpointSpec[], configVariables: Array<
```

Construye un set de variables `{{...}}` a partir de un catálogo de
`EndpointSpec`. Se usa como fallback cuando el `ProjectConfig` no trae
ninguna lista de variables.

Reglas agnósticas:
  - `baseUrl`, `token` siempre se incluyen.
  - Cualquier `{{algo}}` que aparezca en URIs se incluye si NO estaba
    ya presente en `configVariables`.
  - El valor por defecto se infiere con `exampleForPathParam()`.

#### `applyAgnosticInference`

```ts
export function applyAgnosticInference( specs: EndpointSpec[], options:
```

Enriquece los specs que NO tienen FormRequest con body y query
inferidos de forma agnóstica. NO toca los specs que ya tienen FR
ni los que ya traen body/query manual.

#### `_internals`

```ts
export const _internals =
```

Piezas internas expuestas **solo** para sus tests.

El guion bajo es la señal: no forman parte del contrato del módulo.

### `projects/core/domain/postman-api.service.ts`

Cliente de la API pública de Postman.

#### `PostmanApiError`

```ts
export class PostmanApiError extends Error
```

#### `pushCollection`

```ts
export async function pushCollection( collection: PostmanCollection, options: IPostmanApiOptions, ): Promise<IPushResult>
```

Sube la colección: la actualiza si ya existe una con el mismo
`_postman_id`, y si no la crea.

#### `pushEnvironment`

```ts
export async function pushEnvironment( environment: IPostmanEnvironmentPayload, options: IPostmanApiOptions, ): Promise<IPushResult>
```

#### `verifyApiKey`

```ts
export async function verifyApiKey( options: IPostmanApiOptions, ): Promise<
```

### `projects/core/domain/request-doc.service.ts`

La descripción de una request: qué acepta el endpoint, en una tabla.

#### `buildRequestDescription`

```ts
export function buildRequestDescription( base: string | undefined, fields: ReadonlyArray<IEndpointField> | undefined, ): string
```

Construye la descripción en Markdown, que es lo que Postman renderiza
en el panel de documentación de la request.

`base` es lo que ya traía la request (el nombre del handler, o el
`summary` de un spec OpenAPI). Se conserva arriba: es lo que alguien
escribió a propósito, y pisarlo con una tabla generada sería cambiar
información por presentación.

### `projects/core/domain/test-script.service.ts`

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

### `projects/core/domain/watcher.service.ts`

Vigilar el proyecto y avisar cuando algo cambia.

#### `shouldIgnore`

```ts
export function shouldIgnore( relativePath: string, extraIgnored: ReadonlySet<string> = new Set(), ): boolean
```

Si una ruta relativa debe ignorarse.

Pura y exportada a propósito: es la pieza que evita el bucle
infinito, y una pieza así tiene que poder probarse sin montar un
sistema de ficheros.

#### `createDebouncer`

```ts
export function createDebouncer( ms: number, fn: (batch: readonly string[]) => void, ):
```

Agrupa llamadas seguidas en una sola, `ms` después de la última.

Devuelve también un `cancel` para poder cerrar sin dejar un timer
suelto: sin él, el proceso no termina al hacer Ctrl+C porque el event
loop sigue teniendo trabajo pendiente.

#### `watchProject`

```ts
export function watchProject(options: IWatchOptions): IWatchHandle
```

Vigila `root` y llama a `onChange` con las rutas que han cambiado.

Usa `fs.watch` recursivo, sin sondeo. Si el sistema operativo no lo
soporta —`recursive` no está en todos los BSD— lanza con un mensaje
que lo dice, en vez de quedarse mirando solo el primer nivel y no
enterarse de nada.

Nunca hay dos `onChange` a la vez: si llega un cambio mientras se está
regenerando, se encola y se ejecuta después. Dos generaciones
simultáneas escribirían el mismo fichero a la vez.

### `projects/core/exporters/bruno.exporter.ts`

Exportador a Bruno.

#### `BrunoExporter`

```ts
export class BrunoExporter implements IExportTarget
```

### `projects/core/exporters/export-registry.service.ts`

El catálogo de formatos de salida.

#### `registeredFormats`

```ts
export function registeredFormats(): string[]
```

Los formatos que este registro produce de verdad.

No es el catálogo —el catálogo es `EXPORT_FORMATS`, en contratos— sino
**lo que el registro cumple**. Un test compara los dos: una lista
paralela no es peligrosa, una lista paralela que nadie compara sí.

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

Interpreta `--format a,b,c`.

Falla **antes** de escanear si algún formato no existe, y lista los
válidos. Descubrir un nombre mal escrito al final —tras recorrer el
proyecto y sin haber escrito el fichero que se pedía— no dice nada de
lo que ha pasado. Es la misma decisión que en `--framework`.

#### `exportTo`

```ts
export function exportTo( formats: ReadonlyArray<string>, input: IExportInput, ): IExportArtifact[]
```

Serializa el proyecto a todos los formatos pedidos.

`postman` se salta: lo escribe el pipeline por su cuenta.

#### `exportWarnings`

```ts
export function exportWarnings( formats: ReadonlyArray<string>, input: IExportInput, ): string[]
```

Lo que los formatos pedidos **no pueden** representar.

Se devuelve aparte de los artefactos porque no impide generarlos: el
fichero sale igual, solo que incompleto, y quien lo pidió tiene que
saberlo.

### `projects/core/exporters/har.exporter.ts`

Exportadores a HAR 1.2 y a cURL.

#### `HarExporter`

```ts
export class HarExporter implements IExportTarget
```

#### `CurlExporter`

```ts
export class CurlExporter implements IExportTarget
```

### `projects/core/exporters/insomnia.exporter.ts`

Exportador a Insomnia v4.

#### `InsomniaExporter`

```ts
export class InsomniaExporter implements IExportTarget
```

### `projects/core/exporters/openapi.exporter.ts`

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

### `projects/core/helpers/argv.helper.ts`

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

### `projects/core/helpers/atomic-write.helper.ts`

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

### `projects/core/helpers/collection-file.helper.ts`

Leer la colección del disco, o explicar por qué no se puede.

#### `readCollection`

```ts
export async function readCollection(path: string): Promise<CollectionRead>
```

Lee y parsea la colección.

Distingue los tres fallos que importan, porque cada uno tiene una
salida distinta: que no exista (falta generar), que no se pueda leer
(permisos) y que no sea JSON válido (se escribió a medias, que es lo
que `atomic-write.helper` existe para evitar).

#### `explainReadFailure`

```ts
export function explainReadFailure( failure: Extract<CollectionRead,
```

Imprime el fallo en el formato del resto del CLI y devuelve 1, para
que un comando pueda hacer `return explain(result)` sin repetir el
bloque de `console.error` en cada uno.

### `projects/core/helpers/collection-identity.helper.ts`

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

### `projects/core/helpers/collection-invariants.helper.ts`

Invariantes que debe cumplir una colección para que Postman la importe y sea usable.

#### `checkCollectionInvariants`

```ts
export function checkCollectionInvariants( collection: PostmanCollection, ): ICollectionIssue[]
```

Comprueba todas las invariantes y devuelve los incumplimientos.
Lista vacía = la colección es correcta.

#### `collectionErrors`

```ts
export function collectionErrors(collection: PostmanCollection): ICollectionIssue[]
```

### `projects/core/helpers/fs-walk.helper.ts`

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

### `projects/core/helpers/module-path.helper.ts`

Directorio del módulo actual, de forma portable.

#### `moduleDir`

```ts
export function moduleDir(importMetaUrl: string): string
```

#### `repoRoot`

```ts
export function repoRoot(importMetaUrl: string): string
```

Raíz del repo/paquete: sube desde el módulo hasta dar con el
`package.json`.

Antes cada script contaba sus propios `".."` hasta la raíz. Eso
funciona hasta que el fichero cambia de carpeta, y entonces
`PACKAGE_ROOT` apunta a otro sitio **sin fallar**: el script
simplemente no encuentra nada y dice "no se encontró ninguna
propuesta". Pasó con cuatro gates a la vez al reorganizar en
`projects/`.

Contar niveles es acoplar un fichero a su profundidad en el árbol.
Buscar el marcador no.

#### `findRepoRoot`

```ts
export function findRepoRoot(importMetaUrl: string): string | null
```

Como `repoRoot()`, pero devuelve `null` en vez de lanzar.

Lo necesita el código de **producción**: dentro del binario compilado
los módulos viven en un sistema de ficheros virtual (`/$bunfs/root/`)
donde no hay ningún `package.json`, así que no hay raíz que
encontrar. Lanzar allí tumba el binario entero al arrancar — pasó al
introducir este helper, y el test del binario sin runtime fue lo que
lo cazó.

Regla: los gates y los tests usan `repoRoot()`, que lanza porque un
fallo ahí es un fallo del repo. El código que acaba dentro del
binario usa esta y tiene un plan B.

### `projects/core/helpers/parse-json.helper.ts`

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

### `projects/core/helpers/path-containment.helper.ts`

¿Esta ruta se sale de donde debería escribir?

#### `ensureInside`

```ts
export async function ensureInside( root: string, target: string, ): Promise<ContainmentResult>
```

¿`target` está dentro de `root`?

La propia raíz cuenta como dentro. Devuelve la ruta ya resuelta para
que quien llame use esa y no la original: comprobar una y escribir en
otra es como se saltan estas comprobaciones.

#### `ensureInsideAny`

```ts
export async function ensureInsideAny( roots: ReadonlyArray<string>, target: string, ): Promise<ContainmentResult>
```

¿`target` está dentro de **alguna** de las raíces?

Varias, y no una, porque una sola no describe el uso legítimo. Un
agente puede pedir "genera para el proyecto X y deja la salida en mi
carpeta de trabajo", y esas son dos ubicaciones distintas y las dos
razonables. Con una sola raíz eso se rechazaba, y un guardián que
bloquea el uso normal se acaba quitando.

Lo que sí queda fuera es el resto del disco: la salida va con el
proyecto, dentro del workspace, o en un temporal — no al `$HOME` de
nadie porque un `../` se coló en un argumento.

### `projects/core/helpers/postman.helper.ts`

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

### `projects/core/helpers/read-files.helper.ts`

Leer muchos ficheros sin leerlos de uno en uno.

#### `readAllFiles`

```ts
export async function readAllFiles( paths: ReadonlyArray<string>, limit: number = READ_CONCURRENCY, ): Promise<IReadFile[]>
```

Lo mismo, pero en un array.

Para quien necesite la lista entera de todas formas (un `Map` de
módulo → contenido, por ejemplo). Si solo se va a recorrer una vez,
usa el generador: gasta memoria acotada en vez de toda.

### `projects/core/helpers/regex.helper.ts`

Regex compartidos usados sin pisarse.

#### `ownRegex`

```ts
export function ownRegex(shared: RegExp): RegExp
```

Una copia propia de un regex compartido.

Nace con `lastIndex` a cero y nadie más la toca, así que se puede usar
con `exec` sin coordinarse con el resto del proceso.

### `projects/core/helpers/resolve-root.helper.ts`

De dónde sale la raíz del proyecto, una sola vez.

#### `resolveRoot`

```ts
export function resolveRoot(options: IResolveRootOptions =
```

La raíz del proyecto: `--project-root`, luego `POSTMAN_PROJECT_ROOT`,
y como último recurso el directorio actual.

El orden es el que ya tenían dos de los tres comandos, así que no
cambia el comportamiento de nadie — solo lo hace igual en todos y
añade de dónde vino.

#### `guessedRootNotice`

```ts
export function guessedRootNotice(resolved: IResolvedRoot): string
```

El aviso de que la raíz se ha adivinado, o cadena vacía.

Se devuelve en vez de imprimirse para que quien llama decida dónde va
—`console.log`, un informe JSON, la interfaz gráfica— y para que se
pueda probar sin capturar la salida.

### `projects/core/helpers/route-identity.helper.ts`

Qué hace que dos endpoints sean el mismo endpoint.

#### `endpointKey`

```ts
export function endpointKey(identity: IEndpointIdentity): string
```

La clave de una operación. Misma operación, misma clave.

La URI se normaliza siempre, para que `/api/users` y `api/users` no
se cuenten como dos. El nombre y el cuerpo solo entran cuando están:
añadirlos vacíos haría que una ruta con nombre y la misma sin él
dejaran de coincidir, que es lo contrario de lo que se busca.

#### `describeEndpoint`

```ts
export function describeEndpoint(identity: IEndpointIdentity): string
```

Cómo se llama una operación cuando hay que enseñársela a alguien.

`POST /graphql` repetido tres veces no dice nada: hace falta el
nombre para saber cuál falta. Esto es lo que convierte una lista de
tres líneas idénticas en una lista útil.

#### `needsNameToDisambiguate`

```ts
export function needsNameToDisambiguate( routes: ReadonlyArray<IEndpointIdentity>, ): boolean
```

¿Este protocolo distingue operaciones por el nombre?

No es una lista de frameworks: es una propiedad de las rutas que
llegan. Si varias comparten método y URI, el nombre es lo único que
queda — y da igual que sea GraphQL, tRPC o un JSON-RPC escrito a
mano. Preguntarlo así evita una lista que haya que mantener cada vez
que se soporte un framework nuevo.

### `projects/core/helpers/source-scan.helper.ts`

Primitivas de escaneo de código fuente compartidas por los scanners.

#### `stripJsComments`

```ts
export function stripJsComments(src: string): string
```

Elimina comentarios de bloque y de línea de un fuente JS/TS.

El `//` se descarta solo si no viene precedido de `:`, para no partir
las URLs (`https://…`) que aparecen en literales de string.

#### `findClosingParen`

```ts
export function findClosingParen(text: string, openIndex: number): number
```

Encuentra el `)` que cierra el `(` situado en `openIndex`, respetando
anidamiento. Devuelve `-1` si el paréntesis nunca se cierra.

#### `findAllBalanced`

```ts
export function findAllBalanced(text: string, pattern: RegExp): IBalancedCall[]
```

Todas las ocurrencias de `pattern` en `text`, cada una con la posición
balanceada de su llamada.

`pattern` debe describir el prefijo de una llamada (ej. `/z\.object\s*\(/`);
el `(` se busca a partir del inicio del match. La regex se re-crea
siempre con flag `g`, así que da igual cómo la declare quien llama.

#### `findNearestBalanced`

```ts
export function findNearestBalanced( text: string, pattern: RegExp, nearLine: number, ): IBalancedCall | null
```

De todas las llamadas que casan `pattern`, la más cercana (en número de
líneas) a `nearLine`. Sirve para asociar un schema al handler que lo
usa cuando un mismo archivo declara varios.

#### `countLinesBefore`

```ts
export function countLinesBefore(text: string, index: number): number
```

#### `splitTopLevel`

```ts
export function splitTopLevel(body: string): string[]
```

Parte el interior de un object literal por comas de primer nivel.

Ignora las comas dentro de strings (`'`, `"`, backtick, con escapes) y
dentro de `()`, `{}` o `[]` anidados. La profundidad arranca en 1
porque el texto recibido incluye las llaves exteriores del objeto.

#### `unwrapObjectLiteralItem`

```ts
export function unwrapObjectLiteralItem(item: string): string
```

Quita las llaves exteriores y el espacio sobrante de un item devuelto
por `splitTopLevel` (el primero arrastra el `{`, el último el `}`).

#### `maskStringLiterals`

```ts
export function maskStringLiterals(src: string): string
```

Sustituye el **contenido** de las cadenas por espacios, conservando
las comillas y la longitud total.

Sirve para responder a una pregunta que los scanners hacen todo el
rato sin saberlo: *¿esta llamada está de verdad en el código, o está
dentro de una cadena?* Un fichero con

    const ayuda = 'usa router.get("/x") para registrar';

producía un endpoint `GET /x` que no existe. El texto de una cadena no
es código, pero para un regex se lee igual.

La longitud se conserva a propósito: así los desplazamientos de la
máscara valen sobre el fuente original, y se puede buscar en la
máscara y leer en el original. Sin eso habría que mantener un mapa de
posiciones, que es la clase de cosa que se desincroniza.

Cubre comillas simples, dobles y plantillas. Dentro de una plantilla,
lo que va en `${…}` **sí** es código y se conserva: es donde viven las
interpolaciones que otros lints tienen que ver.

#### `findOutsideStrings`

```ts
export function findOutsideStrings( src: string, pattern: RegExp, ): Array<
```

Las apariciones de `pattern` que están **fuera** de cualquier cadena.

El truco tiene dos mitades y las dos hacen falta:

  1. Se **busca** sobre la máscara, donde el contenido de las cadenas
     son espacios. Así una llamada escrita dentro de un texto —
     `'usa router.get("/x")'`— no aparece.
  2. Se **lee** del fuente original, en la misma posición. La máscara
     conserva la longitud justo para esto: el path de una ruta de
     verdad ES una cadena, así que en la máscara viene en blanco y
     leerlo de ahí daría rutas vacías.

Saltarse la segunda mitad es fácil y el fallo es silencioso: los
grupos capturados salen llenos de espacios y las rutas se descartan
una a una sin que nada avise.

### `projects/core/helpers/uri.helper.ts`

Helpers para normalizar URIs antes de comparar.

#### `normalizeForComparison`

```ts
export function normalizeForComparison(uri: string): string
```

Helpers para normalizar URIs antes de comparar.

Las URIs tienen cinco formas que deben coincidir:
  - Laravel: `{cliente}` o `{cliente:codigo}`
  - Express: `:clientId`
  - FastAPI: `{client_id}` (mismo formato que Laravel)
  - Django:  `<id>`, `<int:id>`, `<str:slug>`, `<uuid:token>`
  - Postman: `{{clienteId}}`

`normalizeForComparison` reduce cualquier token parametrizado a `:p`
(mismo marcador, sin importar el nombre). Esto es suficiente para la
gran mayoría de casos. La excepción son endpoints que se diferencian
solo por el nombre del parámetro y por una regex `where()` en Laravel
(p. ej. `/busqueda/{historico}` vs `/busqueda/{matricula}`); estos
se documentan en el catálogo con nombres distintos y el script de
generación los reporta como requests separadas aunque normalicen
igual.

#### `stripApiPrefix`

```ts
export function stripApiPrefix(uri: string): string
```

#### `joinRoutePath`

```ts
export function joinRoutePath(...segments: string[]): string
```

Une los segmentos de una ruta (prefijo de clase/grupo + path del
método) en una URI normalizada.

La barra final se conserva **solo si el último segmento no vacío la
declaraba**. Esa distinción importa:

  - Django: `path("<int:id>/", …)` la trae a propósito. Con
    `APPEND_SLASH = True` (el defecto), llamar sin ella devuelve un
    301 y un POST pierde el body en la redirección.
  - NestJS, Spring Boot, ASP.NET y Flask: `@Controller("orders")` +
    `@Get()` concatenaba `"orders" + "/" + ""` y producía `orders/`.
    Ahí la barra es un artefacto, no una decisión.

#### `topGroupFor`

```ts
export function topGroupFor( uri: string, uriGroupOverrides: Record<string, string> =
```

Devuelve el grupo top-level lógico de una URI (primer segmento
significativo). Por ejemplo:

  "api/clientes"             → "clientes"
  "api/clientes/{cliente}"   → "clientes"
  "api/erp/productos"        → "erp"
  "api/pedidos/historial"    → "pedidos"
  "alive" / "login"          → "login" / "alive"

Si la URI empieza por `api/`, lo salta. Los casos especiales se
configuran vía `uriGroupOverrides` (p. ej. `{ "tol/tecdoc": "tol/tecdoc" }`).

@param uri URI a analizar.
@param uriGroupOverrides Mapa prefijo → clave de grupo (del `ProjectConfig`).

#### `prettyGroupName`

```ts
export function prettyGroupName(topGroup: string): string
```

El nombre legible de una carpeta a partir de su clave.

`erp-productos` pasa a `Erp Productos`. Solo afecta a lo que se lee en
Postman: la clave sigue siendo la que agrupa.

### `projects/core/helpers/yaml.helper.ts`

Serializador a YAML para datos planos.

#### `toYaml`

```ts
export function toYaml(value: YamlValue): string
```

### `projects/core/helpers/zone.helper.ts`

Helpers de zonas lógicas.

#### `zoneForUri`

```ts
export function zoneForUri(uri: string, config: ProjectConfig): string
```

Calcula la zona lógica a partir de la URI del endpoint y la
configuración del proyecto.

#### `zonesToDisplay`

```ts
export function zonesToDisplay( present: Iterable<string>, config: Pick<ProjectConfig, "zoneOrder" | "defaultZone">, ): string[]
```

El orden en que se enseñan las zonas que **tienen contenido**.

`zoneOrder` es la preferencia de quien configura el proyecto, no la
lista de zonas que existen. Y en zero-config —que es el caso normal,
el de los 21 ejemplos— viene **vacía**, con todos los endpoints
cayendo en `defaultZone`.

`list` y `stats` recorrían `zoneOrder` directamente para imprimir, así
que en zero-config no imprimían **nada**: `list` decía "9 endpoints en
la colección, agrupados por zona:" y a continuación dejaba la pantalla
en blanco. No era un fallo de GraphQL ni de un framework concreto —
pasaba en los veintiuno, y el comando entero no servía para nada.

Aquí se devuelven las zonas presentes de verdad: primero las que
`zoneOrder` nombra, en su orden, y después el resto ordenadas
alfabéticamente para que dos ejecuciones den lo mismo. Se omiten las
vacías, que es lo que hacía bien el código anterior.

### `projects/frameworks/index.ts`

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

