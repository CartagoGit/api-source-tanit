---
id: r00020
title: "Multi-lenguaje precision — ModuleResolver completo, LanguageIR foundation agnóstica, response inference expandida (4→10 inferrers)"
kind: refactor
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-09-07
dependencies:
  - a00019#phase-4-desktop-app
---

# r00020 — Multi-lenguaje precision — ModuleResolver completo, LanguageIR foundation agnóstica, response inference expandida (4→10 inferrers)

## Goal

Resolver las tres brechas de precisión multi-lenguaje que limitan el alcance real de Tanit: (1) `import-resolver.ts` solo entiende imports relativos + fallback `.ts/.tsx/.js/index.*` y rechaza bare specifiers — debe cubrir tsconfig `baseUrl`/`paths` (incluido `@/*`), `package.json` `"exports"`/`"imports"`, workspaces monorepo (npm/yarn/pnpm/bun), Windows drive letters (`C:\\...`) y UNC paths (`\\\\server\\share`); el fallback global de SymbolGraph que busca símbolos por nombre en todos los archivos queda detrás de un flag experimental; (2) introducir el contrato conceptual `ILanguageFrontend`/`ISymbol`/`ICallExpression`/`IDecorator` en `packages/contracts/interfaces/language-ir/` agnóstico del lenguaje concreto, y migrar el frontend TS existente para implementarlo (sin tocar core/scanners/frameworks) — esto prepara el terreno para tree-sitter-{python,php,go,java,csharp,ruby,elixir,rust} sin obligar a reescribir core; (3) expandir el barrel de `response-inference/` de 4 (Spring, NestJS, FastAPI, ASP.NET) a 10 inferrers (añade Fastify, Express, Laravel Resources, Gin, Rails render, Ktor call.respond) con fixtures y tests. Cierra el bloque (e) de [a00019](../../in-progress/a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo identificó tres limitaciones que separan Tanit de "analizar cualquier repo": (a) `import-resolver.ts` es POSIX-shaped — un proyecto con tsconfig `paths: { "@/*": ["src/*"] }` colapsa a "unresolved" en cada import, igual que un workspace monorepo de npm/pnpm/yarn; los bare specifiers (`lodash`, `@nestjs/core`) se rechazan sin intentar resolver desde `node_modules`; esto hace que la cobertura cross-file se degrade para cualquier proyecto que no sea el happy path; (b) el LanguageIR existe solo para TypeScript — Express, Fastify, Hono, NestJS consumen `extractRoutes()` pero un Python (FastAPI, Django, Flask), PHP (Laravel, Symfony), Go (Gin, Fiber), Java/Kotlin (Spring, Ktor), C# (ASP.NET), Ruby (Rails), Elixir (Phoenix), Rust (Actix/Rocket) requerirían reescribir `core/scanners/` si los seguimos atando a TS; el contrato agnóstico del lenguaje debe existir antes de que el segundo frontend entre; (c) `response-inference/registry.ts` solo registra 4 frameworks (Spring, NestJS, FastAPI, ASP.NET) — el resto de inferrers posibles están documentados pero no implementados: Fastify schema.response, Express res.json, Laravel Resources (JsonResource + ResourceCollection), Gin c.JSON, Rails render json, Ktor call.respond cubren ~80% de las APIs modernas y su inferencia multiplica la utilidad real de Tanit.

## non-goals

- Reescribir Tanit para que sea multi-lenguaje completo en este ciclo — la propuesta introduce el contrato y migra TS; los parsers tree-sitter reales para Python/PHP/Go/Java/C#/Ruby/Elixir/Rust entran en propuestas posteriores, uno por lenguaje.
- Migrar todos los scanners TS al nuevo contrato — solo el frontend TS se refactorea para implementar `ILanguageFrontend`; los consumidores del IR siguen usando el API actual (que ya es agnóstico de la implementación interna).
- Añadir parsers tree-sitter — solo se añade el contrato, no las dependencias npm de tree-sitter-* (esas entran con los frontends reales).
- Sustituir el barrel actual de `response-inference/` — los inferrers existentes se mantienen; se añaden 6 nuevos al registry sin romper compat.
- Quitar completamente el fallback "search by name globally" de SymbolGraph — se mueve detrás de un flag experimental (`symbolGraph.allowGlobalFallback: false` por default); cuando se quite del todo es trabajo de una propuesta posterior tras validar que ningún consumer lo necesita.

## Why this design

Cuatro principios guían esta propuesta — todos encaminados a que Tanit pueda "analizar cualquier repo" sin obligar a reescribir `core/scanners/` por cada nuevo lenguaje:

- **ModuleResolver completo > resolver POSIX-shaped**. Hoy `import-resolver.ts` rechaza todo lo que no sea relative + fallback `.ts/.tsx/.js/index.*`. Cubrir tsconfig `baseUrl`/`paths`, `package.json` `"exports"`/`"imports"`, workspaces monorepo y Windows drive letters/UNC no es un nice-to-have: es la diferencia entre "analizamos tu repo" y "tu repo no se puede analizar". El flag experimental `experimental.allowGlobalSymbolLookup` separa lo correcto del fallback histórico sin obligar a romper consumers en esta propuesta.
- **Contrato agnóstico > reescritura por lenguaje**. Crear `ILanguageFrontend`/`ISymbol`/`ICallExpression`/`IDecorator`/`ILocation` en `packages/contracts/interfaces/language-ir/` y migrar el frontend TS para implementarlo es la forma barata de preparar el terreno para tree-sitter-{python,php,go,java,csharp,ruby,elixir,rust} sin tocar `core/scanners/` ni `frameworks/`. Los lenguajes futuros se montan encima del IR sin reescribir el pipeline.
- **Discriminated union por inferrer > inferrer genérico**. El barrel actual (4 inferrers: Spring, NestJS, FastAPI, ASP.NET) se queda; añadir 6 más (Fastify, Express, Laravel Resources, Gin, Rails render, Ktor call.respond) cubre ~80% de las APIs modernas. Cada inferrer implementa `IResponseInferrer` con su propio handler shape-aware; el registry los compone declarativamente, sin un motor de reglas genérico que cubra el 60% y deje el resto ambiguo.
- **Refactor invisible para consumers del IR**. Los scanners actuales (`packages/core/scanners/`) y frameworks (`packages/frameworks/scanners/`) siguen emitiendo `ParsedRoute[]` neutro; el cambio ocurre entre la detection y el modelo universal. El grep por `@ts-ignore`/`ts.Node`/`babel` en el **código** de los consumidores del IR debe devolver cero resultados al cerrar S2, salvo en la **lista blanca** explícita del IR legacy de TypeScript (`packages/core/language-ir/` y `packages/core/discovery/host-config-parser.service.ts`), cuya migración es un no-goal de esta slice.

## Architecture

Tres transiciones pequenas, cada una con un DoD verificable:

1. **ModuleResolver como motor único de resolución de imports** (S1). `packages/core/module-resolution/` introduce `resolver.service.ts` con cinco helpers (`tsconfig-paths`, `package-exports`, `package-imports`, `workspace-resolver`, `platform-paths`), un `resolver-error.ts` con la unión discriminada `IResolverError` (códigos `NOT_FOUND`, `TSCONFIG_PATH_NOT_FOUND`, `EXPORTS_CONDITION_UNSATISFIED`, `WORKSPACE_MEMBER_NOT_FOUND`, `NOT_A_FILE`, `IO_ERROR`, `CYCLE`) y un contrato `IModuleResolver` en `packages/contracts/interfaces/core/module-resolution.interface.ts`. `import-resolver.ts` consume `ModuleResolver` y elimina su lógica POSIX-shaped; el fallback global de SymbolGraph queda detrás de `experimental.allowGlobalSymbolLookup: false` por default.
2. **LanguageIR agnóstico en `packages/contracts/interfaces/language-ir/`** (S2). Cinco interfaces (`ILanguageFrontend`, `ISymbol`, `ICallExpression`, `IDecorator`/`IAttribute`, `ILocation`) sin vocabulario TS-specific. El frontend TS existente (`packages/core/language-frontends/typescript/`) se refactorea para implementar `ILanguageFrontend`; los consumidores del IR siguen usando el API actual. `docs/LANGUAGE-IR.md` explica cómo un frontend Python (tree-sitter-python), PHP (tree-sitter-php) o Go (tree-sitter-go) se monta encima sin tocar `core/scanners/` ni `frameworks/`.
3. **Barrel de response-inference 4 → 10 inferrers** (S3). Los 4 actuales (Spring, NestJS, FastAPI, ASP.NET) se mantienen; se añaden 6 nuevos (`fastify`, `express`, `laravel-resources`, `gin`, `rails-render`, `ktor-respond`) con sus fixtures y tests. Cada inferrer implementa `IResponseInferrer` con un handler shape-aware; `coverage-reporter.ts` mide qué porcentaje de operaciones tiene inferencia exitosa por framework. Sin motor de reglas genérico — cada framework se modela por separado porque su modelo de salida es estructuralmente distinto.

### Dependency on `a00019#phase-4-desktop-app`

r00020 aterriza después de [phase-4-desktop-app](../../in-progress/a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md): la aplicación Angular Desktop consume `IProjectSnapshot` y el Application API de phase-3, y la introducción de nuevos inferrers + el cross-language IR no rompe contratos visibles del CLI/Desktop. La Desktop app tampoco necesita el cross-language IR para funcionar — el desktop usa el frontend TS — pero la separación arquitectónica exige que phase-5 aterrice después de phase-4 para mantener la linearidad del plan `a00019`. Esta dependencia se declara en el frontmatter (`dependencies: [a00019#phase-4-desktop-app]`) para que el orchestrator la respete al planificar; mientras phase-4-desktop-app no cierre, r00020 NO se aprueba.

### Files layout (resultado de S1)

```text
packages/contracts/interfaces/core/
  module-resolution.interface.ts                # IModuleResolver, IResolverError, ResolverErrorCode

packages/core/module-resolution/
  resolver.service.ts                            # ModuleResolver — entry point, composes helpers
  tsconfig-paths.helper.ts                       # tsconfig baseUrl + paths (incluido @/*)
  package-exports.helper.ts                      # package.json "exports" + conditions
  package-imports.helper.ts                      # package.json "imports" (#internal aliases)
  workspace-resolver.service.ts                  # npm/yarn/pnpm/bun workspaces
  platform-paths.helper.ts                       # Windows drive letters + UNC paths + .d.ts
  resolver-error.ts                              # discriminated IResolverError union

packages/frameworks/scanners/
  import-resolver.ts                             # consume ModuleResolver — drop POSIX-shaped logic
```

### Files layout (resultado de S2)

```text
packages/contracts/interfaces/language-ir/
  frontend.interface.ts                          # ILanguageFrontend
  symbol.interface.ts                            # ISymbol
  call.interface.ts                              # ICallExpression
  decorator.interface.ts                         # IDecorator / IAttribute
  location.interface.ts                          # ILocation
  index.ts                                       # barrel

packages/core/language-frontends/typescript/
  typescript-frontend.service.ts                 # implements ILanguageFrontend (TS existing logic)
  extract-routes-express.helper.ts               # moved here from core/scanners
  index.ts                                       # barrel
```

### Files layout (resultado de S3)

```text
packages/contracts/interfaces/core/
  response-inferrer.interface.ts                 # IResponseInferrer (contrato)

packages/core/response-inference/
  fastify.helper.ts                              # Fastify schema.response
  express.helper.ts                              # Express res.json / res.send inferrer
  laravel-resources.helper.ts                    # Laravel Resources (JsonResource + ResourceCollection)
  gin.helper.ts                                  # Gin c.JSON
  rails-render.helper.ts                         # Rails render json
  ktor-respond.helper.ts                         # Ktor call.respond
  registry.ts                                    # registry expandida (10 inferrers)
  coverage-reporter.ts                           # % operaciones con inferencia exitosa por framework
```

## Slices

- global_gate: e2e

### S1-module-resolver-complete — S1 — ModuleResolver completo: tsconfig paths, package exports/imports, workspaces, Windows paths
- **Status**: done
- **Files**: `packages/core/module-resolution/resolver.service.ts`, `packages/core/module-resolution/tsconfig-paths.helper.ts`, `packages/core/module-resolution/package-exports.helper.ts`, `packages/core/module-resolution/package-imports.helper.ts`, `packages/core/module-resolution/workspace-resolver.service.ts`, `packages/core/module-resolution/platform-paths.helper.ts`, `packages/core/module-resolution/resolver-error.ts`, `packages/contracts/interfaces/core/module-resolution.interface.ts`, `packages/frameworks/scanners/import-resolver.ts`, `tests/core/module-resolution.spec.ts`, `tests/fixtures/tsconfig-paths-monorepo/package.json`, `tests/fixtures/tsconfig-paths-monorepo/tsconfig.json`, `tests/fixtures/tsconfig-paths-monorepo/src/main.ts`, `tests/fixtures/tsconfig-paths-monorepo/src/users/users.controller.ts`, `tests/fixtures/tsconfig-paths-monorepo/packages/orders/package.json`, `tests/fixtures/tsconfig-paths-monorepo/packages/orders/src/main.ts`, `tests/fixtures/windows-paths-mock/package.json`, `tests/fixtures/windows-paths-mock/src/main.ts`, `tests/fixtures/windows-paths-mock/src/helper.ts`
- **Gate**: e2e
- acceptance:
  - "`ModuleResolver` entiende: tsconfig `baseUrl`, tsconfig `paths` (incluido `@/*`), `package.json` `"exports"` (campo + conditions `import`/`require`/`default`/`node`/`browser`), `package.json` `"imports"` (#internal aliases), workspaces monorepo (npm/yarn/pnpm/bun), node_modules hoisting, `.d.ts`, Windows drive letters (`C:\\...`), UNC paths (`\\\\server\\share`)"
  - "Bare specifiers (`lodash`, `@nestjs/core`) se resuelven correctamente desde `node_modules`; bare specifiers sin entry fallan con error estructurado `IResolverError { code: 'NOT_FOUND', specifier, searchPaths }` (no silent 'unresolved')"
  - "SymbolGraph.removeLegacyGlobalNameLookup activado por default — el fallback "buscar símbolo por nombre en todos los archivos" queda detrás de un flag `experimental.allowGlobalSymbolLookup: boolean` (default `false`); la opción se documenta en `docs/MODULE-RESOLUTION.md` con un caso de uso legítimo"
  - "`import-resolver.ts` consume `ModuleResolver` y elimina su lógica POSIX-shaped; verificación: tests que antes fallaban con paths absolutos ahora pasan en fixture `windows-paths-mock`"
  - "Fixtures `tests/fixtures/tsconfig-paths-monorepo/` (npm workspaces + tsconfig paths `@/*` + alias cross-package) y `tests/fixtures/windows-paths-mock/` (rutas con drive letters) con tests e2e cubriendo cada caso"
  - "Performance: resolver 1k imports < 100ms (warm cache); bench reproducible en `tests/core/module-resolution.bench.ts` con umbral duro"
  - "DoD slice: `bun run typecheck && bun run test:core && bun run validate:examples` verdes"
- review-state: done
- review-implementer: minimax-m3
- review-reviewer: minimax-m3.1-flash-preview
- review-log: approved by minimax-m3.1-flash-preview — Implementación real de r00019/S1 (commits c892f76, ffbb5f0, e967ea2; PR #29, merge d30b85e). Segunda revisión (el primer veredicto fue changes-requested) tras corregir los 5 hallazgos: el bench `tests/core/module-resolution.bench.ts` ahora está cableado a `bun run bench:module-resolution` y encadenado en `validate` y en el job `bench-check` de CI (H1); un fixture con `exports: {".":"./index.js"}` **y** un `private.js` real en disco fija que un subpath no exportado da NOT_FOUND, y el test falla si se reintroduce el fallback (H2); `subpath` se rellena en el resultado y se elimina el código de error `UNSUPPORTED` que nadie producia (H3); un target `null` en `exports` **bloquea** la resolución como en Node — verificado contra Node v24.16.0, no de memoria — y la misma regla se aplica al campo `imports` (H4); tabuladores normalizados a 2 espacios (H5). Gates: `bun run validate` exit 0 (267 ficheros / 4058 tests, baseline de cobertura congelado cumplido), typecheck 6/6, lint exit 0, `test:core` 1402, `validate:examples` 25/25. Bench: 1000 imports → cold 43.62 ms, warm 0.51 ms (presupuesto 100 ms), 1000/1000 resueltos, con salida por exit 1 si resuelve menos. Mutaciones de la revisión (10): 9 detectadas; la 10ta (fallback al índice del paquete para un subpath no exportado) NO la detectaba el spec shipped, y por eso se añadió el fixture de H2. Regresión: `resolveImportPath` no tiene consumidor de producción (0 hits fuera de su módulo) y los 5 specs preexistentes modificados endurecen o actualizan la expectativa, no tapan regresiones. Desviaciones: `packages/frameworks/scanners/import-resolver.ts` de la lista no existe (el resolver real estaba en `packages/core/discovery/import-resolver.ts`); `resolver-error.ts` → `resolver-error.helper.ts` por el sufijo que admite el gate; `docs/API.md` regenerado por `bun run docs:api` (lo exige `lint:api`). Veredicto previo (consolidacion documental phase-5): approved by delivery-verifier — ModuleResolver completo, LanguageIR agnóstico, response inference 4→10 inferrers, dependencias declaradas con a00019 phase-4.
### S2-LanguageIR-agnostic-frontend — S2 — LanguageIR agnóstico del lenguaje: contrato conceptual + migración TS
- **Status**: pending
- **DependsOn**: [S1-module-resolver-complete]
- **Files**: `packages/contracts/interfaces/language-ir/frontend.interface.ts`, `packages/contracts/interfaces/language-ir/symbol.interface.ts`, `packages/contracts/interfaces/language-ir/call.interface.ts`, `packages/contracts/interfaces/language-ir/decorator.interface.ts`, `packages/contracts/interfaces/language-ir/location.interface.ts`, `packages/contracts/interfaces/language-ir/index.ts`, `packages/core/language-frontends/typescript/typescript-frontend.service.ts`, `packages/core/language-frontends/typescript/extract-routes-express.helper.ts`, `packages/core/language-frontends/typescript/index.ts`, `docs/LANGUAGE-IR.md`, `tests/contracts/language-ir-shape.spec.ts`, `tests/core/typescript-frontend-shape.spec.ts`
- **Gate**: type
- acceptance:
  - "`packages/contracts/interfaces/language-ir/` expone 5 interfaces agnósticas: `ILanguageFrontend { languageId, parse, extractSymbols, extractCalls, extractDecorators }`, `ISymbol`, `ICallExpression`, `IDecorator`/`IAttribute`, `ILocation` — ninguna contiene vocablos TS-specific (no `ts.Node`, no `Babel.types`, etc.)"
  - "El frontend TS existente (`packages/core/language-frontends/typescript/`) implementa `ILanguageFrontend` — refactor invisible para los consumidores del IR actual"
  - "Verificación: ningún consumer del IR usa implementaciones TS-specific directamente; el grep por `@ts-ignore`, `ts.Node`, `babel` en el **código** de `packages/frameworks/scanners/`, `packages/frameworks/laravel/`, `packages/core/language-ir/` y `packages/core/discovery/` no devuelve resultados **fuera de la lista blanca** (`packages/core/language-ir/` y `packages/core/discovery/host-config-parser.service.ts` — el IR legacy de TypeScript, cuya migración al contrato agnóstico es un **no-goal explícito** de esta slice y está planificada para una propuesta posterior). La *prosa* de un scanner puede nombrar el parser que hay detrás; el código no"
  - "`docs/LANGUAGE-IR.md` explica cómo un frontend Python (tree-sitter-python), PHP (tree-sitter-php), Go (tree-sitter-go) o Java (tree-sitter-java) se monta encima sin tocar `core/scanners/` ni `frameworks/` — incluye un `ILanguageFrontend` mínimo de referencia"
  - "Tests: `tests/contracts/language-ir-shape.spec.ts` valida que el IR TS cumple las 5 interfaces; los lenguajes futuros no rompen el shape cuando se añadan; `tests/core/typescript-frontend-shape.spec.ts` valida que el frontend TS implementado cumple el contrato"
  - "DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core` verdes; ningún consumer del IR queda roto"

### S3-response-inference-expansion — S3 — Response inference expandida: Fastify, Express, Laravel Resources, Gin, Rails, Ktor (4→10 inferrers)
- **Status**: done
- **DependsOn**: [S2-LanguageIR-agnostic-frontend]
- **Files**: `packages/core/response-inference/fastify.helper.ts`, `packages/core/response-inference/express.helper.ts`, `packages/core/response-inference/laravel-resources.helper.ts`, `packages/core/response-inference/gin.helper.ts`, `packages/core/response-inference/rails-render.helper.ts`, `packages/core/response-inference/ktor-respond.helper.ts`, `packages/core/responses/registry.ts`, `packages/core/responses/coverage-reporter.ts`, `packages/core/helpers/route-anchor.helper.ts`, `packages/core/responses/infer-responses.ts`, `packages/core/discovery/generation.pipeline.ts`, `packages/contracts/interfaces/core/response-inferrer.interface.ts`, `packages/contracts/interfaces/core/response-coverage.interface.ts`, `packages/contracts/interfaces/core/infer-responses.interface.ts`, `packages/contracts/constants/core/response-inference.constant.ts`, `tests/response-inference/fastify.spec.ts`, `tests/response-inference/express.spec.ts`, `tests/response-inference/laravel-resources.spec.ts`, `tests/response-inference/gin.spec.ts`, `tests/response-inference/rails-render.spec.ts`, `tests/response-inference/ktor-respond.spec.ts`, `tests/response-inference/registry.spec.ts`, `tests/response-inference/coverage.spec.ts`, `tests/helpers/response-inference-routes.helper.ts`, `tests/frameworks/response-inference-routes.spec.ts`, `tests/fixtures/fastify-responses/package.json`, `tests/fixtures/fastify-responses/src/server.ts`, `tests/fixtures/express-responses/package.json`, `tests/fixtures/express-responses/src/app.ts`, `tests/fixtures/laravel-resources/composer.json`, `tests/fixtures/laravel-resources/routes/api.php`, `tests/fixtures/laravel-resources/app/Http/Controllers/UserController.php`, `tests/fixtures/laravel-resources/app/Http/Controllers/OrderController.php`, `tests/fixtures/laravel-resources/app/Http/Resources/UserResource.php`, `tests/fixtures/gin-responses/go.mod`, `tests/fixtures/gin-responses/main.go`, `tests/fixtures/rails-render/Gemfile`, `tests/fixtures/rails-render/config/routes.rb`, `tests/fixtures/rails-render/app/controllers/users_controller.rb`, `tests/fixtures/rails-render/app/controllers/api/users_controller.rb`, `tests/fixtures/ktor-responses/build.gradle.kts`, `tests/fixtures/ktor-responses/src/main.kt`, `docs/RESPONSE-INFERENCE.md`
- **Gate**: e2e
- acceptance:
  - "`IResponseInferrer` es interface agnóstica con `detect(framework, route): boolean` + `infer(route, ctx): IResponseSpec | null`; cada inferrer la implementa por separado sin motor genérico"
  - "Los 6 inferrers nuevos (Fastify, Express, Laravel Resources, Gin, Rails render, Ktor call.respond) pasan tests `tests/response-inference/<inferrer>.spec.ts` con fixtures reales (`tests/fixtures/<framework>-responses/`)"
  - "`registry.ts` lista los 10 inferrers con union exhaustivo tipo `EXPORTER_IDS`; `selectInferrer(framework): IResponseInferrer` helper"
  - "`coverage-reporter.ts` mide % operaciones con inferencia exitosa por framework — se ejecuta al final del pipeline y se loggea como diagnostic (no blocking); baseline documentada"
  - "DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core && bun run validate:examples` verdes; ningún inferrer existente se rompe; los 6 nuevos están listos para usarse"
- review-implementer: minimax-m3
- review-reviewer: minimax-m3.1-flash-preview
- review-state: done
- review-log: approved by minimax-m3.1-flash-preview — Implementación real de r00020/S3 (commits 15b6091 y 1754599; PR #35, merge 3d7496f). Segunda revisión (el primer veredicto fue changes-requested con 4 hallazgos) tras corregir los 4: (H1) Rails ya no atribuye la respuesta de la acción equivocada — con `actionName` vacío sólo responde un controlador que declara **un solo** método y, con varios, devuelve `null` (`rails-render.helper.ts:383 resolveAction`); (H2) Gin ancla las rutas declaradas sobre un grupo — `ROUTE_PATTERN` acepta cualquier identificador (`gin.helper.ts:68`), el fixture incorpora `v1 := r.Group("/api/v1")` con 3 rutas y la baseline baja de `gin: 100` a `gin: 85.7` **medida** (7 rutas en el fixture, 7 reportadas por el scanner, 6 de 7 contestan; la que no, `c.JSON(200, []gin.H{})`, no tiene campo que probar); (H3) Laravel aplica la misma regla que Rails (`laravel-resources.helper.ts:384`); (H4) el contrato `IResponseInferrer` se alineó con la implementación — `detect(framework, route, ctx)` con el contexto en la firma (`response-inferrer.interface.ts:211`), el contexto se construye una vez y se pasa a las dos preguntas (`infer-responses.ts:170-189`), los 6 inferrers implementan el criterio y el adaptador legacy queda documentado como el que responde sólo la pregunta de framework (`registry.ts:264`), con un test nuevo `tests/response-inference/detect.spec.ts` (14 tests) que ata el invariante "una ruta que no se detecta nunca se infiere". Criterios A1-A5 (contrato agnóstico sin vocabulario de framework, 6 inferrers con fixtures reales, registry con union exhaustivo y `selectInferrer`, `coverage-reporter` por framework como diagnóstico no bloqueante con baseline documentada, y DoD) — todos OK. Gates: `bun run validate` exit 0 (281 ficheros / 4322 tests, baseline de cobertura congelado cumplido), typecheck 6/6, lint exit 0, `test:core` 1581, `validate:examples` 25/25. Mutaciones de la revisión: 5 (Rails vuelve al primer método, Gin vuelve a la lista fija de receptores, Laravel vuelve al primer método, los 6 `detect` sólo comprueban el framework, y el adaptador legacy) — las 4 primeras detectadas con 2, 5, 1 y 6 tests fallando respectivamente; la quinta (adaptador legacy) NO la detectaba ningún test y queda declarada como texto de contrato sin cobertura. Verificado que los 6 inferrers son específicos de su framework: una matriz 6×6 contra los 6 fixtures da que cada uno responde sólo en el suyo y `null` en los otros 5 — no son regex genéricas. Pendientes declarados, no bloqueantes: (a) el emparejamiento spec↔ruta de `inferResponsesIntoSpecs` es literal (`${method} ${uri}`) y no empareja `/api/v1/users/:id` con `/api/v1/users/{id}`, así que el pipeline saca 5/10 en el ejemplo de Gin donde el inferrer sí acierta 8/10 — es un defecto del emparejamiento, anterior a esta slice; (b) `c.JSON(200, []gin.H{{"id": 1}})` se responde como objeto y no como array (`schemaOfPayload` ve el `{` interior); (c) si el mismo path se declara en dos niveles, `pickRouteAnchor` no puede distinguirlos porque el scanner de Gin reporta `lineNumber: 0`.
- implementation-notes: |
  - **Rutas reales, no las del plan.** Los 4 inferrers que ya existían viven en `packages/frameworks/scanners/<framework>.response-inferrer.ts` (no hay `packages/core/response-inference/` en el repo antes de esta slice) y **no se mueven**: el núcleo no puede importar `packages/frameworks/` (`lint:boundaries`), así que el registry de `packages/core/responses/registry.ts` los **adapta** al contrato agnóstico con `adaptLegacyResponseInferrer()`. Los 6 nuevos sí viven en `packages/core/response-inference/`, junto al núcleo.
  - **Los 4 inferrers legacy sí se tocaron — pero sólo en el nombre del tipo.** En cada uno (`spring`, `nestjs`, `fastapi`, `aspnet`) el contrato que implementan se renombró de `IResponseInferrer` a `ILegacyResponseInferrer`: 2 líneas por fichero (el `import` del tipo y el `implements` de la clase), porque `IResponseInferrer` pasó a designar el contrato agnóstico nuevo de `response-inferrer.interface.ts`. **El cuerpo de los cuatro no cambió**: ni una línea de la lógica que extrae respuestas, ni los patrones, ni las razones, ni el framework que declaran. La versión anterior de esta nota decía «no se tocan», y era cierta en cuanto al **comportamiento** pero falsa en cuanto a las **líneas**: se renombró el tipo y nada más.
  - **`registry.ts` y `coverage-reporter.ts` están en `packages/core/responses/`, no en `packages/core/response-inference/`.** El plan los ponía en la segunda carpeta, pero `lint:naming` sólo admite `.service.ts`/`.pipeline.ts`/`.orchestrator.ts`/`.adapter.ts`/`.helper.ts` bajo `packages/core/`, y `packages/core/responses/` es la única carpeta con una regla propia que admite un `.ts` suelto. Como el slice no puede tocar `lint:naming`, los dos ficheros van donde el gate los acepta.
  - **Rails y Laravel declaran las rutas en un fichero y las respuestas en otro.** Su inferrer lee el controlador con `ctx.readSource`, un resolver que el dispatcher posee (`IResponseInferContext.readSource`, opcional). El inferrer sigue siendo una función pura del texto que lee.
  - **La cobertura se mide sobre las rutas que el scanner reporta**, y esas rutas están escritas en `tests/helpers/response-inference-routes.helper.ts` para que la medición sea reproducible sin un scanner en el bucle. `tests/frameworks/response-inference-routes.spec.ts` corre cada scanner sobre su fixture y falla si deja de reportarlas.
  - **Baseline documentada** en `packages/contracts/constants/core/response-inference.constant.ts` (`RESPONSE_INFERENCE_COVERAGE_BASELINE` + `RESPONSE_INFERENCE_REFERENCE_FIXTURES`) y en `docs/RESPONSE-INFERENCE.md`. De los 4 inferrers anteriores, sólo NestJS tiene fixture de respuestas propio (`tests/fixtures/nestjs-response-inference/`): su baseline es `100` y lo mide `tests/response-inference/coverage.spec.ts` a través del adaptador del producto (`adaptLegacyResponseInferrer`), de modo que lo que se pina es lo que el dispatcher ejecuta. Los otros 3 no tienen fixture: su baseline es `null` y el reporter imprime su número sin opinar.

## acceptance

- `ModuleResolver` entiende: tsconfig `baseUrl`, tsconfig `paths` (incluido `@/*`), `package.json` `"exports"` (campo + conditions `import`/`require`/`default`/`node`/`browser`), `package.json` `"imports"` (#internal aliases), workspaces monorepo (npm/yarn/pnpm/bun), node_modules hoisting, `.d.ts`, Windows drive letters (`C:\\...`), UNC paths (`\\\\server\\share`)
- Bare specifiers (`lodash`, `@nestjs/core`) se resuelven correctamente desde `node_modules`; bare specifiers sin entry fallan con error estructurado `IResolverError { code: 'NOT_FOUND', specifier, searchPaths }` (no silent 'unresolved')
- SymbolGraph.removeLegacyGlobalNameLookup activado por default — el fallback "buscar símbolo por nombre en todos los archivos" queda detrás de un flag `experimental.allowGlobalSymbolLookup: boolean` (default `false`); la opción se documenta en `docs/MODULE-RESOLUTION.md` con un caso de uso legítimo
- `import-resolver.ts` consume `ModuleResolver` y elimina su lógica POSIX-shaped; verificación: tests que antes fallaban con paths absolutos ahora pasan en fixture `windows-paths-mock`
- Fixtures `tests/fixtures/tsconfig-paths-monorepo/` (npm workspaces + tsconfig paths `@/*` + alias cross-package) y `tests/fixtures/windows-paths-mock/` (rutas con drive letters) con tests e2e cubriendo cada caso
- Performance: resolver 1k imports < 100ms (warm cache); bench reproducible en `tests/core/module-resolution.bench.ts` con umbral duro
- DoD slice: `bun run typecheck && bun run test:core && bun run validate:examples` verdes
- `packages/contracts/interfaces/language-ir/` expone 5 interfaces agnósticas: `ILanguageFrontend { languageId, parse, extractSymbols, extractCalls, extractDecorators }`, `ISymbol`, `ICallExpression`, `IDecorator`/`IAttribute`, `ILocation` — ninguna contiene vocablos TS-specific (no `ts.Node`, no `Babel.types`, etc.)
- El frontend TS existente (`packages/core/language-frontends/typescript/`) implementa `ILanguageFrontend` — refactor invisible para los consumidores del IR actual
- Verificación: ningún consumer del IR usa implementaciones TS-specific directamente; el grep por `@ts-ignore`, `ts.Node`, `babel` en el **código** de `packages/frameworks/scanners/`, `packages/frameworks/laravel/`, `packages/core/language-ir/` y `packages/core/discovery/` no devuelve resultados **fuera de la lista blanca** (`packages/core/language-ir/` y `packages/core/discovery/host-config-parser.service.ts` — el IR legacy de TypeScript, cuya migración al contrato agnóstico es un **no-goal explícito** de esta slice y está planificada para una propuesta posterior). La *prosa* de un scanner puede nombrar el parser que hay detrás; el código no
- `docs/LANGUAGE-IR.md` explica cómo un frontend Python (tree-sitter-python), PHP (tree-sitter-php), Go (tree-sitter-go) o Java (tree-sitter-java) se monta encima sin tocar `core/scanners/` ni `frameworks/` — incluye un `ILanguageFrontend` mínimo de referencia
- Tests: `tests/contracts/language-ir-shape.spec.ts` valida que el IR TS cumple las 5 interfaces; los lenguajes futuros no rompen el shape cuando se añadan; `tests/core/typescript-frontend-shape.spec.ts` valida que el frontend TS implementado cumple el contrato
- DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core` verdes; ningún consumer del IR queda roto
- `IResponseInferrer` es interface agnóstica con `detect(framework, route): boolean` + `infer(route, ctx): IResponseSpec | null`; cada inferrer la implementa por separado sin motor genérico
- Los 6 inferrers nuevos (Fastify, Express, Laravel Resources, Gin, Rails render, Ktor call.respond) pasan tests `tests/response-inference/<inferrer>.spec.ts` con fixtures reales (`tests/fixtures/<framework>-responses/`)
- `registry.ts` lista los 10 inferrers con union exhaustivo tipo `EXPORTER_IDS`; `selectInferrer(framework): IResponseInferrer` helper
- `coverage-reporter.ts` mide % operaciones con inferencia exitosa por framework — se ejecuta al final del pipeline y se loggea como diagnostic (no blocking); baseline documentada
- DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core && bun run validate:examples` verdes; ningún inferrer existente se rompe; los 6 nuevos están listos para usarse
- Validación post-cambio: `bun run lint:proposals:gen-index` produce `INDEX.md` byte-idéntico al committed (sin diff); r00020 sigue en `ready/refactors/` y no se mueve a `done/` hasta que `a00019#phase-4-desktop-app` cierre (ver `dependencies:` en frontmatter)

## Risks

- **Cross-proposal link roto a a00019**. El `[a00019](./a00019-...)` desde `ready/refactors/` apunta a `ready/refactors/a00019-...` (no existe); la ruta correcta es `../../in-progress/a00019-...`. Mismo patrón que r00019 (que lo documenta en sus Risks) y que f00016 (que lo corrigió pero a `../audits/` que tampoco existe). f00017 usa `../in-progress/` que sí resuelve. r00020 se alinea con el patrón de f00017.
- **`SymbolGraph.removeLegacyGlobalNameLookup` rompe consumers que dependen del fallback**. S1 mueve el fallback "buscar símbolo por nombre en todos los archivos" detrás de `experimental.allowGlobalSymbolLookup: false`. Si algún consumer (scanner, framework adapter) lo necesita, queda desactivado silenciosamente. Mitigación: el flag experimental se loggea como warning en el primer uso; la propuesta que retire el flag del todo es posterior, una vez verificado que 0 consumers lo necesitan.
- **Frontend TS no migrado = contratos `ILanguageFrontend` no cumplidos**. Si S2 entrega las 5 interfaces pero el frontend TS no las implementa realmente, el shape está mintiendo y el typecheck pasa pero el runtime falla. Mitigación: `tests/contracts/language-ir-shape.spec.ts` y `tests/core/typescript-frontend-shape.spec.ts` validan que el frontend TS cumple el contrato en compile-time + runtime; el grep por `@ts-ignore`, `ts.Node`, `babel` fuera del frontend TS debe devolver 0 resultados.
- **Cobertura real de los 6 inferrers nuevos**. S3 añade 6 inferrers (Fastify, Express, Laravel Resources, Gin, Rails render, Ktor call.respond). El `coverage-reporter.ts` mide el % de operaciones con inferencia exitosa, pero solo se ejecuta al final del pipeline — no es un DoD por inferrer. Mitigación: cada inferrer viene con al menos 3 fixtures (`tests/fixtures/<framework>-responses/`) que cubren happy path + edge cases (empty schema, polymorphic resources, streaming responses).
- **Linearidad del plan `a00019`**. La dependencia declarada (`a00019#phase-4-desktop-app`) exige que phase-4 cierre antes de r00020. Si phase-4 se retrasa (es la fase más grande del plan), r00020 queda en cola. Esto es esperable y correcto: la Desktop app no consume los nuevos inferrers ni el cross-language IR hoy, pero el orden garantiza que los contratos visibles (Application API, snapshot shape) no cambian entre fase 4 y fase 5.
