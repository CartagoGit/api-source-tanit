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

> 210 símbolos en 47 módulos.

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

#### `AdapterResult`

```ts
export interface AdapterResult
```

Lo que sale de adaptar las rutas de un scanner al catálogo del núcleo.

Los contadores de con y sin reglas van aquí porque son la medida de
cuánto se ha podido deducir del código frente a cuánto se ha inferido.

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

### `projects/core/contracts/export-target.interface.ts`

El contrato de un formato de salida.

#### `IExportArtifact`

```ts
export interface IExportArtifact
```

#### `IExportInput`

```ts
export interface IExportInput
```

#### `IExportAuth`

```ts
export interface IExportAuth
```

#### `IExportTarget`

```ts
export interface IExportTarget
```

Un formato de salida.

Implementarlo y registrarlo en `export-registry.service.ts` es todo lo
que hace falta para añadir un formato: el motor de escaneo no se toca,
porque lo que se serializa es la representación intermedia que ya
produce.

### `projects/core/contracts/generate-report.interface.ts`

Informe legible por máquina de una generación (`generate --json`).

#### `GENERATE_REPORT_VERSION`

```ts
export const GENERATE_REPORT_VERSION = 3
```

Versión del contrato. Sube al cambiar la forma de manera incompatible.

v2: añade `frameworks` y `warnings` (proyectos híbridos).

#### `IGenerateReportAuth`

```ts
export interface IGenerateReportAuth
```

#### `IGenerateReport`

```ts
export interface IGenerateReport
```

### `projects/core/contracts/legacy-discovery.interface.ts`

Estrategia de descubrimiento de último recurso.

#### `ILegacyDiscoveryResult`

```ts
export interface ILegacyDiscoveryResult
```

#### `ILegacyDiscovery`

```ts
export interface ILegacyDiscovery
```

### `projects/core/contracts/postman.constant.ts`

Constantes universales del paquete (agnósticas del proyecto).

#### `POSTMAN_SCHEMA_URL`

```ts
export const POSTMAN_SCHEMA_URL = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
```

La URL del esquema que declara la versión del formato.

Postman la usa para decidir cómo leer el fichero al importarlo; una
colección sin ella o con otra versión se interpreta distinto.

#### `VARIANT_TAG`

```ts
export const VARIANT_TAG = " (auto · FormRequest)"
```

#### `OUTPUT_DIR_NAME`

```ts
export const OUTPUT_DIR_NAME = "export-to-postman"
```

Carpeta donde se escriben los artefactos, dentro del proyecto que se
escanea.

Antes era `build/`, y eso hacía daño: `build/` es la salida por
defecto de Gradle, de Maven con ciertas configuraciones, de muchos
proyectos de Go y de la mitad de los Makefile del mundo. Escribir ahí
mezcla las colecciones con los artefactos de compilación de quien usa
la herramienta, en una carpeta que su `clean` borra entera.

`export-to-postman/` es el nombre del proyecto: nadie tiene una
carpeta así, y si la tiene, es la nuestra.

Se sobrescribe con `--output-dir` o `POSTMAN_OUTPUT_DIR`.

#### `SUPPORTED_METHODS`

```ts
export const SUPPORTED_METHODS = [ "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
```

Métodos HTTP que se emiten a la colección.

Es la MISMA lista que el tipo `EndpointSpec["method"]`, y existe para
poder recorrerla en tiempo de ejecución. El adapter la usa para
filtrar: tenerla escrita a mano allí hacía que añadir un método al
tipo no sirviera de nada, y los `HEAD` que los scanners sí detectaban
desaparecían en silencio.

#### `BIN_NAME`

```ts
export const BIN_NAME = "expostman" as const
```

Nombre del ejecutable que se distribuye.

Es el mismo que el `bin` del `package.json` y el que se escribe en la
terminal. Estaba escrito a mano en el script de compilación, y se
quedó en `postman-from-routes` —el nombre viejo— cuando el producto
pasó a llamarse así: los binarios de las releases salían con un nombre
que no existe en ninguna otra parte del proyecto.

### `projects/core/contracts/postman.interface.ts`

Tipos del schema Postman v2.1.0. Documentación oficial: https://schema.getpostman.com/json/collection/v2.1.0/collection.json

#### `PostmanUrl`

```ts
export interface PostmanUrl
```

Tipos del schema Postman v2.1.0.
Documentación oficial: https://schema.getpostman.com/json/collection/v2.1.0/collection.json

#### `PostmanHeader`

```ts
export interface PostmanHeader
```

#### `PostmanBody`

```ts
export interface PostmanBody
```

El cuerpo de una petición.

