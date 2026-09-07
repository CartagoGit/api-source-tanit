---
id: r00020
title: "Multi-lenguaje precision — ModuleResolver completo, LanguageIR foundation agnóstica, response inference expandida (4→10 inferrers)"
kind: refactor
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
---

# r00020 — Multi-lenguaje precision — ModuleResolver completo, LanguageIR foundation agnóstica, response inference expandida (4→10 inferrers)

## Goal

Resolver las tres brechas de precisión multi-lenguaje que limitan el alcance real de Tanit: (1) `import-resolver.ts` solo entiende imports relativos + fallback `.ts/.tsx/.js/index.*` y rechaza bare specifiers — debe cubrir tsconfig `baseUrl`/`paths` (incluido `@/*`), `package.json` `"exports"`/`"imports"`, workspaces monorepo (npm/yarn/pnpm/bun), Windows drive letters (`C:\\...`) y UNC paths (`\\\\server\\share`); el fallback global de SymbolGraph que busca símbolos por nombre en todos los archivos queda detrás de un flag experimental; (2) introducir el contrato conceptual `ILanguageFrontend`/`ISymbol`/`ICallExpression`/`IDecorator` en `packages/contracts/interfaces/language-ir/` agnóstico del lenguaje concreto, y migrar el frontend TS existente para implementarlo (sin tocar core/scanners/frameworks) — esto prepara el terreno para tree-sitter-{python,php,go,java,csharp,ruby,elixir,rust} sin obligar a reescribir core; (3) expandir el barrel de `response-inference/` de 4 (Spring, NestJS, FastAPI, ASP.NET) a 10 inferrers (añade Fastify, Express, Laravel Resources, Gin, Rails render, Ktor call.respond) con fixtures y tests. Cierra el bloque (e) de [a00019](./a00019-auditoria-2026-09-07-consolidacion-post-158-propuestas-y-plan-de-productizacion-tanit.md).

## why

El agente externo identificó tres limitaciones que separan Tanit de "analizar cualquier repo": (a) `import-resolver.ts` es POSIX-shaped — un proyecto con tsconfig `paths: { "@/*": ["src/*"] }` colapsa a "unresolved" en cada import, igual que un workspace monorepo de npm/pnpm/yarn; los bare specifiers (`lodash`, `@nestjs/core`) se rechazan sin intentar resolver desde `node_modules`; esto hace que la cobertura cross-file se degrade para cualquier proyecto que no sea el happy path; (b) el LanguageIR existe solo para TypeScript — Express, Fastify, Hono, NestJS consumen `extractRoutes()` pero un Python (FastAPI, Django, Flask), PHP (Laravel, Symfony), Go (Gin, Fiber), Java/Kotlin (Spring, Ktor), C# (ASP.NET), Ruby (Rails), Elixir (Phoenix), Rust (Actix/Rocket) requerirían reescribir `core/scanners/` si los seguimos atando a TS; el contrato agnóstico del lenguaje debe existir antes de que el segundo frontend entre; (c) `response-inference/registry.ts` solo registra 4 frameworks (Spring, NestJS, FastAPI, ASP.NET) — el resto de inferrers posibles están documentados pero no implementados: Fastify schema.response, Express res.json, Laravel Resources (JsonResource + ResourceCollection), Gin c.JSON, Rails render json, Ktor call.respond cubren ~80% de las APIs modernas y su inferencia multiplica la utilidad real de Tanit.

## non-goals

- Reescribir Tanit para que sea multi-lenguaje completo en este ciclo — la propuesta introduce el contrato y migra TS; los parsers tree-sitter reales para Python/PHP/Go/Java/C#/Ruby/Elixir/Rust entran en propuestas posteriores, uno por lenguaje.
- Migrar todos los scanners TS al nuevo contrato — solo el frontend TS se refactorea para implementar `ILanguageFrontend`; los consumidores del IR siguen usando el API actual (que ya es agnóstico de la implementación interna).
- Añadir parsers tree-sitter — solo se añade el contrato, no las dependencias npm de tree-sitter-* (esas entran con los frontends reales).
- Sustituir el barrel actual de `response-inference/` — los inferrers existentes se mantienen; se añaden 6 nuevos al registry sin romper compat.
- Quitar completamente el fallback "search by name globally" de SymbolGraph — se mueve detrás de un flag experimental (`symbolGraph.allowGlobalFallback: false` por default); cuando se quite del todo es trabajo de una propuesta posterior tras validar que ningún consumer lo necesita.

## Slices

- global_gate: e2e

### S1-module-resolver-complete — S1 — ModuleResolver completo: tsconfig paths, package exports/imports, workspaces, Windows paths
- **Status**: pending
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

