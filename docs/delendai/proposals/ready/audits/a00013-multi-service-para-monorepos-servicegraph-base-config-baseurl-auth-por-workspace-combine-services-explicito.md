---
id: a00013
title: "Multi-service para monorepos — ServiceGraph base + config/baseUrl/auth por workspace + --combine-services explícito"
kind: audit
status: ready
type: proposal
track: export-to-postman
date: 2026-09-04
shippedIn:
  - d4a6d7c  # S1: ServiceGraph shape + groupByService
  - 32d4677  # S2: toServiceGraph helper adyacente + IToServiceGraphInput
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

- **Status**: pending
- **Files**:
  - \`packages/core/discovery/auth-scheme.helper.ts\`
  - \`packages/core/discovery/generation.pipeline.ts\`
  - \`tests/core/auth-scheme-per-service.spec.ts\` (nuevo)
- **Gate**: \`bun run typecheck && bun run test:core\`
- **Detalle**: el discriminante \`IEndpointAuth\` (\`none | scheme
  { bearer|apiKey|oauth2 }\`) se respeta por servicio; \`pickAuth()\`
  devuelve \`IServiceDescriptor.auth\` (no un global). El adapter
  OpenAPI y Postman consume el descriptor.

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

## acceptance

1. Monorepo \`apps/{users-api,payments-api}\` con el mismo \`METHOD+URI\` →
   dos colecciones distintas (o una combinada si \`--combine-services\`).
2. \`authScheme\` por servicio refleja la API real (bearer / apiKey / none).
3. Suite previa sigue verde: 21/21 ejemplos.
4. Coverage ≥ el actual (83.64% statements, no regresión local).
5. \`bun run validate\` verde end-to-end.
