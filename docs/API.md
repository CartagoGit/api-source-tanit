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

> 201 símbolos en 70 módulos.

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

Per-service auth and baseUrl wiring — a00013 S4.

#### `pickAuth`

```ts
export function pickAuth( service: IServiceDescriptor, fallback: IEndpointAuth | undefined, ): IEndpointAuth | undefined
```

Resolves service auth: the descriptor's override when present (as placed by
the graph), or the inherited project fallback.

The return value preserves the discriminant: if `service.auth` is
`{ kind: "scheme", scheme: "bearer" }`, return it exactly; do not convert it
to `{ kind: "none" }` or `{ kind: "scheme", scheme: "apiKey" }`. The
function does not know—and does not need to know—how to handle each variant.
Its contract is "the first argument wins when defined; otherwise, the
second".

Both arguments are `IEndpointAuth | undefined`. When both are `undefined`,
return `undefined`. This means there is no auth signal for the service and
lets the pipeline decide whether the per-spec detector should run or the
caller already supplied another mechanism.

@param service The service descriptor. `service.auth` may be `undefined`
  (inherits from the project); `null` is invalid (`baseUrl` is `string | null`,
  but `auth` is strictly `IEndpointAuth | undefined`).
@param fallback The auth inherited from the project, typically the result of
  `toIEndpointAuth(detectedFromSpecs)`. It may be `undefined` when the project
  has no auth signal either.

#### `toIEndpointAuth`

```ts
export function toIEndpointAuth(detected: IDetectedAuthScheme): IEndpointAuth
```

Exhaustive `IDetectedAuthScheme` → `IEndpointAuth` conversion, semantically
inverse to `authSchemeFromEndpointAuth` in `generation.pipeline.ts`.

Exported separately so S4 tests can cover all four discriminant cases
(`none`, `bearer`, `apiKey`, `oauth2`) without threading a fake
IDetectedAuthScheme through the pipeline.

The switch is exhaustive by type: if a variant is added to `AuthSchemeType`
without being mapped here, TypeScript marks the switch as non-exhaustive
(TS7030 with `noImplicitReturns`). `authSchemeFromEndpointAuth` uses the
same pattern in the opposite direction.

#### `buildServiceConfig`

```ts
export function buildServiceConfig( config: ProjectConfig, service: IServiceDescriptor, ): ProjectConfig
```

Applies per-service overrides to `ProjectConfig` **without mutating the
original**. Returns a shallow copy with:
  - `baseUrl`: the service's value when declared and non-null; otherwise,
    the project's value. This is what `inferCollectionVariables` and
    `buildCollection` consume in `buildForService`.
  - `variables`: an array copy whose `baseUrl` entry is replaced with the
    effective value so the collection variable (`{{baseUrl}}`) reflects the
    per-service override.

Pure: does not touch `config`. Each iteration of the multi-service loop in
`buildFor` is independent—the next iteration receives the original
`discovery.config` with no baseUrl contaminated by the previous service
(S4 acceptance #3: `buildForService` does not mutate `config.baseUrl`
between iterations).

@see `IProjectContext` for the root context. If more per-service overrides are
added in the future (global auth, extra headers, URI prefixes, etc.), this
helper is the natural place to extend them.

### `packages/core/discovery/discovery.orchestrator.ts`

`DiscoveryOrchestrator` — the single entry point for framework-agnostic discovery.

#### `DiscoveryOrchestrator`

```ts
export class DiscoveryOrchestrator implements IDiscoveryOrchestrator
```

Decides which framework the project uses and which collaborators scan it.

Scores every detector in the registry and orders them by confidence. It
does not keep only the first: a repo with legacy Express routes and new
Next.js routes matches both, and choosing one silently returned one third
of the endpoints.

### `packages/core/discovery/effective-project-root.helper.ts`

Effective project root — a00014 S1.

#### `effectiveProjectRoot`

```ts
export function effectiveProjectRoot(match: IProjectMatch): string
```

Effective project root, honoring `frameworkSearchRoot`.

- Without `frameworkSearchRoot` → `match.projectRoot` (for compatibility
  with flat projects and tests that do not populate the field).
- With `frameworkSearchRoot` → `path.resolve(projectRoot,
  frameworkSearchRoot)`, provided the result remains within `projectRoot`.

Throws a clear `Error` if `frameworkSearchRoot` points outside `projectRoot`
  (for example, because it contains `..` or is absolute).

#### `effectiveSearchRoot`

```ts
export function effectiveSearchRoot(match: IProjectMatch): string
```

Alias for `effectiveProjectRoot` with the name Hono, NestJS, and Next.js
already used in their inline helpers. A scanner migrating from a local helper
to the central one can keep calling its preferred function without another
change.

The behavior is identical to `effectiveProjectRoot`: the same resolution,
guard, and error. Only the name changes to preserve existing call sites.

#### `rawProjectRoot`

```ts
export function rawProjectRoot(match: IProjectMatch): string
```

The actual project root, unchanged.

Returns `match.projectRoot` as provided. This lets a scanner that needs the
user's root—the `projectRoot:` of the `IProjectMatch` returned to the
orchestrator, or a `join` with a `route.sourceFile` already relative to
`projectRoot`—go through a helper instead of reading `match.projectRoot`
directly. The `lint:effective-project-root` gate can then control all
references to `match.projectRoot` through one allowlist.

### `packages/core/discovery/endpoint-merger.service.ts`

`EndpointMerger`: the endpoint reconciler for hybrid projects.

