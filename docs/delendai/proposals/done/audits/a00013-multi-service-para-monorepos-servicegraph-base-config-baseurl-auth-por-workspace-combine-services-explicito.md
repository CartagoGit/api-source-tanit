---
id: a00013
title: "Multi-service para monorepos — ServiceGraph base + config/baseUrl/auth por workspace + --combine-services explícito"
kind: audit
status: done
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - d4a6d7c  # S1: ServiceGraph shape + groupByService
  - 32d4677  # S2: toServiceGraph helper adyacente + IToServiceGraphInput
  - 2f68240  # S3: buildForService + --combine-services flag
  - 33df4ef  # S4: authScheme per-service + pickAuth helper
dependsOn:
  - a00012
related:
  - a00009
  - f00010
---

# a00013 — Multi-service para monorepos

## Goal

Convertir `discovery` en un modelo multi-service de verdad. Hoy ya hay un
`serviceId` que distingue dos `GET /health` en workspaces distintos,
pero `loadProject()` carga una sola config y `buildFor()` produce una
sola colección. La propuesta introduce un **\`ServiceGraph\`** donde cada
servicio lleva su propia `baseUrl`, `auth`, `variables`, `authScheme`
y `endpoints[]`, y crea una colección por defecto por servicio. Un
flag explícito \`--combine-services\` permite el comportamiento legacy
cuando el usuario lo pide.

## Why

Es el P1 arquitectónico del audit 2026-09-03 / 2026-09-04. Aunque
\`serviceId\` evita la colisión \`users-api GET /health\` ↔
\`payments-api GET /health\`, el resto del pipeline **no se ha enterado**:

- \`loadProject()\` lee una única config desde la raíz del monorepo.
- \`buildFor()\` invoca \`detectAuthScheme(specs, ...)\` con TODOS los
  specs mezclados → un único \`authScheme\` para todos los workspaces.
- \`baseUrl\`, \`variables\`, \`globalAuth\`, etc. son globales.

Resultado: \`apps/catalog-api (apiKey)\` y \`apps/payment-api (bearer)\`
terminan fusionados en una sola colección con un único auth global
que no representa a ninguno de los dos.

## Non-goals

- No cambia la API HTTP pública de \`expostman generate\`.
- No introduce un servidor en tiempo real.
- No rompe \`serviceId\` para workspaces de un solo servicio.
- No reconsidera la decisión \`ServiceGraph\` vs colecciones múltiples
  monolito por configuración — esa decisión se toma al final de S2.

## Slices

### S2 — \`toServiceGraph\` adyacente al pipeline (single-service path preservado)

- **Status**: pending (adyacente — el wiring real del pipeline queda en S3)
- **Files (planned)**:
  - \`packages/core/discovery/generation.pipeline.ts\`
  - \`packages/core/discovery/project-loader.service.ts\`
  - \`tests/core/group-by-service.spec.ts\` (nuevo)
- **Detalle**: S2 deja el grafo listo. No toca el pipeline
  (eso es S3, marcado como disjointness warning por el parser de
  propuestas). El wiring real del single-service sigue funcionando
  exactamente como antes: 21/21 ejemplos + 951 tests verdes.

### S3 — \`buildSpecsFromService()\` en \`pipeline\` y \`--combine-services\`

- **Status**: pending
- **Files**:
  - \`packages/cli/commands/generate.script.ts\`
  - \`packages/core/discovery/generation.pipeline.ts\`
  - \`tests/cli/generate-monorepo-multi-service.spec.ts\` (nuevo)
- **Gate**:
  - \`bun run test:cli tests/cli/generate-monorepo-multi-service.spec.ts\`
  - \`bun run validate:examples\`
- **Detalle**:
  - \`generate.script.ts\` añade flag \`--combine-services\` (default \`false\`).
  - \`buildFor(service, options)\` se introduce como primitiva; legacy
    \`buildFor(project)\` se queda como wrapper que crea un solo servicio.
  - Tests:
    - \`apps/users-api\` + \`apps/payments-api\` con \`GET /health\` →
      dos endpoints separados, no fusionados.
    - \`apps/a\` (Express) + \`apps/b\` (FastAPI) con \`POST /login\` y
      auth distinta → config por servicio.
    - \`--combine-services\` produce la salida legacy.

### S4 — \`authScheme\` por servicio + discriminante exhaustiva

- **Status**: done (commit 33df4ef)
- **Files**:
  - `packages/core/discovery/auth-scheme.helper.ts` (nuevo)
  - `packages/core/discovery/generation.pipeline.ts`
  - `tests/core/auth-scheme-per-service.spec.ts` (nuevo)
  - `docs/API.md`
- **Gate**: `bun run typecheck && bun run lint && bun run test:core && bun run test:cli && bun run validate:examples`
- **Detalle**:
  - `pickAuth(service, fallback): IEndpointAuth | undefined` resuelve el override del descriptor o el fallback del proyecto **sin colapsar el discriminante**: si `service.auth` es `{ kind: "scheme", scheme: "bearer" }`, devuelve eso exactamente; el `kind` siempre se preserva por construcción.
  - `toIEndpointAuth(detected): IEndpointAuth` mapea exhaustivamente `IDetectedAuthScheme` (bearer/apikey/oauth2/none) → `IEndpointAuth`. Switch exhaustivo: si se añade un `type` al union sin mapearlo, TypeScript marca el switch como no-exhaustivo.
  - `buildServiceConfig(config, service): ProjectConfig` devuelve una copia superficial con `service.baseUrl` aplicado + `variables` copiado con la entrada `{{baseUrl}}` sincronizada. Es la primitiva que garantiza "no se muta `discovery.config` entre iteraciones del loop multi-service".
  - `buildForService` consume los tres: `localConfig = buildServiceConfig(...)` para no mutar; `pickAuth(service, toIEndpointAuth(detectedFromSpecs))` para aplicar override per-service; `authSchemeFromEndpointAuth(effective, service.match.framework)` para volver a `IDetectedAuthScheme` y alimentar `buildCollection` / `applyAuthFlow` / `authVariablesFor`.
  - `void service;` eliminado: el descriptor ya se usa.
  - 19 tests nuevos: 9 para `pickAuth` (preservación de discriminante para las 4 variantes de `IEndpointAuth`, determinismo), 4 para `toIEndpointAuth`, 5 para `buildServiceConfig` (incluye la no-mutación), 1 integración `generateCollections` multi-service que verifica que cada iteración ve un `config.baseUrl` estable y `config` propio (no comparte referencia con `discovery.config`).
  - Single-service path intacto: `service.baseUrl === null` y `service.auth === undefined` por defecto, así que `buildServiceConfig` produce un equivalente del original y los 21 ejemplos siguen pasando sin cambios.
  - Regresión cero: 980/980 core (961 baseline + 19 nuevos), 527/527 CLI (1 skipped preexistente), 21/21 ejemplos, typecheck 6/6, lint todas las sub-comprobaciones, validate:examples.

### S1 — ServiceGraph data shape en contracts/ + helper puro

- **Status**: done
- **Files**:
  - `packages/contracts/interfaces/core/service-graph.interface.ts` (nuevo)
  - `packages/core/discovery/group-by-service.helper.ts` (nuevo)
  - `tests/core/group-by-service.spec.ts` (nuevo)
- **Gate**: `bun run typecheck && bun run lint:contracts && bun run lint && bun run lint:api && bun run test:core`
- **Detalle**:
  - Shape `IServiceGraph { services: IServiceDescriptor[]; combined: boolean; }` con `IServiceDescriptor` reusando `IProjectMatch`, `ParsedRoute`, `IEndpointAuth`.
  - El input del helper `IGroupByServiceInput` **vive en `contracts/`** también (lint:contracts lo exige), no se introduce barrel `packages/contracts/index.ts` (lo prohíbe el README de contracts/).
  - `deriveServiceId(match)` derivado de `frameworkSearchRoot` (a00010), normalizado a `[A-Za-z0-9_-]`. Default = `framework@projectRoot`.
  - 13 tests cubren: id estable, un solo servicio, dos servicios con misma `METHOD+URI` no colisionan, `combined` default `false`, override de auth+baseUrl por servicio, errores coherentes.


### S3 — `buildSpecsFromService()` en `pipeline` y `--combine-services`

- **Status**: done (commit 2f68240)
- **Files**:
  - `packages/core/discovery/generation.pipeline.ts`
  - `packages/cli/commands/generate.script.ts`
  - `tests/cli/generate-monorepo-multi-service.spec.ts` (nuevo)
- **Gate**: `bun run typecheck && bun run lint && bun run validate:examples && bun run test:core && bun run test:cli`
- **Detalle**:
  - Pipeline: `IDiscovery` ahora incluye `matches`, `routesByService`, `monorepoDetection`.
  - `buildFor` consume `IServiceGraph`: single-service / `combineServices=true` emite `IGenerationResult`; multi-service / `combineServices=false` emite `IGenerationResult[]`.
  - Camino zero-endpoints (matches.length === 0) sintetiza un servicio `default` para preservar el legacy (applyAgnosticInference + buildCollection + auth flow siguen corriendo).
  - CLI: nuevo flag `--combine-services` (default false), propagado a `IGenerationOptions.combineServices`.
  - 3 tests CLI verifican el parse del flag y el codigo de salida. Tests de end-to-end con orchestrator real se haran cuando exista `examples/example-monorepo`.
  - Regresion cero: 961/961 core, 524/524 CLI, 21/21 examples, 491/491 e2e, 943/943 frameworks.

## acceptance

1. Monorepo \`apps/{users-api,payments-api}\` con el mismo \`METHOD+URI\` →
   dos colecciones distintas (o una combinada si \`--combine-services\`).
2. \`authScheme\` por servicio refleja la API real (bearer / apiKey / none).
3. Suite previa sigue verde: 21/21 ejemplos.
4. Coverage ≥ el actual (83.64% statements, no regresión local).
5. \`bun run validate\` verde end-to-end.