### S2-LanguageIR-agnostic-frontend — S2 — LanguageIR agnóstico del lenguaje: contrato conceptual + migración TS
- **Status**: pending
- **Files**: `packages/contracts/interfaces/language-ir/frontend.interface.ts`, `packages/contracts/interfaces/language-ir/symbol.interface.ts`, `packages/contracts/interfaces/language-ir/call.interface.ts`, `packages/contracts/interfaces/language-ir/decorator.interface.ts`, `packages/contracts/interfaces/language-ir/location.interface.ts`, `packages/contracts/interfaces/language-ir/index.ts`, `packages/core/language-frontends/typescript/typescript-frontend.service.ts`, `packages/core/language-frontends/typescript/extract-routes-express.helper.ts`, `packages/core/language-frontends/typescript/index.ts`, `docs/LANGUAGE-IR.md`, `tests/contracts/language-ir-shape.spec.ts`, `tests/core/typescript-frontend-shape.spec.ts`
- **Gate**: type
- acceptance:
  - "`packages/contracts/interfaces/language-ir/` expone 5 interfaces agnósticas: `ILanguageFrontend { languageId, parse, extractSymbols, extractCalls, extractDecorators }`, `ISymbol`, `ICallExpression`, `IDecorator`/`IAttribute`, `ILocation` — ninguna contiene vocablos TS-specific (no `ts.Node`, no `Babel.types`, etc.)"
  - "El frontend TS existente (`packages/core/language-frontends/typescript/`) implementa `ILanguageFrontend` — refactor invisible para los consumidores del IR actual"
  - "Verificación: ningún consumer del IR usa implementaciones TS-specific directamente; el grep por `@ts-ignore`, `ts.Node`, `babel` en `packages/core/scanners/` y `packages/frameworks/scanners/` no devuelve resultados fuera del frontend TS"
  - "`docs/LANGUAGE-IR.md` explica cómo un frontend Python (tree-sitter-python), PHP (tree-sitter-php), Go (tree-sitter-go) o Java (tree-sitter-java) se monta encima sin tocar `core/scanners/` ni `frameworks/` — incluye un `ILanguageFrontend` mínimo de referencia"
  - "Tests: `tests/contracts/language-ir-shape.spec.ts` valida que el IR TS cumple las 5 interfaces; los lenguajes futuros no rompen el shape cuando se añadan; `tests/core/typescript-frontend-shape.spec.ts` valida que el frontend TS implementado cumple el contrato"
  - "DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core` verdes; ningún consumer del IR queda roto"

### S3-response-inference-expansion — S3 — Response inference expandida: Fastify, Express, Laravel Resources, Gin, Rails, Ktor (4→10 inferrers)
- **Status**: pending
- **Files**: `packages/core/response-inference/fastify.helper.ts`, `packages/core/response-inference/express.helper.ts`, `packages/core/response-inference/laravel-resources.helper.ts`, `packages/core/response-inference/gin.helper.ts`, `packages/core/response-inference/rails-render.helper.ts`, `packages/core/response-inference/ktor-respond.helper.ts`, `packages/contracts/interfaces/core/response-inferrer.interface.ts`, `packages/core/response-inference/registry.ts`, `packages/core/response-inference/coverage-reporter.ts`, `tests/response-inference/fastify.spec.ts`, `tests/response-inference/express.spec.ts`, `tests/response-inference/laravel-resources.spec.ts`, `tests/response-inference/gin.spec.ts`, `tests/response-inference/rails-render.spec.ts`, `tests/response-inference/ktor-respond.spec.ts`, `tests/response-inference/coverage.spec.ts`, `tests/fixtures/fastify-responses/package.json`, `tests/fixtures/fastify-responses/src/server.ts`, `tests/fixtures/express-responses/package.json`, `tests/fixtures/express-responses/src/app.ts`, `tests/fixtures/laravel-resources/composer.json`, `tests/fixtures/laravel-resources/app/Http/Resources/UserResource.php`, `tests/fixtures/laravel-resources/app/Http/Controllers/UserController.php`, `tests/fixtures/gin-responses/main.go`, `tests/fixtures/rails-render/app/controllers/users_controller.rb`, `tests/fixtures/ktor-respond/src/main.kt`
- **Gate**: e2e

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
- Verificación: ningún consumer del IR usa implementaciones TS-specific directamente; el grep por `@ts-ignore`, `ts.Node`, `babel` en `packages/core/scanners/` y `packages/frameworks/scanners/` no devuelve resultados fuera del frontend TS
- `docs/LANGUAGE-IR.md` explica cómo un frontend Python (tree-sitter-python), PHP (tree-sitter-php), Go (tree-sitter-go) o Java (tree-sitter-java) se monta encima sin tocar `core/scanners/` ni `frameworks/` — incluye un `ILanguageFrontend` mínimo de referencia
- Tests: `tests/contracts/language-ir-shape.spec.ts` valida que el IR TS cumple las 5 interfaces; los lenguajes futuros no rompen el shape cuando se añadan; `tests/core/typescript-frontend-shape.spec.ts` valida que el frontend TS implementado cumple el contrato
- DoD slice: `bun run typecheck && bun run lint:contracts && bun run test:core` verdes; ningún consumer del IR queda roto