Este proyecto solo emite `raw` con JSON: es lo que se puede derivar de
unas reglas de validación. Los otros modos existen en el formato y se
declaran para poder leer una colección ajena sin perderlos.

#### `PostmanRequest`

```ts
export interface PostmanRequest
```

La petición de un item: qué se manda y a dónde.

`method` es `string` y no la unión de verbos porque aquí también se
leen colecciones que no ha escrito esta herramienta.

#### `PostmanEvent`

```ts
export interface PostmanEvent
```

Un script que Postman ejecuta alrededor de la petición.

`prerequest` corre antes de mandarla; `test`, después de recibir la
respuesta. `exec` es el script partido en líneas, que es como lo
guarda el formato.

#### `PostmanItem`

```ts
export interface PostmanItem
```

Un nodo del árbol de la colección.

Es carpeta **o** petición según qué campo traiga: con `item` es
carpeta y con `request` es petición. El formato no los separa en dos
tipos, así que aquí tampoco.

#### `PostmanVariable`

```ts
export interface PostmanVariable
```

Una variable de colección o de entorno.

`type: "secret"` hace que Postman la oculte en la interfaz: es lo que
llevan el token y las credenciales.

#### `PostmanCollection`

```ts
export interface PostmanCollection
```

Una colección Postman v2.1.0 completa.

El `_postman_id` de `info` es lo que decide si reimportar **actualiza**
la colección o crea otra al lado, así que se deriva del proyecto y no
se sortea (p00014).

#### `EndpointSpec`

```ts
export interface EndpointSpec
```

#### `IEndpointField`

```ts
export interface IEndpointField
```

#### `DiscoveredRoute`

```ts
export interface DiscoveredRoute
```

#### `PostmanEnvironment`

```ts
export interface PostmanEnvironment
```

Environment Postman v2.1.0.
https://learning.postman.com/docs/sending-requests/managing-environments/

### `projects/core/contracts/project-config.interface.ts`

Interfaz de configuración del proyecto.

#### `ProjectConfig`

```ts
export interface ProjectConfig
```

Configuración completa que un proyecto debe proporcionar.

### `projects/core/contracts/project-context.interface.ts`

Contexto del proyecto que se está escaneando.

#### `IProjectContext`

```ts
export interface IProjectContext
```

#### `IProjectDirs`

```ts
export interface IProjectDirs
```

### `projects/core/contracts/scanner.interface.ts`

Contratos framework-agnostic para discovery y validación.

#### `FrameworkId`

```ts
export type FrameworkId = "laravel" | "openapi" | "express" | "fastapi" | "symfony" | string
```

#### `IProjectMatch`

```ts
export interface IProjectMatch
```

#### `IProjectScanner`

```ts
export interface IProjectScanner
```

#### `ParsedRoute`

```ts
export interface ParsedRoute
```

#### `IRouteScanner`

```ts
export interface IRouteScanner
```

#### `IValidationSpec`

```ts
export interface IValidationSpec
```

#### `IEndpointValidation`

```ts
export interface IEndpointValidation
```

#### `IValidationSpecProvider`

```ts
export interface IValidationSpecProvider
```

#### `IDiscoveryOrchestrator`

```ts
export interface IDiscoveryOrchestrator
```

### `projects/core/discovery/discovery.orchestrator.ts`

`DiscoveryOrchestrator` — punto de entrada único del discovery framework-agnostic.

#### `DiscoveryRegistry`

```ts
export interface DiscoveryRegistry
```

El catálogo de scanners con el que trabaja un orquestador.

Se inyecta en vez de importarse para que el núcleo no conozca ni un
framework: es lo que hace que `lint:boundaries` pueda prohibir que
`core/` importe de `frameworks/`.

#### `IDetectedFramework`

```ts
export interface IDetectedFramework
```

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

#### `IGenerationMetrics`

```ts
export interface IGenerationMetrics
```

#### `IGenerationResult`

```ts
export interface IGenerationResult
```

#### `IGenerationOptions`

```ts
export interface IGenerationOptions
```

#### `generateCollection`

```ts
export async function generateCollection( projectRoot: string, options: IGenerationOptions, ): Promise<IGenerationResult>
```

Descubre los endpoints de un proyecto y construye su colección.

`projectRoot` manda: la llamada se envuelve en `withProjectRoot()`, así
que dos proyectos generados en el mismo proceso no se pisan aunque los
servicios de dentro sigan resolviendo rutas por el singleton de
`paths.service` (p00017 S3).

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

#### `IPathScope`

