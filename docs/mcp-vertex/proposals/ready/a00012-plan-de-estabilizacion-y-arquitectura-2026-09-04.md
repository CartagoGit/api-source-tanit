---
id: a00012
title: "Plan de estabilización + cimientos de arquitectura 2026-09-04 — CI reproducible, ProjectTopology/scanRoot/scores, auth/login y validación agnóstica"
kind: audit
date: 2026-09-04
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00010
  - a00011
  - p00007
related:
  - a00009
  - f00010
  - f00011
---

> **Contexto.** Esta propuesta **no añade frameworks ni features nuevas**.
> Es la consolidación de los hallazgos que dos revisiones independientes
> (auditoría externa 2026-09-03 e informe de cierre 2026-09-04)
> dejaron como deuda estructural después de cerrar `a00010`/`a00011`
> y las `f00010`/`f00011`. Empieza por **S0 — restaurar CI
> reproducible**, porque sin CI confiable ningún slice posterior puede
> declararse realmente cerrado.

# a00012 — Plan de estabilización + cimientos de arquitectura 2026-09-04

## Snapshot auditado

- **Rama**: `develop`.
- **SHA de partida**: `7391b9a7c9464632764c87ab32e9a0d50109bd03`
  (cabecera real al empezar la sesión; coincide con la auditoría
  independiente 2026-09-04).
- **Tree**: limpio salvo este plan en `ready/` y la actualización
  posterior del `INDEX.md`.
- **CI público (GitHub Actions)**: ROJO en
  [`.github/workflows/validate.yml`](../../.github/workflows/validate.yml).
  El job falla en `bun install --frozen-lockfile` y se salta `Validate`,
  `Audit dependencies` y `Validate package`.
- **Validación local**: pasa con `EXIT: 0` salvo `validate:package`,
  que tras los slices S4/S5 de `f00010` quedó verde
  (commit `7391b9a` movió `@babel/parser` de `devDependencies` a
  `dependencies`).
- **Estado del catálogo de propuestas**: `ready/` vacío, `blocked/`
  vacío (la antigua `p00007` se cerró como `done` el 2026-09-03).
- **Riesgo operativo**: `develop` sin protección de rama ni
  `required_status_checks`; varios agentes en vuelo. Implicación: un
  slice localmente verde puede no ser estable remotamente.

## Veredicto resumido (heredado de la auditoría externa)

| Área | Auditoría 09-03 | Cierre 09-04 |
|---|---|---|
| Idea / utilidad | 9,4 | 9,4 |
| Arquitectura global | 8,2 | 8,2 |
| Core / pipeline | 7,2 → 8,2 | 8,2 con la fuga IR Postman todavía abierta |
| Autodetección | 6,8 | 6,8 (monorepo + score sin clamp + scanRoot disperso) |
| Profundidad semántica de scanners | 7,1 | 7,1 |
| Validación / IR | 6,2 → 7,0 | 7,0 con SchemaGraph parcial |
| CLI | 8,5 | 8,7 |
| UI web | 8,8 | 8,2 (i18n 4,5) |
| Plugin MCP | 6,5 / 3,5 reproducible | 8,3 / **ROJO en CI reproducible** |
| Tests (planteamiento) | 8,4 | 9,1 |
| CI / gates | 4,0 | 9,0 locales, **ROJO remoto** |
| Mantenibilidad | 7,4 | 8,0 |
| Packaging / portabilidad | 7,8 / 6,8 | 8,7 / 6,8 (Node ≠ Bun todavía) |

Conclusión: **primero CI reproducible, luego cimientos, luego features**.
Este plan lo asume.

## Hallazgos confirmados contra HEAD (no sólo contra informe)

Cada hallazgo lleva el archivo:línea exacto para que el siguiente
agente no tenga que re-derivar.

### P0 — CI reproducible / DoD de packaging