#### `EndpointMerger`

```ts
export class EndpointMerger implements IEndpointMerger
```

Default `IEndpointMerger` implementation. Stateless: state lives in
`merge()` (the candidates), not in the instance. Reusable across concurrent
calls.

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

Wrapper for consuming candidates from `EndpointSpec[]` (the adapter's
output). It preserves each candidate's `framework` from spec metadata: the
pipeline marks the spec with `formRequest` or the controller name, but the
most reliable source is an explicit `framework` (as `discoverSpecs` does
when iterating over the `usable` items).
This adapter shape is consumed by the merger pipeline.

#### `endpointSpecFromMerged`

```ts
export function endpointSpecFromMerged(m: IMergedEndpoint):
```

Inverse of `candidatesFromSpecs`: converts an `IMergedEndpoint` back to
`EndpointSpec` so the pipeline continues using the shape consumed by the
other services.

Copies the fields selected by the merger: identity (method, uri, name) and
the winning pieces (body, fields, description, auth).
The auth branch is mapped without changing its semantic type.

Audit 2026-09-04 P1 #6 + second review #16 #17: the per-operation auth
scheme override must survive the merger. `spec.auth` maps to the candidate's
`authScheme` in generation.pipeline.ts, and the merger carries the winner
back here. The reverse conversion covers **all** branches of the
`IEndpointAuth` union:

  - `type: "none"` → `auth: { kind: "none" }` (public override).
  - `type: "bearer"` → `auth: { kind: "scheme", scheme: "bearer" }`.
  - `type: "apikey"` → `auth: { kind: "scheme", scheme: "apiKey" }`.
  - `type: "oauth2"` → `auth: { kind: "scheme", scheme: "oauth2" }`.

Previously only the `none` branch was translated. A per-op
`bearer`/`apiKey`/`oauth2` override was discarded, and `detectAuthScheme`
recalculated auth at collection level—losing the override.

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

Generation pipeline: `projectRoot` -> `PostmanCollection`.

#### `MultipleServicesWithoutCombineError`

```ts
export class MultipleServicesWithoutCombineError extends Error
```

Thrown by `generateCollection()` when the project has several
services but the caller did NOT request `--combine-services` (nor
`IGenerationOptions.combineServices === true`).

## Why it exists

Until x00024, the singular contract documented "a single collection"
but the multi-service branch did `return result[0]` and silently
discarded the rest. That turned `await generateCollection(monorepoRoot)`
into a call that loses services without warning -- exactly the kind
of bug a caller never catches in CI. The plural API
`generateCollections()` was already returning the full array.

## When it is thrown

`generateCollection()` calls `buildFor` and observes three shapes:

  - **Single-service** (a single match, single-workspace monorepo,
    or flat project): `result` is a single `IGenerationResult`. No
    throw.
  - **Multi-service + `combineServices: true`**: the caller asked to
    fuse; `buildFor` already returns a single combined
    `IGenerationResult`. No throw.
  - **Multi-service + `combineServices: false/undefined`**: this is
    the case where this exception is thrown.

The legacy contract (single-service) keeps working exactly as
before -- this only adds a new case.

## Shape of the error

It carries the data the CLI needs to print a useful message without
having to parse the text of `super()`:

  - `serviceCount`: the number of services detected.
  - `serviceIds`: the derived ids (from `match.frameworkSearchRoot`
    via `deriveServiceId`); empty if none had a resolvable id.