```ts
export interface IPathScope
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

#### `CONTAINMENT_ROOT_VAR`

```ts
export const CONTAINMENT_ROOT_VAR = "POSTMAN_CONTAIN_ROOT" as const
```

Raíces dentro de las cuales tiene que quedarse la salida, si las hay.

Vacía cuando lo lanza una persona: `--output-dir /donde/quiera` es un
uso legítimo y no hay motivo para estorbarlo. La pone **el plugin
MCP** al spawnear el CLI, porque ahí quien elige la ruta es un agente
y una ruta con `../` escribiría fuera del proyecto.

Son varias, separadas por el separador de rutas del sistema, porque
una sola no describe el uso legítimo: la salida puede ir con el
proyecto que se escanea, dentro del workspace, o en un temporal, y las
tres son razonables. Un guardián que bloquea el uso normal se acaba
quitando.

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
export function describeDiscoveredPaths(): string
```

Las rutas resueltas, en texto, para la traza del CLI.

Se imprime antes de escanear a propósito: cuando la salida no es la
esperada, lo primero que hay que descartar es que se esté mirando otra
carpeta.

### `projects/core/discovery/project-context.service.ts`

Resolución explícita del contexto de un proyecto.

#### `IResolveContextOptions`

```ts
export interface IResolveContextOptions
```

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

#### `LoadedProject`

```ts
export interface LoadedProject
```

La configuración del proyecto, ya resuelta, y de dónde ha salido.

`configPath` importa tanto como el config: es la diferencia entre "no
encontré tu fichero" y "lo encontré y dice esto", que es lo primero
que hay que saber cuando la salida no es la esperada.

#### `detectProjectName`

```ts
export async function detectProjectName(): Promise<string>
```

Devuelve el nombre del proyecto host.

La lectura de manifiestos vive en `project-name.service`: aquí solo
se resuelve la raíz. Antes esta función miraba únicamente
`composer.json`, con lo que Laravel se llamaba como su paquete y los
otros once frameworks como su carpeta.

#### `detectFilePrefixes`

```ts
export async function detectFilePrefixes(): Promise<Record<string, string[]>>
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
export async function buildZeroConfig(): Promise<ProjectConfig>
```

Genera un ProjectConfig mínimo viable sin archivo del host.
Útil para que el paquete funcione "out-of-the-box" en cualquier proyecto.

#### `resolveConfigPath`

```ts
export async function resolveConfigPath( argv: string[] = process.argv, ): Promise<string>
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
export async function loadProject( argv: string[] = process.argv, ): Promise<LoadedProject>
```

Carga config + overrides manuales del proyecto host.

Si no encuentra ningún archivo de config, genera un zero-config en
memoria con autodetección de prefijo + baseUrl + nombre.

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

#### `IProjectSummary`

```ts
export interface IProjectSummary
```

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

#### `IAuthFlow`

```ts
export interface IAuthFlow
```

#### `AUTH_USERNAME_VARIABLE`

```ts
export const AUTH_USERNAME_VARIABLE = "authUsername"
```

#### `AUTH_PASSWORD_VARIABLE`

```ts
export const AUTH_PASSWORD_VARIABLE = "authPassword"
```

#### `AUTH_TOKEN_VARIABLE`

```ts
export const AUTH_TOKEN_VARIABLE = "token"
```

Donde el script del login guarda el token.

El nombre está aquí y no escrito en cada sitio porque lo comparten el
script que lo guarda, el bloque `auth` de la colección y la cabecera de
cada petición: si bailara entre ellos, la colección dejaría de
autenticar sin que nada fallara.

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

#### `IApplyAuthFlowOptions`

```ts
export interface IApplyAuthFlowOptions
```

Lo que el host puede declarar para ayudar a cablear la sesión.

Las dos son **último recurso**, no configuración esperada: el flujo
detecta el login por método y URI, y el token probando los caminos
habituales de la respuesta en ejecución. Antes se exigía declarar el
camino del token, y el resultado fue que no se activaba en ninguno de
los once proyectos de ejemplo.

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

#### `AuthSchemeType`

```ts
export type AuthSchemeType = "bearer" | "apikey" | "oauth2" | "none"
```

#### `AUTH_API_KEY_VARIABLE`

```ts
export const AUTH_API_KEY_VARIABLE = "apiKey"
```

#### `AUTH_CLIENT_ID_VARIABLE`

```ts
export const AUTH_CLIENT_ID_VARIABLE = "clientId"
```

#### `AUTH_CLIENT_SECRET_VARIABLE`

```ts
export const AUTH_CLIENT_SECRET_VARIABLE = "clientSecret"
```

#### `IDetectedAuthScheme`

```ts
export interface IDetectedAuthScheme
```

El esquema de autenticación deducido, con la señal que lo delató.

La `evidence` no es adorno: una detección automática que no se puede
contrastar hay que creérsela a ciegas.