- **H-P0.1** `bun install` falla en `[workflow validate.yml:20]`
  porque
  [`packages/plugins/mcp-vertex_expostman/package.json:27`](../../packages/plugins/mcp-vertex_expostman/package.json#L27)
  declara `@mcp-vertex/core` como `file:../../../../mcp-vertex/packages/core`
  y el runner sólo hace checkout del repo actual.
- **H-P0.2** `p00007` se cerró como `done` (2026-09-03) decidiendo
  "consumir mcp-vertex desde el checkout hermano mientras no haya
  publicación npm". **Esa decisión no está materializada en CI**.
- **H-P0.3** `validate-package` (post-fix de `@babel/parser` en
  `7391b9a`) pasó localmente, pero **no hay aserción que asegure
  que el plugin no se filtra en el tarball** del producto público;
  confiar ciegamente en `"private": true` no es evidencia.

### P1 — Topología, raíz efectiva y scoring

- **H-P1a** Monorepo: `resolveWorkspaceDirs` en
  [`packages/core/discovery/monorepo-detector.helper.ts:325-340`](../../packages/core/discovery/monorepo-detector.helper.ts#L325-L340)
  toma literalmente el prefijo al primer `*`. `apps/*` produce
  `apps`, no enumera `apps/api`, `apps/web`. Los tests existentes
  codifican ese comportamiento como "correcto".
- **H-P1b** Topología vs framework: en
  [`packages/core/discovery/generation.pipeline.ts:160-220`](../../packages/core/discovery/generation.pipeline.ts#L160-L220)
  `detectAll(projectRoot)` corre **antes** de
  `applyFrameworkSearchRoot`. Un framework declarado sólo dentro de
  `apps/api/package.json` puede quedar sin puntuar.
- **H-P1c** Score sin clamp: `withEvidence(score, evidence)` en
  [`packages/frameworks/scanners/detect-result.helper.ts:28-33`](../../packages/frameworks/scanners/detect-result.helper.ts#L28-L33)
  devuelve el score tal cual. Hono/Next aplican `Math.min(..., 1)` a
  mano; Fastify no. Combinación de locks: `1 + 0.1 + 0.15 = 1.25`.
- **H-P1d** `frameworkSearchRoot` no es contrato universal.
  [`packages/frameworks/scanners/fastify.scanner.ts:159`](../../packages/frameworks/scanners/fastify.scanner.ts#L159),
  [`packages/frameworks/scanners/fiber.scanner.ts:90`](../../packages/frameworks/scanners/fiber.scanner.ts#L90)
  y
  [`packages/frameworks/scanners/rust.scanner.ts:117`](../../packages/frameworks/scanners/rust.scanner.ts#L117)
  usan `match.projectRoot` directamente, ignorando `match.frameworkSearchRoot`.
  Hono y Next sí lo respetan (vía `effectiveSearchRoot`).

### P2 — Generación / auth / login / IR

- **H-P2a** Folder tree inalcanzable. En
  [`packages/core/domain/collection-builder.service.ts:249`](../../packages/core/domain/collection-builder.service.ts#L249)
  `mainKey = g.explicit ? g.key : autoMainKey`. Acto seguido
  `if (g.explicit) { if (g.key === mainKey) { h.direct.push(...) }
  else { h.subs.push(...) } }`. Cuando `g.explicit` es true la
  condición del `if` interno siempre es true → la rama que mete
  subcarpetas explícitas **nunca se ejecuta**.
- **H-P2b** Auth global: `defaultHeaders()` en
  [`packages/core/domain/collection-builder.service.ts:56`](../../packages/core/domain/collection-builder.service.ts#L56)
  inyecta `Authorization: Bearer {{token}}` cuando el esquema global
  es bearer. Esto se aplica a login, `/health`, `/register`, etc.
- **H-P2c** `useCredentialVariables(login)` en
  [`packages/core/domain/auth-flow.service.ts:270`](../../packages/core/domain/auth-flow.service.ts#L270)
  reemplaza el body real cuando no reconoce credenciales por
  `{ "email": "...", "password": "..." }`. Otras APIs legítimas
  usan `username/password`, `grant_type`, `otp`, `tenant`,
  `client_id/client_secret`, etc.
- **H-P2d** TRACE fuera del modelo: el union
  [`packages/contracts/interfaces/core/postman.interface.ts:125`](../../packages/contracts/interfaces/core/postman.interface.ts#L125)
  no incluye `"TRACE"`; el catálogo
  [`packages/contracts/constants/core/postman.constant.ts:49-50`](../../packages/contracts/constants/core/postman.constant.ts#L49-L50)
  lo mismo. OpenAPI sí reconoce `trace`, pero el adapter lo filtra.
- **H-P2e** `/api` global: `http://localhost/api` aparece como
  fallback en
  [`packages/cli/commands/init.script.ts:62`](../../packages/cli/commands/init.script.ts#L62),
  [`packages/core/domain/environment-builder.service.ts:29`](../../packages/core/domain/environment-builder.service.ts#L29),
  [`packages/core/domain/param-inferrer.service.ts:298`](../../packages/core/domain/param-inferrer.service.ts#L298)
  y
  [`packages/core/discovery/project-loader.service.ts:197`](../../packages/core/discovery/project-loader.service.ts#L197).
  Cinco puertas donde un proyecto Express/Flask/Gin/FastAPI termina
  con `…/api/v1/users` sin que exista `/api` en su router.
- **H-P2f** `process.argv` global: default en
  [`packages/core/discovery/project-loader.service.ts:274`](../../packages/core/discovery/project-loader.service.ts#L274),
  [`:310`](../../packages/core/discovery/project-loader.service.ts#L310),
  y consumido en
  [`packages/core/discovery/generation.pipeline.ts:339`](../../packages/core/discovery/generation.pipeline.ts#L339).
  El pipeline debería funcionar 100 % con `IProjectContext` +
  `IGenerationOptions` explícitos, sin leer `argv` del proceso.
- **H-P2g** `formRequest` leakage: en
  [`packages/core/adapters/parsed-route-to-spec.adapter.ts:258`](../../packages/core/adapters/parsed-route-to-spec.adapter.ts#L258)
  `spec.formRequest = \`${match.framework}:${rules.endpointKey}\``;
  después
  [`packages/cli/commands/generate.script.ts:274`](../../packages/cli/commands/generate.script.ts#L274)
  llama a
  [`packages/frameworks/laravel/catalog-enricher.service.ts:76`](../../packages/frameworks/laravel/catalog-enricher.service.ts#L76)
  `enrichCatalogWithFormRequests(...)` para **todos** los providers.
  Express/Fastify/Nest contaminan métricas y warnings.

### P3 — Otros (sin bloquear S0..S7 pero mencionados)

- i18n con blobs idénticos a inglés (`4,5/10`).
- Docs/descriptions drift (`21 frameworks` vs comentarios a `12`).
- Corpus externo (precision/recall) inexistente.
- 5 frameworks de "Tier 1" pendientes (Axum/Echo/Chi/Starlette/Litestar/…).

Estos se registran para una propuesta posterior (`a00013+`).

## Principios rectores

1. **CI reproducible primero, features después.** S0 es gate de todo
   lo siguiente.
2. **El detector es una pieza de topología, no un string match.**
   Resolver globs reales, manifestos por workspace, evidencia por
   workspace.
3. **`scanRoot` (nombre sustituto del actual `frameworkSearchRoot`)
   se calcula una sola vez y se pasa como dato, no como convención
   por scanner.**
4. **`score ∈ [0, 1]` es un contrato, no una recomendación.**
   `withEvidence` clampa; los detectores ya no suman `Math.min`.
5. **Información incompleta pero cierta > información completa
   inventada.** Cero `useCredentialVariables` agresivo; cero auth
   global sobre login.
6. **`formRequest` deja de existir como nombre genérico.**
   `ValidationSource { provider, reference }`; cada provider registra
   su propio enriquecedor.
7. **`process.argv` no entra al core en runtime.** Sólo defaults en
   composition root para CLI.
8. **Cero regresiones.** Cada slice cierra con su test focal; `bun
   run validate` y CI remoto verde; `lint:proposals` sin drift;
   archives consistentes.

## Diseño

### S0 — CI reproducible + DoD de packaging

Materializa la decisión de `p00007` (consumir `mcp-vertex` por
checkout hermano o SHA pin) **dentro del workflow** y la aserción
"el plugin MCP NO entra en el tarball público".

**Diseño recomendado** (este plan NO lo fuerza: presenta opciones
y deja que el siguiente agente elija, aunque recomienda una).

Decisión técnica que tomar:

- **Opción A** — Workflow `validate.yml` (o uno nuevo
  `validate-mcp.yml`) **clona** `CartagoGit/mcp-vertex` en
  `../mcp-vertex`, fija a un SHA concreto del paquete
  `@mcp-vertex/core` (publicado en npm a `0.1.1`), y exporta
  `EXPOSTMAN_MCP_CORE_SHA`. Es la forma más fiel a cómo se invoca
  el plugin en local; consume una sola versión firme.
- **Opción B** — Desacoplar el plugin en un job de CI independiente
  (matriz `core_build × plugin_integration`); el producto principal
  no se acopla al checkout hermano. Requiere refactor de
  `tsconfig.cli.json` y de `tsconfig.contracts.json`.
- **Opción C** — Vendorizar **sólo** el `dist/` del plugin en un
  job nocturno, exponer como `tarball-interno` y referenciar desde
  una URL interna.

**La propuesta recomienda A**: usar un SHA compatible de
`@mcp-vertex/core` publicado (la auditoría externa confirma que
existe un `0.1.1`). El job sigue siendo "un solo repo", sólo añade
un sub-paso de checkout con clave. Si el equipo prefiere B/C, este
plan queda igual, basta sustituir el bloque S0.

**Aserción nueva para `validate-package`**: tras `npm pack`,
abrir el `.tgz` y Assert que `package/plugins/mcp-vertex_expostman/`
no está dentro. Hoy no se hace: el plugin es `"private": true`
pero el tarball incluye `packages/` y nada lo excluye
explícitamente.

### S1 — Topología, monorepo, raíz efectiva

Diseño:

- `IMonorepoDetection` se reemplaza por `IProjectTopology`:
  ```ts
  interface IProjectTopology {
    readonly workspaces: ReadonlyArray<IWorkspace>;
  }
  interface IWorkspace {
    readonly id: string;            // relativo POSIX
    readonly manifestPath: string;   // path al package.json / composer.json / go.mod / requirements.txt / pom.xml…
    readonly language: "ts"|"js"|"php"|"python"|"go"|"java"|"kotlin"|"cs"|"rust"|"ruby"|"elixir";
  }
  ```
- `resolveWorkspaceDirs` se sustituye por un **resolver de globs
  real** (`packages/core/discovery/workspace-glob.helper.ts`):
  - Soporte para `apps/*` con enumeración real (`apps/api`,
    `apps/web`).
  - Soporte para `packages/*` y mezclas (`apps/*`, `packages/*`).
  - Exclusiones (`!**/test/**`, `!**/dist/**`) compatibles con la
    sintaxis que usa pnpm.
  - Normalización POSIX (rechaza absolutos, `..`, escapes fuera de
    `projectRoot`).
  - Determinista: orden estable.
- `detectAll` se cambia a
  `detectAll(topology, perWorkspaceScanners)`:
  1. Detectar topología.
  2. Por cada workspace, resolver su lenguaje y cargar scanners.
  3. Puntuar por workspace.
  4. Ordenar por score.
- `IProjectMatch` añade `workspaceId: string | null` (nullable sólo
  cuando no es monorepo, y un test que lo demuestra).
- `IProjectMatch.frameworkSearchRoot` se **renombra** a `scanRoot`.
  Se calcula en un único punto
  (`packages/core/discovery/scan-root.helper.ts`) y se entrega al
  scanner **ya resuelto** como argumento.

### S2 — Score clamp + contract test

- `withEvidence(score, evidence)` se cambia a
  `withEvidence(rawScore, evidence)` y clampa a `[0, 1]`.
- `NaN` y `Infinity` se normalizan explícitamente (`NaN→0`,
  `Infinity→1`).
- Se elimina `Math.min(..., 1)` de Hono, Next, etc.
- Contract test nuevo
  ([`tests/frameworks/detect-result-clamp.spec.ts`](../../tests/frameworks/detect-result-clamp.spec.ts)):
  itera los **21 scanners** y Assert que
  `detect(...).score ∈ [0, 1]` y que `evidence` puede contener
  pesos fuera de rango aunque el score agregado esté limitado.

### S3 — Folder tree, auth por operación, login body, TRACE

- **Folder tree**:
  [`packages/core/domain/collection-builder.service.ts:249`](../../packages/core/domain/collection-builder.service.ts#L249):
  cambiar el cálculo de `mainKey` para que la rama `else` (subcarpeta
  explícita) **sí se alcance** y/o consolidar `subs`/`direct` en
  `buildFolders` para que `g.explicit === true && g.key !== autoMainKey`
  sea una entrada válida.
- **Auth por operación**: introducir
  `IEndpointSpec.auth?: AuthOverride` con `{ none: true } | {
  scheme: "bearer"|"apiKey"|... }`. `defaultHeaders()` sólo añade
  el header cuando el endpoint **no** trae override y el esquema
  global lo permite.
- **Login body**: `useCredentialVariables` se sustituye por
  `attachCredentialTemplate` que sólo parchea `body.X = {{var}}`
  cuando la clave X existe en el body real **y** su tipo coincide
  con string. Si no, deja el body original y emite un warning
  estructurado.
- **TRACE**: ampliar el union
  [`packages/contracts/interfaces/core/postman.interface.ts:125`](../../packages/contracts/interfaces/core/postman.interface.ts#L125)
  con `"TRACE"` y el catálogo
  [`packages/contracts/constants/core/postman.constant.ts:49`](../../packages/contracts/constants/core/postman.constant.ts#L49).
  Regenerar `docs/API.md`.

### S4 — Zero-config sin `/api`, process.argv eliminado

- `baseUrl` por defecto pasa a `origin` (sin `/api`).
- El prefijo `/api` sólo puede venir de:
  - **ruta explícita** (endpoint matcher lo vio);
  - **framework/router** (routePrefix/RouteServiceProvider-style
    collection);
  - **config explícito** (`mcp-vertex.config.json#basePath`,
    `.expostmanrc.json#basePath`);
  - **OpenAPI** (`servers[].url` cuando es absoluto).
- "Herencia de Laravel" documentada como legacy y aislada:
  [`packages/core/discovery/project-loader.service.ts:197`](../../packages/core/discovery/project-loader.service.ts#L197)
  sólo añade `/api` si `app.url()` o el config lo declara y el
  framework detectado es Laravel.
- `process.argv` deja de estar en defaults de runtime. Vuelve como
  constante que sólo usa el entry point CLI
  ([`packages/cli/cli.script.ts`](../../packages/cli/cli.script.ts)),
  no el core. Tests existentes (`tests/core/generation-pipeline.spec.ts`,
  `tests/e2e/concurrent-projects.test.ts`) deben pasar con
  `argv: process.argv.slice(2)` pasado explícito.

### S5 — Validación agnóstica (`ValidationSource`)

- `formRequest?: string` se reemplaza por
  `validationSource?: { provider: string; reference: string }`.
- `validationProvider: "api-router"|"json-schema"|"zod"|"joi"|"laravel-form-request"|...`
- `IValidationEnricher` registrado por provider; sólo el enricher
  Laravel procesa `provider === "laravel-form-request"`.
- `enrichCatalogWithFormRequests` se mueve a un fallback específico
  bajo `packages/frameworks/laravel/` que **sólo** corre cuando
  el framework detectado es Laravel.

### S6 — Hardening + corpus opcional

- Activar **branch protection** en `develop` con
  `required_status_checks = [validate]` y la regla de "no bypass
  manual". (No es código: es config de GitHub.)
- CI separado `validate-mcp.yml` que ejecuta S0 + suite de plugins
  con `bun.lock` regenerable.
- Crear `tests/core/validation-source-roundtrip.spec.ts` con un
  proyecto Express con `zod`, otro con `joi`, otro con Laravel
  FormRequest — Assert que cada uno pasa por su enricher y los
  demás se mantienen `null`.
- `tests/core/process-argv-free.spec.ts` Assert que
  `loadProject({ projectRoot })` no toca `process.argv`.

## Slices atómicos

Cada slice es independiente: con S0 cerrado, S1 se puede abrir en
paralelo con S3.1 (folder tree), S3.2 (auth/login) y S5
(validationSource). S2 y S4 cierran antes de S6. S7 es paper-only.

### S0 — CI reproducible

- **Archivos**:
  - [`.github/workflows/validate.yml`](../../.github/workflows/validate.yml) — checkout del repo hermano + fijar Bun a SHA.
  - ó nuevo workflow `validate-mcp.yml` que llame a `bun run
    validate` con `MCP_VERTEX_DIR=$(pwd)/../mcp-vertex`.
  - [`scripts/gates/validate-package.script.ts`](../../scripts/gates/validate-package.script.ts) — aserción de que el plugin no entra en el tarball.
- **Acceptance**:
  - `gh workflow run validate` desde un fork devuelve verde.
  - `validate:package` Assert `package/plugins/mcp-vertex_expostman/`
    ausente del `.tgz`.
  - Locales: `bun run validate:examples` y `bun run validate:package`
    siguen verdes.

### S1 — ProjectTopology + scanRoot universal

- **Archivos**:
  - `packages/contracts/interfaces/core/topology.interface.ts` (nuevo).
  - `packages/core/discovery/workspace-glob.helper.ts` (nuevo,
    sustituye `resolveWorkspaceDirs`).
  - `packages/core/discovery/scan-root.helper.ts` (nuevo).
  - `packages/core/discovery/discovery.orchestrator.ts` — firma
    `detectAll(topology?)`.
  - `packages/core/discovery/generation.pipeline.ts` — topología
    antes que detectores; `detectAll` por workspace; `scanRoot`
    central.
  - 21 scanners: cambian `match.projectRoot` por `effectiveScanRoot(match)`
    en su **primer** `collectFiles`. Hono/Next ya lo hacen.
- **Tests**:
  - `packages/core/discovery/workspace-glob.spec.ts` — `apps/*`,
    `packages/*`, exclusiones, mezclas, escapes.
  - `tests/frameworks/scan-root-contract.spec.ts` — los 21 scanners
    Assert `effectiveScanRoot` con un match forzado.
  - `tests/core/monorepo-before-detect.spec.ts` — proyecto Express
    sólo en `apps/api/package.json`, Assert `score > 0`.
- **Acceptance**: comportamiento determinista, paths contenidos en
  `projectRoot`, sin `/api` mágico del S4 (lo arregla S4).

### S2 — Score clamp

- **Archivos**:
  - `packages/frameworks/scanners/detect-result.helper.ts` —
    `withEvidence` clampa.
  - Se eliminan `Math.min(..., 1)` de Hono, Next y donde aparezcan.
- **Tests**:
  - `tests/frameworks/detect-result-clamp.spec.ts` (nuevo).
- **Acceptance**: contract test verde sobre los 21 detectores.

### S3 — Folder tree, auth/login, TRACE

- **Archivos**:
  - `packages/core/domain/collection-builder.service.ts` — carpeta
    explícita alcanza su rama.
  - `packages/core/domain/auth-flow.service.ts` — quitar
    `useCredentialVariables`; introducir `attachCredentialTemplate`.
  - `packages/contracts/interfaces/core/postman.interface.ts` —
    union incluye `"TRACE"`.
  - `packages/contracts/constants/core/postman.constant.ts` —
    añadir `"TRACE"`.
  - Regenerar `docs/API.md`.
- **Tests**:
  - `tests/core/collection-folder-tree.spec.ts` — árbol completo.
  - `tests/core/auth-public-endpoint.spec.ts` — login sin
    `Authorization`, `/health` sin auth.
  - `tests/core/login-body-preserve.spec.ts` — body no reconocido
    NO se reemplaza.
- **Acceptance**: snapshot del árbol + warnings estructurados.

### S4 — Zero-config sin `/api` + sin `process.argv`

- **Archivos**:
  - `packages/core/discovery/project-loader.service.ts` —
    `baseUrl` por defecto = `origin`; `/api` sólo si Laravel +
    config + framework-collected.
  - `packages/cli/commands/init.script.ts` (mismo).
  - `packages/core/domain/environment-builder.service.ts` (mismo).
  - `packages/core/domain/param-inferrer.service.ts` (mismo).
  - `packages/core/discovery/generation.pipeline.ts` —
    `loadProject` recibe `argv` explícito en composición root CLI.
- **Tests**:
  - `tests/core/zero-config-no-api.spec.ts` — Express/Flask/Gin/
    FastAPI sin `/api` por defecto.
  - `tests/core/process-argv-free.spec.ts` — `loadProject({})` no
    lee `process.argv`.
- **Acceptance**: la ruta `/api` sólo aparece cuando la aporta una
  de las 4 fuentes explícitas; suites e2e existentes siguen verdes
  en `examples/example-express`.

### S5 — Validación agnóstica

- **Archivos**:
  - `packages/contracts/interfaces/core/validation-source.interface.ts`
    (nuevo).
  - `packages/core/adapters/parsed-route-to-spec.adapter.ts` —
    sustituye `formRequest` por `validationSource`.
  - `packages/core/validation/validation-enricher.registry.ts`
    (nuevo) — registro de enriquecedores por provider.
  - `packages/frameworks/laravel/catalog-enricher.service.ts` se
    queda como enricher **Laravel-específico**, llamado sólo cuando
    `provider === "laravel-form-request"`.
- **Tests**:
  - `tests/core/validation-source-roundtrip.spec.ts` — Express + zod,
    Fastify + json-schema, Laravel + FormRequest.
- **Acceptance**: un proyecto Express NUNCA entra por
  `enrichCatalogWithFormRequests`.

### S6 — Branch protection + corpus opcional

- **No código** de aplicación. Sólo:
  - Configuración GitHub `protect develop` con `required_status_checks`.
  - Workflow paralelo `validate-mcp.yml` (opcional).
- **Acceptance**: una PR de prueba a `develop` requiere CI verde.

### S7 — Paper-only: propuesta siguiente

- Crear `docs/mcp-vertex/proposals/ready/a00013-universal-api-ir-y-language-frontends.md`
  borrador (no implementación) detallando:
  - `ApiOperation` con `request/responses/security/cookes/multipart`.
  - `ProjectTopology`/`ProjectGraph` completo.
  - Frontend semántico TypeScript con `ModuleGraph` + `SymbolGraph`.
  - Parse once + cache invalidation.
  - Corpus de proyectos reales con precision/recall KPI.

## Definition of done global

- [ ] `gh workflow run validate` verde en un fork limpio.
- [ ] `bun run validate` verde en local.
- [ ] `validate:package` Assert plugin NO en tarball.
- [ ] `tests/frameworks/scan-root-contract.spec.ts`: los 21 scanners
      Assert `effectiveScanRoot`.
- [ ] `tests/frameworks/detect-result-clamp.spec.ts`: los 21
      scanners Assert `score ∈ [0, 1]`.
- [ ] `tests/core/workspace-glob.spec.ts`: `apps/*` enumerado,
      exclusiones respetadas.
- [ ] `tests/core/collection-folder-tree.spec.ts`: árbol completo
      con subcarpetas explícitas.
- [ ] `tests/core/auth-public-endpoint.spec.ts`: login y
      `/health` sin `Authorization`.
- [ ] `tests/core/login-body-preserve.spec.ts`: cuerpo desconocido
      NO se sobreescribe.
- [ ] `tests/core/zero-config-no-api.spec.ts`: Express/Flask/Gin/
      FastAPI sin `/api` por defecto.
- [ ] `tests/core/process-argv-free.spec.ts`: `loadProject({})` no
      toca `argv` global.
- [ ] `tests/core/validation-source-roundtrip.spec.ts`: cada
      framework conocido pasa por su enricher.
- [ ] `lint:proposals` verde con `91 propuestas, sin drift`.
- [ ] Convención Conventional Commits en cada commit.
- [ ] `docs/mcp-vertex/proposals/INDEX.md` actualizado al cerrar
      cada slice.

## Riesgos

- **Cobertura de scanner**: cualquier cambio en una interfaz del
  `IProjectMatch` rompe los 21 scanners. Mitigación: hacer S1
  seguido de un contrato TypeScript fuerte y migrar scanner por
  scanner con `effectiveScanRoot` agnóstico.
- **CI paralelo**: dos agentes tocando el mismo workflow van a
  competir. Regla §4b del bootstrap universal: leer `git diff`,
  aceptar trabajo del otro agente, surgical follow-up.
- **Regresiones en ejemplos**: `examples/example-express`, `…-laravel`,
  `…-springboot` se usan como gate. Si S4 cambia baseUrl por
  defecto, las fixtures que asumen `/api` necesitan un test
  explícito.
- **`p00007` reabre**: si se publica `@mcp-vertex/core` durante
  S0, el SHA varía. Actualizar la propuesta de S0 el día que
  npm devuelva una versión real.

## Lo que NO entra en este plan

Registramos aquí explícitamente lo que se difiere, para evitar
reabrirlo por confusión:

- Universal API IR (`a00013+`).
- Frontends semánticos por lenguaje (TS ModuleGraph, PHP/Python/
  Go/Java/Kotlin/Ruby/Elixir).
- New frameworks (Axum, Echo, Chi, Starlette, Litestar, Elysia,
  AdonisJS, Nitro/H3, JAX-RS, Quarkus, Micronaut, Slim, Sinatra,
  …).
- WebSocket/SSE/AsyncAPI/SOAP.
- i18n con traducciones reales (sólo se documenta, no se
  implementa; queda en backlog).
- Corpus externo de precision/recall (S7 lo deja plantado; el
  corpus se construye cuando estén los slices S0–S5 verdes).

## Cómo se reabre / archiva

- S0: archivar sólo cuando CI remoto está verde y `validate:package`
  Assert plugin NO en tarball. Conventional Commit: `ci:` o
  `fix(workflow):`.
- S1: archivar sólo cuando `validate` local sigue verde y los 21
  scanners respetan `effectiveScanRoot`. Conventional: `refactor(core):`
  o `feat(core):`.
- S2: archivar con `fix(framework):`.
- S3: archivar con `fix(generation):` + `feat(postman):`.
- S4: archivar con `refactor(core):` + `feat(cli):`.
- S5: archivar con `refactor(contracts):`.
- S6: archivado sin commit (papel-only).

## Primer slice recomendado

**S0 — CI reproducible**. Es el único slice que el propio equipo
puede validar end-to-end sin asumir que un scanner caerá bien:
funciona o no funciona la mano del runner, sin semántica por
medio. Si S0 no cierra, ninguno de los S1..S5 puede reclamarse
de verdad verde — un test local aislado deja fuera docenas de
combinaciones de campos que CI sí vería.

Razón en una línea: **mientras el gate remoto esté rojo, cerrar
features es contabilidad, no ingeniería**.