The message includes the suggestion ("use --combine-services or
generateCollections()") so that a user who sees the error in raw
form knows what to do.

It lives in this same `.pipeline.ts` (not in `packages/core/errors/`)
because `lint:naming` for `packages/core/` only allows the suffixes
`.service`, `.pipeline`, `.orchestrator`, `.adapter`, and `.helper`.
An error class fits none, so it stays where it is thrown -- the same
pattern as `PostmanApiError` in `domain/postman-api.service.ts`.

#### `generateCollection`

```ts
export async function generateCollection( projectRoot: string, options: IGenerationOptions, ): Promise<IGenerationResult>
```

Discovers the endpoints of a project and builds its collection.

`projectRoot` is the source of truth, and it travels **as an
argument** all the way down: the context is resolved once here and
the loader and the scanners.

Before, this was wrapped in `withProjectRoot()`, which set global
environment variables, executed, and restored them. It worked, but at
the cost of a queue: two concurrent calls clobbered each other's
state, so they had to be serialized. Two analyses at a time took as
long as their sum.

No more. `tests/e2e/concurrent-projects.test.ts` generates two
projects of different frameworks with `Promise.all` and verifies that
they do not collide: not in endpoints, not in name, not in the
context root.

#### `generateCollections`

```ts
export async function generateCollections( projectRoot: string, options: IGenerationOptions, ): Promise<ReadonlyArray<IGenerationResult>>
```

Multi-service variant of `generateCollection`. Returns ALL the
collections, one per service, in discovery order.

- Without `--combine-services` and with N>1 services: an array of
  N collections (each with `collectionName` derived from the
  serviceId).
- With `--combine-services` or N===1: an array of length 1 (the
  legacy collection).

The CLI writes one file per entry; the MCP plugin and the web UI
expose the array as-is.

### `packages/core/discovery/group-by-service.helper.ts`

`groupByService` — a00013 S1.

#### `deriveServiceId`

```ts
export function deriveServiceId(match: IProjectMatch): string
```

Derives a stable id from a match. Two matches with the same
`frameworkSearchRoot` produce the same id.

- When `frameworkSearchRoot` exists, use it as the id base, exactly as
  introduced by a00010.
- Otherwise, fall back to `<framework>@<projectRoot>` to avoid collisions
  between single-framework services in different roots.

#### `collectFlatHybridRoutes`

```ts
export function collectFlatHybridRoutes( routesByMatch: ReadonlyMap<string, ReadonlyArray<ParsedRoute>>, current: IProjectMatch, matches: ReadonlyArray<IProjectMatch>, ): ReadonlyArray<ParsedRoute>
```

x00039: collect routes for a flat-hybrid match.

In flat-hybrid mode, several matches share the same `projectRoot` and
have no `frameworkSearchRoot`. The upstream pipeline keys
`routesByMatch` by `deriveServiceId(match)` (i.e. one entry per
`(framework, projectRoot)`), but the descriptor groups those matches
under a single `serviceId = normalizeServiceId(projectRoot)`. Without
this helper, `.get(serviceId)` always misses and the descriptor ends
up with zero endpoints — the bug that x00039 closed.

We look up every entry whose derived id maps to a match that
shares the current match's `projectRoot`, dedupe by
`(method, uri, sourceFile)` (the same identity
`accumulateRoutesByService` uses), and return the union.

Lives at module scope (not inside `groupByService`) so it is testable
in isolation: the helper has no I/O, no `process.*`, and no
`groupByService`-internal state — only the maps and the
`IProjectMatch` array, both inputs to the function.

#### `groupByService`

```ts
export function groupByService(input: IGroupByServiceInput): IServiceGraph
```

Builds an `IServiceGraph` from discovery matches and routes.

Throws `Error` if:
- A `routesByMatch` entry is missing for a match.
- `matches` is empty and `detectedMonorepo === false` (a non-monorepo
  project **must** have at least one match; otherwise the caller did not
  understand the contracts). The caller can bypass this check by passing
  `detectedMonorepo === true` with an empty array—the "declared monorepo
  with no enumerated workspaces" case.

### `packages/core/discovery/import-resolver.ts`

Import-path resolver (audit 2026-09-06 §12, proposal `r00014` S2).

#### `IImportCandidate`

```ts
export interface IImportCandidate
```

One candidate the resolver can return.

- `path`: posix-shaped path. Always starts with `/` when
  the input `fromFile` was absolute.
- `kind`: why this candidate was generated (extension
  fallback, `/index.{ext}` fallback, or literal). The
  caller can decide to log a warning for, say, a
  `/index.js` fallback in a TS project.

#### `resolveImportPath`

```ts
export function resolveImportPath( fromFile: string, specifier: string, projectRoot: string, ): ReadonlyArray<IImportCandidate>
```

Resolve an import specifier against a source file.

@param fromFile    Absolute path of the file containing the
                   `import … from "…"` statement.
@param specifier   The raw specifier (between the quotes).
                   Bare specifiers like `"lodash"` are
                   rejected — they reference `node_modules`
                   which the resolver does not own.
@param projectRoot Absolute path of the project root. Today
                   the resolver works off `fromFile`'s
                   dirname only — `projectRoot` is part of
                   the signature so a future version can
                   canonicalise the result back to a
                   project-relative path without breaking
                   call sites.
@returns           Zero or more `IImportCandidate`s. Always
                   `[]` when the input is empty or the
                   specifier is a bare module name (no
                   leading `.` or `/`).

### `packages/core/discovery/monorepo-detector.helper.ts`

Monorepo workspace detection — f00011 S3.

#### `detectMonorepo`

```ts
export async function detectMonorepo( projectRoot: string, ): Promise<IMonorepoDetection>
```

Entry point: returns the detection result for a project root.

`projectRoot` must be absolute (scanners and the pipeline have already
converted it). If a relative path is supplied, return "not a monorepo" with
`null` everywhere—the orchestrator should not have to guess which root is
meant.

### `packages/core/discovery/output-paths.helper.ts`

Output path resolution from an explicit `IProjectContext`.

#### `resolveOutputDir`

```ts
export function resolveOutputDir( context: IProjectContext | undefined, argv: ReadonlyArray<string> = process.argv, env: Readonly<Record<string, string | undefined>> = process.env, ): string
```

Directory where artifacts are written, using the same precedence as the
former `outputDir(context?)`.

Accepting `argv` and `env` as parameters instead of reading `process.argv`
and `process.env` makes it possible to test precedence without mutating
the process. Default values remain global so existing call sites do not
change.

`context` is intentionally optional: when a command runs without a project
context (the `validate-json` `catch` branch, which runs with only the
generated JSON), the helper falls back to `argv` / `env` resolution.
Keeping this entry point preserves historical behavior without introducing
a singleton: the helper remains pure with respect to its arguments and only
reads globals when no context is supplied.

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

Absolute path to the Postman environment for a given environment.

The environment name is slugified as before: NFD → remove diacritics →
kebab-case → trim hyphens. Callers that need the original behavior should
pass an already-normalized `projectName`.

#### `describeDiscoveredPaths`

```ts
export function describeDiscoveredPaths( context: IProjectContext, projectName?: string, argv: ReadonlyArray<string> = process.argv, ): string
```

The trace the CLI prints before scanning, as text.

Without a project name it displays `<nombre-del-proyecto>` instead of
inventing one: the trace is meant to rule out scanning the wrong folder,
and lying there is worse than saying nothing.

The `routes` and `requests` directories shown belong to the scanned
project and are derived with `projectDirs(context)`. This is a heuristic
inherited from the Laravel path; modern scanners resolve their own paths,
but the CLI trace still displays them because seeing whether they exist is
useful.

### `packages/core/discovery/project-context.service.ts`

Explicit project context resolution.

#### `resolveProjectContext`

```ts
export function resolveProjectContext( options: IResolveContextOptions =
```

Builds a project context.

Root priority: explicit parameter → `--project-root` in argv →
`POSTMAN_PROJECT_ROOT` in env. Throws if none is present because continuing
with a guessed root produces empty collections without explaining why (this
was exactly the CLI bug with `--project-root`).

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

Path relative to the project, in POSIX format.

Previously this used `normalized.startsWith(context.projectRoot)`, but
`startsWith` does not understand segment boundaries: `/home/u/api-secret`
falsely matches `/home/u/api` (x00022, audit 2026-09-04). It now uses the
same canonical formula as
`packages/core/helpers/path-containment.helper.ts`: `relative()` plus the
`..${sep}` / absolute prefix guard.

If `absPath` is exactly the project root, return the empty string to
preserve the idempotence of `fromProjectRoot ∘ toProjectRelative`.

#### `hasProjectDir`

```ts
export function hasProjectDir(context: IProjectContext, relPath: string): boolean
```

### `packages/core/discovery/project-loader.service.ts`

Loads the host project's configuration in a framework-agnostic way.

#### `detectProjectName`

```ts
export async function detectProjectName( context: IProjectContext, ): Promise<string>
```

Returns the host project name.

Manifest reading lives in `project-name.service`: this function only
resolves the root. Previously it looked only at `composer.json`, so Laravel
was named after its package while the other eleven frameworks were named
after their directories.

#### `detectFilePrefixes`

```ts
export async function detectFilePrefixes( context: IProjectContext, ): Promise<Record<string, string[]>>
```

Reads `RouteServiceProvider.php` to extract the
`file → prefixes` map from the `mapXxxRoutes()` methods.

Laravel example:
  protected function mapExternalApiRoutes(): void {
    Route::prefix('api/externo')
      ->group(base_path('routes/externo.php'));
  }

→ `{ "routes/externo.php": ["api", "externo"] }`

#### `buildZeroConfig`

```ts
export async function buildZeroConfig( context: IProjectContext, ): Promise<ProjectConfig>
```

Generates a minimal viable ProjectConfig without a host file, allowing the
package to work out of the box in any project.

The default `baseUrl` is the origin (`DEFAULT_BASE_URL`). The `/api` suffix
is **not** added automatically; it appears only when one of the sources
documented in `BASE_PATH_SOURCES` supplies it. This closes the bug that
produced `http://localhost/api/users` in Express, Flask, Gin, and FastAPI
projects without a global prefix (a00012 H-P2e, S4).

#### `resolveConfigPath`

```ts
export async function resolveConfigPath( argv: ReadonlyArray<string> = [], context: IProjectContext, ): Promise<string>
```

Resolves the host configuration module path.

Order:
  1. `--config <path>` (CLI)
  2. `POSTMAN_CONFIG` (env)
  3. `${projectRoot}/resources/postman/examples/...` or `${projectRoot}/examples/...`
  4. If nothing matches, return the "__zero__" sentinel so loadProject uses
     buildZeroConfig().

#### `loadProject`

```ts
export async function loadProject( argv: ReadonlyArray<string> = [], context: IProjectContext, ): Promise<LoadedProject>
```

The context is mandatory so the loader is safe in long-lived processes and
does not reread the cached root from the `paths.service` singleton retired
in r00010 S2 (2026-09-03).

#### `_internal`

```ts
export const _internal =
```

Internal pieces exposed **only** for their tests.

The underscore is the signal: they are not part of the module contract and
may change without notice.

### `packages/core/discovery/project-name.service.ts`

Project name, read from its ecosystem manifest.

#### `detectProjectNameIn`

```ts
export async function detectProjectNameIn(projectRoot: string): Promise<string>
```

Project name in `projectRoot`.

Never throws: if no readable manifest exists, fall back to the directory
name, which always exists.

### `packages/core/discovery/scan-root.helper.ts`

Effective scan root for a scanner — a00012 S1.b.

#### `effectiveScanRoot`

```ts
export function effectiveScanRoot(match: IProjectMatch): string
```

The root where a scanner should search for its sources.

- Without `frameworkSearchRoot` → `match.projectRoot` (for compatibility
  with flat projects and tests that do not populate the field).
- With `frameworkSearchRoot` → `path.resolve(projectRoot,
  frameworkSearchRoot)`, provided the result remains within `projectRoot`.

Throws a clear `Error` if `frameworkSearchRoot` points outside
`projectRoot` (for example, because it contains `..` or is absolute).

#### `safeScanRoot`

```ts
export function safeScanRoot(match: IProjectMatch): string
```

Alias for `effectiveScanRoot` with a name that emphasizes that the
helper **can throw** when the search path escapes the project root.
Useful when the caller wants to make the containment check explicit
(for example, in multi-step pipelines where the `try`/`catch` should be
clear).

The behavior is identical to `effectiveScanRoot`: the same resolution,
guard, and error. Only the name changes so code using it can express its
intent.

### `packages/core/discovery/summary.service.ts`

`summary` — what the tool sees in a project, without writing anything.

#### `summarizeProject`

```ts
export async function summarizeProject( projectRoot: string, orchestrator: DiscoveryOrchestrator, legacyFallback?: ILegacyDiscovery, ): Promise<IProjectSummary>
```

Inspects `projectRoot` and returns a summary without writing files.

Throws if the directory does not exist. If it does not recognize the
project, returns a summary with zero endpoints and the corresponding
warning—an honest response rather than an error.

The framework catalog and fallback are injected, as in the pipeline: this
is a core service and cannot know the concrete scanners. For the complete
catalog, use `summarizeWithAllFrameworks()` in `packages/frameworks/`.

### `packages/core/discovery/symbol-graph.ts`

`SymbolGraph` — Tanit's cross-file symbol resolver (audit 2026-09-06 §12, proposal `r00014` S1).

#### `SymbolKind`

```ts
export type SymbolKind = | "value" | "type" | "router" | "plugin" | "sub-app" | "handler"
```

#### `ISymbolNode`

```ts
export interface ISymbolNode
```

#### `IImportRecord`

```ts
export interface IImportRecord
```

One import edge — `import { router as usersRouter } from
"./users/routes"`. The graph does **not** resolve
`"./users/routes"` to a file path (that's S2). It just
records the specifier and the local names so the resolver
can later walk the edge.

#### `empty`

```ts
export function empty(): ISymbolGraph
```

#### `SymbolGraph`

```ts
export const SymbolGraph =
```

Namespace alias so callers can write
  `SymbolGraph.empty()`
instead of importing two names. Mirrors the ergonomic
shape of every other helper in `core/discovery/`.

#### `SymbolGraphBuilder`

```ts
export class SymbolGraphBuilder
```

### `packages/core/discovery/symbol-id.ts`

`SymbolId` helper (audit 2026-09-06 §12, proposal `r00014` S1).

#### `SymbolId`

```ts
export interface SymbolId
```

`SymbolId` helper (audit 2026-09-06 §12, proposal `r00014`
S1).

A `SymbolId` is the **stable identity** of a symbol in
Tanit's cross-file resolver. Identity is anchored to the
declaration position, not to the textual name — two
`const router = …` declarations in different files have the
same `localName === "router"` but different `SymbolId`s.

Stability is important: every cross-file reference the
scanners carry in their aux maps (Express router prefix,
Fastify plugin prefix, Hono sub-app mount) keys on
`SymbolId`, so the key never collides across files even when
the local name is the same.

#### `makeSymbolId`

```ts
export function makeSymbolId( sourceFile: string, declarationStart: number, localName: string, ): SymbolId
```

Build a `SymbolId`. Not much code on purpose — centralising
the construction lets the resolver assert invariants (non-empty
`sourceFile`, non-negative offset, non-empty `localName`)
from a single place instead of every scanner duplicating the
checks.

#### `symbolIdToString`

```ts
export function symbolIdToString(id: SymbolId): string
```

#### `parseSymbolId`

```ts
export function parseSymbolId(serialized: string): SymbolId | null
```

Parse a string produced by `symbolIdToString`. Inverse
operation; returns `null` when the input isn't shaped like
a serialised `SymbolId`.

### `packages/core/discovery/to-service-graph.helper.ts`

toServiceGraph - a00013 S2.

#### `toServiceGraph`

```ts
export function toServiceGraph(input: IToServiceGraphInput): IServiceGraph
```

Builds the IServiceGraph from the current discovery state.

The helper does not infer anything absent from the input. If the caller has
not yet populated routesByService/authByService/etc., return a graph with each
service's identity and empty arrays—the exact shape S2 needs so S3/S4 can
populate it without changing the contract.

#### `decorateServices`

```ts
export function decorateServices( graph: IServiceGraph, overrides:
```

Variant of toServiceGraph that applies the caller's overrides to each
descriptor after calculation. Useful when the caller wants to produce a
decorated IServiceGraph without reimplementing auth/baseUrl/variable
propagation.

It lives here for now because only S2 and its tests use it; if S3 or S4 need
it more broadly, promote it to an independent helper.

### `packages/core/discovery/workspace-glob.helper.ts`

Workspace glob resolver — a00012 S1.a.

#### `resolveWorkspaceGlobs`

```ts
export async function resolveWorkspaceGlobs( projectRoot: string, globs: ReadonlyArray<string>, ): Promise<ReadonlyArray<string>>
```

Materializes a list of workspace globs into real directories.

@param projectRoot Absolute project root (callers have already converted
  it to an absolute path outside this helper).
@param globs Relative POSIX globs, optionally prefixed with `!` to mark
  exclusions.
@returns Existing directories under `projectRoot` in POSIX-relative form,
  sorted lexicographically and deduplicated. An invalid root path returns
  `[]`.

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

### `packages/core/domain/postman-method.helper.ts`

Maps a Tanit `EndpointSpec.method` (or any `string`) to the literal the Postman v2.1.0 schema accepts in `request.method`.

#### `postmanMethodFor`

```ts
export function postmanMethodFor(method: string): string
```

Maps a Tanit `EndpointSpec.method` (or any `string`) to the literal
the Postman v2.1.0 schema accepts in `request.method`.

`ALL` (the Hono `.all()` sentinel — see `aad6376` and the audit
2026-09-06 second pass §6) maps to `ANY`, the only Postman verb
that captures "any HTTP method". Older Postman versions ignore
`ANY` and fall back to a GET; that is acceptable — it is the
same fallback the previous `app.all('/x', h) → GET` mapping
produced, but with the original semantics preserved instead of
lost.

Exported (and given a stable name) so the CLI's bidirectional
coverage check can use the same translation: without it, a source
route with `method: "ALL"` and a collection request with
`method: "ANY"` look like two different endpoints to the validator
and it aborts the generation. Single helper, single source of
truth.

Accepts `string` (not `EndpointSpec["method"]`) so callers that
only have the raw `ParsedRoute.method` can use it without
casting.

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
export function buildRequestDescription( base: string | undefined, fields: ReadonlyArray<IEndpointField> | undefined, confidence: IEndpointConfidence | undefined, ): string
```

Builds the Markdown description that Postman renders in the
request's documentation panel.

`base` is what the request already contained (the handler name, or the
`summary` of an OpenAPI spec). It is kept at the top: it is something
someone intentionally wrote, and replacing it with a generated table
would trade information for presentation.

### `packages/core/domain/test-script.service.ts`

Assertions carried by each request in the collection.

#### `buildTestScript`

```ts
export function buildTestScript(spec: EndpointSpec): PostmanEvent
```

#### `appendTestScript`

```ts
export function appendTestScript( existing: ReadonlyArray<PostmanEvent> | undefined, spec: EndpointSpec, ): PostmanEvent[]
```

Adds assertions to an item without overwriting anything it already had.

The login endpoint already has a script that saves the token, and the logout
endpoint has one that deletes it. Replacing the entire array would remove
them and the collection would stop authenticating itself—which is the reason
the auth flow exists.

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

Exporter to OpenAPI 3.1.0.

#### `buildOpenApiDocument`

```ts
export function buildOpenApiDocument(input: IExportInput): Record<string, unknown>
```

The OpenAPI document as an object, before serializing it.

It is exported so its **structure** can be checked with precise
assertions instead of scanning for substrings in a YAML. That the
YAML itself is correct is another problem, and `yaml.helper.spec.ts`
covers it.

#### `OpenApiExporter`

```ts
export class OpenApiExporter implements IExportTarget
```

### `packages/core/helpers/all-method.helper.ts`

Expands `EndpointSpec.method === "ALL"` (the Hono `.all()` sentinel emitted by commit `aad6376`, audited again on 2026-09-06 §13) into the seven standard HTTP verbs that every exporter except Postman can represent directly.

#### `isAllMethodSpec`

```ts
export function isAllMethodSpec(spec: EndpointSpec): boolean
```

Returns true iff the spec's method is the `ALL` sentinel.

Pulled out as a named predicate so each exporter can decide whether
to expand (`true`) or to translate (`false`, Postman). Keeping the
`===` check here means adding a future sentinel is a single-file
change.

#### `expandAllMethods`

```ts
export function expandAllMethods( specs: ReadonlyArray<EndpointSpec>, ): IExpandedSpec[]
```

Expands every `method: "ALL"` spec into seven specs with the seven
standard verbs. Non-`ALL` specs pass through unchanged.

The expansion is shallow: `spec.fields`, `spec.body`, `spec.query`,
`spec.headers`, `spec.description`, `spec.schemaGraph` and friends
are carried over verbatim. `spec.method` is the only field that
changes; `spec.name` and `spec.uri` are preserved so that the
seven operations belong to the same endpoint and can be grouped
together by downstream tooling.

### `packages/core/helpers/argv.helper.ts`

Read a flag from the command line, once.

#### `readFlag`

```ts
export function readFlag( argv: ReadonlyArray<string>, name: string, ): string | undefined
```

The value of `--flag value`, or `undefined` if not present.

Also accepts `--flag=value`, which is how half the people write it
and how almost every script generates it. Before, only the
space-separated form worked and the other one was silently ignored:
the flag looked like it wasn't there.

#### `hasFlag`

```ts
export function hasFlag(argv: ReadonlyArray<string>, name: string): boolean
```

### `packages/core/helpers/atomic-write.helper.ts`

Write a whole file, or don't write it at all.

#### `writeFileAtomic`

```ts
export async function writeFileAtomic( destino: string, contenido: string, ): Promise<void>
```

Writes `contenido` to `destino` atomically.

Creates the directory if needed. If anything fails, `destino` stays
exactly as it was and no temp file is left behind.

#### `writeJsonAtomic`

```ts
export async function writeJsonAtomic( destino: string, valor: unknown, espacios = 2, ): Promise<void>
```

Same, for JSON.

Serializes **before** touching the disk: if the object has a cycle
or a `BigInt`, `JSON.stringify` throws and no file has been opened.
Serializing while writing is how you end up with a half-written file
without the process even crashing.

#### `appendFileAtomic`

```ts
export async function appendFileAtomic( destino: string, contenido: string, ): Promise<void>
```

Atomic append of `contenido` to the end of `destino`.

It differs from `writeFileAtomic` in what it protects:

  - `writeFileAtomic` writes the **whole** file: a `rename` within
    the same filesystem is atomic, but the file is truncated before
    the rename. That's what you want for a Postman collection, where
    the reader needs the complete version or nothing.

  - `appendFileAtomic` appends `contenido` to the end: it uses
    `appendFile`, which opens the destination with `O_APPEND`. On
    POSIX that's atomic per `write(2)`: two processes writing at
    once don't step on each other —their bytes end up at the end in
    some order, but none is lost half-written—. That's what you want
    for a JSONL log: each line is one entry, and reading the last N
    lines must be safe even if another write is in progress.

If the file doesn't exist, it creates it (recursive mkdir on the
directory, same as `writeFileAtomic`). If the write fails, it
doesn't leave partial content visible: `appendFile` doesn't truncate
before writing, so a failure halfway through a line shows up as a
prefix without a newline, and that's handled by the reader as a
corrupted line.

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

Stable identity of Postman artifacts.

#### `stableUuid`

```ts
export function stableUuid(seed: string): string
```

Deterministic UUID v5 from a seed.

@param seed Text that identifies the artifact (project name,
            environment name…). Normalized so that differences in
            casing or whitespace don't produce different IDs.

#### `collectionIdFor`

```ts
export function collectionIdFor(identity: ICollectionIdentity): string
```

ID of a project's collection.

If the host declares `collectionId`, it's honored as-is: it's the
way to keep the collection in Postman even if the project is renamed
or moved between folders.

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

Recursive directory walk for the scanners.

#### `collectFiles`

```ts
export async function collectFiles( root: string, matches: (fileName: string) => boolean, options: ICollectFilesOptions =
```

Absolute paths of all files under `root` (recursive) whose name
passes the filter.

Never throws. An unreadable directory or a link cycle are skipped and
the rest of the tree is still walked — which is what this function
promised and didn't deliver.

#### `collectFilesFrom`

```ts
export async function collectFilesFrom( roots: ReadonlyArray<string>, matches: (fileName: string) => boolean, options: ICollectFilesOptions =
```

Same as `collectFiles` over multiple roots, without duplicates and
skipping those that don't exist.

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

Parse third-party JSON without `any` leaking into the rest of the program.

#### `parseJson`

```ts
export function parseJson(raw: string): JsonRead
```

Parse, distinguishing "couldn't parse" from "parsed to `null`".

The two cases got confused: `JSON.parse("null")` returns `null`, and a
`catch` that also leaves `null` makes a corrupt file and one that
legitimately contains `null` end up identical. Only one of them
deserves a warning.

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

The dependencies declared in a `package.json`, merged.

`dependencies` and `devDependencies` together, because the question
the scanners ask is "does this project use X?" and a framework in
`devDependencies` is still the project's framework. Some scanners
looked at them and others didn't, so the same project was detected or
not depending on which one was asking.

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

Reusable helpers for walking and analyzing Postman collections.

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

Walk the collection and return all flat requests.
If `folder` is passed, it's used as the prefix of the folder path.

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

### `packages/core/helpers/schema-flatten.helper.ts`

SchemaGraph → flat field list (audit 2026-09-06 §9, proposal `r00016`).

#### `fieldsFromGraph`

```ts
export function fieldsFromGraph( graph: ISchemaGraph, root: SchemaNodeId = graph.root, ): ReadonlyArray<IEndpointField>
```

Flatten a `SchemaGraph` into a list of `IEndpointField`.

The first entry corresponds to the root node; the order is
stable across runs (Babel-friendly: children, alternatives,
and constraints are read in declaration order). The same input
always produces the same output, which keeps diffs between two
runs stable.

`root` is the node the request hangs from. When the spec
already declares its own root via `spec.schemaGraph.root`,
`flattenBody` calls this helper with that root.

#### `bodyFieldsFromGraph`

```ts
export function bodyFieldsFromGraph( spec:
```

Convenience: derive the body's flat fields from the spec.

Equivalent to `fieldsFromGraph(spec.schemaGraph, spec.schemaGraph.root)`
with an empty guard for the legacy path (no graph attached —
returns `undefined`, the existing `fields` field is the source
of truth).

#### `graphAndFieldsAreConsistent`

```ts
export function graphAndFieldsAreConsistent( spec:
```

Consistency check (audit 2026-09-06 §9, proposal `r00016` S2).

Today `EndpointSpec` carries both a flat `fields` array
(used by Postman, HAR, Bruno, curl) and an optional
`schemaGraph` (used by OpenAPI). They must agree:
otherwise a Postman collection shows `name: "body.age"`
with `type: "string"` while OpenAPI says `type: "integer"`,
i.e. two sources of truth drift apart silently.

The check:
  - If both are present, every field the graph flattens
    must equal (name, type) of an entry in `spec.fields`.
    Otherwise the scanner is lying — the test pin in
    `r00016 S2` catches it before the data reaches the
    exporter.
  - If only one is present (today's case for scanners
    that haven't migrated yet), the check passes — the
    missing side is allowed during the migration window
    the proposal calls out.
  - If neither is present, the check passes — there's
    nothing to drift apart.

Returns `true` when the spec is internally consistent;
`false` otherwise. Designed to be called from a vitest
`expect(spec).toSatisfy(graphAndFieldsAreConsistent)` so
the scanner's spec payload can be checked at the test
boundary.

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

### `packages/core/language-frontends/typescript/extract-routes-fastify.helper.ts`

Fastify route extractor (audit 2026-09-06 §12, proposal `r00013` S1).

#### `IExtractedRoute`

```ts
export interface IExtractedRoute
```

#### `IRouterMount`

```ts
export interface IRouterMount
```

#### `extractFastifyRoutesFromIR`

```ts
export function extractFastifyRoutesFromIR( calls: ReadonlyArray<IRouteCallExpression>, bindings: ReadonlyArray<IImportBinding>, file: string, ):
```

Extrae las rutas Fastify del IR de un fichero ya parseado.

Cubre la forma corta (`fastify.get('/path', h)`, incluida la
expansión de `method: ['GET', 'POST']` en `fastify.route({...})` a
una ruta por verbo) y los mounts de plugins
(`fastify.register(sub, { prefix })`). El receiver se valida contra
bindings de `fastify`/`Fastify` para no confundir llamadas ajenas.

@param calls - Route calls del LanguageIR (propagadas y resueltas).
@param bindings - Import bindings del mismo fichero.
@param file - Ruta del fichero fuente, para anclar cada ruta.
@returns Rutas extraídas (una por verbo) y mounts con prefijo.

### `packages/core/language-frontends/typescript/extract-routes-hono.helper.ts`

Hono route extractor (audit 2026-09-06 §12, proposal `r00013` S2).

#### `extractHonoRoutesFromIR`

```ts
export function extractHonoRoutesFromIR( calls: ReadonlyArray<IRouteCallExpression>, bindings: ReadonlyArray<IImportBinding>, file: string, ):
```

Extrae las rutas Hono del IR de un fichero ya parseado.

Reconoce `app.get/post/...('/path', h)`, `app.all('/path', h)`
(emite `method: "ALL"`) y los mounts `app.route('/prefix', sub)`,
resolviendo el receiver solo contra routers Hono importados
(`hono`, `@hono/*`), no contra cualquier identificador. Un solo
pase sobre `calls` — el AST ya lo produjo el frontend; aquí solo se
interpreta.

@param calls - Route calls del LanguageIR (propagadas y resueltas).
@param bindings - Import bindings del mismo fichero (filtra receivers).
@param file - Ruta del fichero fuente, para anclar cada ruta.
@returns Rutas extraídas y mounts con prefijo, en orden de aparición.

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

#### `parseWithProgram`

```ts
export function parseWithProgram( source: string, filename: string, ):
```

Variante de `parse` que devuelve ADEMÁS el `Program` crudo de
Babel (x00048 S3 / a00016 S6.d).

El caso de uso: un scanner que necesita tanto el `TSFile` del
frontend (assignments, decorators, classes…) como las primitivas
del LanguageIR (`IRouteCallExpression[]`, `IConstantBinding[]`,
`IImportBinding[]`, `IReexport[]`). Sin este helper, eso son 2+
parses Babel del mismo fichero; con él, el scanner pasa
`program` a `buildLanguageIRFromProgram` y el coste es 1 parse.

`program` se tipa como `unknown` a propósito: el frontend no
expone los tipos de `@babel/types` en su superficie pública
(serían ~2500 tipos de dependencia), y los consumidores del IR
ya castean de forma permissiva a su propio `BabelNode`, igual
que hace este módulo internamente.

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

#### `parseModuleWithProgram`

```ts
export function parseModuleWithProgram( source: string, filename: string, diagnostics?: Array<IParseDiagnostic>, ):
```

Variante safe de `parseWithProgram` (x00048 S3): devuelve `null` y
registra el diagnóstico si Babel rechaza el archivo, en vez de
lanzar. Es la entrada que usa `parseModuleSafe` del scanner de
Express: un solo parse por archivo alimenta el `TSFile` del
frontend Y las primitivas del LanguageIR.

### `packages/core/responses/infer-responses.ts`

Response inference dispatcher (audit 2026-09-06 §10, proposal `f00012` S1).

#### `listRegisteredInferrers`

```ts
export function listRegisteredInferrers(): ReadonlyArray<IResponseInferrer>
```

#### `registerResponseInferrer`

```ts
export function registerResponseInferrer( inferrer: IResponseInferrer, ): void
```

Register an inferrer. No-op if an inferrer for the same
framework is already registered (last-write-wins would be a
recipe for accidental overwrites — explicit replace is what
tests want).

#### `__setInferrersForTest`

```ts
export function __setInferrersForTest( list: ReadonlyArray<IResponseInferrer>, ): void
```

Replace the entire registry — test-only escape hatch.

Tests run `__setInferrersForTest([])` to start from a clean
state and call `registerResponseInferrer` to compose the
scenarios they want. Production code never uses this.

#### `inferResponses`

```ts
export function inferResponses( spec: EndpointSpecLike, source: IFrameworkSourceFileLike, ): ReadonlyArray<IResponseInference>
```

Run every registered inferrer against `spec`/`source`,
concatenate and dedupe the entries, sort stably. The result
is the array that will land in `EndpointSpec.responses`.

Fail-soft: a thrown inferrer logs a warning (via
`console.warn`) and is otherwise invisible. We never bubble
errors out of here; that would block generation on a single
malformed handler.

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

Multi-service contract (audit 2026-09-06 second pass §3.3):
  - one service                       → `IGenerationResult` of that service
  - N services + `combineServices:false` → throws
    `MultipleServicesWithoutCombineError` (x00024). Callers that
    want the array use `generateCollectionsWithAllFrameworks`.
  - N services + `combineServices:true`  → one combined `IGenerationResult`.

#### `generateCollectionsWithAllFrameworks`

```ts
export async function generateCollectionsWithAllFrameworks( projectRoot: string, options: IGenerateOptions =
```

Plural facade: ALWAYS returns a `ReadonlyArray<IGenerationResult>`,
one entry per detected service. The single-service path returns a
one-element array.

Use this facade in CLI commands that must not silently drop the
other services when `combineServices` is false (audit 2026-09-06
§3.3 / §18 priority 7). The singular facade
`generateWithAllFrameworks` is kept for callers that only handle
the combined case.

#### `summarizeWithAllFrameworks`

```ts
export function summarizeWithAllFrameworks( projectRoot: string, ): Promise<IProjectSummary>
```

Inspecciona un proyecto con todos los frameworks soportados.

El equivalente de `generateWithAllFrameworks()` para el camino de
solo lectura: `summary`, el modo `--inspect` y el tool del plugin.