#### `detectAuthScheme`

```ts
export function detectAuthScheme( specs: ReadonlyArray<EndpointSpec>, hasLoginFlow: boolean, ): IDetectedAuthScheme
```

Deduce el esquema de autenticación de la API.

`hasLoginFlow` lo pasa el pipeline: es si el proyecto expone un
endpoint de sesión que el flujo de auth ha reconocido y cableado.

#### `IPostmanAuth`

```ts
export interface IPostmanAuth
```

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

#### `EnvironmentDef`

```ts
export interface EnvironmentDef
```

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

#### `BodyInference`

```ts
export interface BodyInference
```

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

#### `InferApplyStats`

```ts
export interface InferApplyStats
```

Cuánto ha rellenado la inferencia agnóstica.

Lo imprime el CLI: es la forma de ver de un vistazo cuánto viene del
código y cuánto de una heurística.

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

#### `IPostmanEnvironmentPayload`

```ts
export interface IPostmanEnvironmentPayload
```

#### `IPushResult`

```ts
export interface IPushResult
```

#### `PostmanApiError`

```ts
export class PostmanApiError extends Error
```

#### `IPostmanApiOptions`

```ts
export interface IPostmanApiOptions
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

#### `DEFAULT_DEBOUNCE_MS`

```ts
export const DEFAULT_DEBOUNCE_MS = 300
```

#### `IGNORED_DIRS`

```ts
export const IGNORED_DIRS: ReadonlySet<string> = new Set([ OUTPUT_DIR_NAME, "node_modules", "vendor", ".git", ".svn", ".hg", "dist",
```

Carpetas que nunca aportan rutas y sí mucho ruido.

`node_modules` es el caso extremo: un `bun install` a medias dispara
miles de eventos y ninguno es un endpoint.

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

#### `IWatchOptions`

```ts
export interface IWatchOptions
```

#### `IWatchHandle`

```ts
export interface IWatchHandle
```

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

#### `DEFAULT_FORMAT`

```ts
export const DEFAULT_FORMAT = "postman"
```

El formato por defecto, y el que no se puede quitar.

`postman` no está en este registro: lo produce el pipeline con
`buildCollection`, que hace bastante más que serializar (flujo de
auth, aserciones, identidad de la colección). Se nombra aquí para que
`--format postman,openapi` funcione y para que el CLI sepa que no es
un formato desconocido.

#### `supportedFormats`

```ts
export function supportedFormats(): string[]
```

#### `describeFormats`

```ts
export function describeFormats(): Array<
```

#### `exporterFor`

```ts
export function exporterFor(format: string): IExportTarget | null
```

#### `IParsedFormats`

```ts
export type IParsedFormats = |
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

#### `CollectionRead`

```ts
export type CollectionRead = |
```

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

#### `ICollectionIdentity`

```ts
export interface ICollectionIdentity
```

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

#### `ICollectionIssue`

```ts
export interface ICollectionIssue
```

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

#### `ICollectFilesOptions`

```ts
export interface ICollectFilesOptions
```

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

### `projects/core/helpers/path-containment.helper.ts`

¿Esta ruta se sale de donde debería escribir?

#### `ContainmentResult`

```ts
export type ContainmentResult = |
```

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

#### `CollectionRequest`

```ts
export interface CollectionRequest
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

#### `READ_CONCURRENCY`

```ts
export const READ_CONCURRENCY = 16
```

Cuántas lecturas se permiten a la vez.

16 es suficiente para saturar un SSD y queda muy lejos del límite de
descriptores de fichero del proceso (1024 por defecto en Linux), que
es el motivo por el que esto lleva tope y no es un `Promise.all`.

#### `IReadFile`

```ts
export interface IReadFile
```

#### `readAllFiles`

```ts
export async function readAllFiles( paths: ReadonlyArray<string>, limit: number = READ_CONCURRENCY, ): Promise<IReadFile[]>
```

Lo mismo, pero en un array.

Para quien necesite la lista entera de todas formas (un `Map` de
módulo → contenido, por ejemplo). Si solo se va a recorrer una vez,
usa el generador: gasta memoria acotada en vez de toda.

### `projects/core/helpers/route-identity.helper.ts`

Qué hace que dos endpoints sean el mismo endpoint.

#### `IEndpointIdentity`

```ts
export interface IEndpointIdentity
```

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

#### `IBalancedCall`

```ts
export interface IBalancedCall
```

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

#### `YamlValue`

```ts
export type YamlValue = | string | number | boolean | null | undefined | YamlValue[] |
```

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

#### `IGenerateOptions`

```ts
export type IGenerateOptions = Omit<IGenerationOptions, "orchestrator">
```

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

