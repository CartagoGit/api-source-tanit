---
id: f00015
title: "Response inference must run BEFORE buildCollection (f00014 follow-up)"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - f00014
shippedIn: ["99deb6f"]
---

# f00015 — La inferencia de responses debe correr ANTES de buildCollection

## Goal

Cerrar el bug que dejó el audit del 2026-09-07 al descubierto: el
CLI ejecutaba `inferResponses()` **después** de que
`pipeline.collection` ya estaba serializada, así que el bloque
`response[]` inferido nunca llegaba al Postman JSON del usuario.

## Why

El orden real en `generate.script.ts` antes del fix era:

```
EndpointSpecs
     ↓
buildCollection()          ← ya construye Postman sin responses
     ↓
Postman sin responses
     ↓
inferResponses()            ← demasiado tarde
     ↓
EndpointSpecs enriquecidos
     ↓
JSON del Postman ya construido ← nunca ve los responses inferidos
```

El bug está tapado por los tests de f00014 S4 (que prueban
directamente `renderInferredPostmanResponses(spec)` y no el camino
completo CLI → fichero) y por el flag `--inspect` (que muestra los
metrics pero no toca el JSON).

La salida correcta es:

```
discovery
  ↓
schemas
  ↓
validation
  ↓
auth
  ↓
response inference       ← moverlo aquí
  ↓
FINAL EndpointSpecs / Universal API Model
  ↓
build Postman / OpenAPI / Bruno / HAR / ...
```

## Approach

### Slice 1 — mover el loop al pipeline

**Files**:

- `packages/core/responses/infer-responses.ts`: nuevo helper
  `inferResponsesIntoSpecs(specs, projectRoot, routes, options)` que
  hace todo lo que hacía el loop del CLI (leer fuentes, despachar
  al inferrer, mutar `spec.responses` in place). El loop vivía en
  el script para evitar que core importara de frameworks — eso ya
  no aplica: el helper usa el dispatcher en core, que consume el
  registro que el CLI popula vía `ensureResponseInferrersRegistered()`
  en el composition root.
- `packages/contracts/interfaces/core/discovery.interface.ts`: añadir
  `IGenerationMetrics.responsesInferred` para que `--inspect` y la
  superficie MCP/UI vean la misma cifra que el usuario en consola.
- `packages/core/discovery/generation.pipeline.ts`: llamar a
  `inferResponsesIntoSpecs()` **antes** de `buildCollection()`, dentro
  de `buildForService()`. La función ya tenía acceso a `specs`,
  `service.endpoints` (las rutas, con `sourceFile` y `framework`) y
  `service.match.framework` (el fallback global).
- `packages/cli/commands/generate.script.ts`: borrar el loop
  duplicado. Sólo queda `ensureResponseInferrersRegistered()` y un
  console.log que ahora lee `pipeline.metrics.responsesInferred` en
  lugar de contar a mano.
- `tests/helpers/run-scanner.ts`: añadir `responsesInferred` al
  `GenerateMetrics` propagado a los e2e tests.

### Slice 2 — tests de pinning

**Files**:

- `tests/fixtures/nestjs-response-inference/`: nuevo fixture
  dedicado: dos endpoints con `@ApiOkResponse` y `@ApiCreatedResponse`
  para que el NestJS inferrer tenga algo concreto que emitir. El
  fixture `nestjs-comprehensive` no declara decoradores (es realista
  para una API hand-written) y eso es exactamente lo correcto — el
  inferrer devuelve `[]` cuando no hay nada que inferir.
- `tests/core/responses/infer-responses.spec.ts`: 4 tests nuevos
  cubriendo `inferResponsesIntoSpecs()` — registry vacío, route sin
  sourceFile, per-route framework gana sobre el global (x00061), y
  global es el fallback cuando route.framework está vacío.
- `tests/e2e/nestjs-comprehensive.test.ts`: 2 tests que prueban el
  contrato end-to-end — `metrics.responsesInferred > 0` y al menos
  un item del Postman lleva el bloque `response[]`.
- `tests/cli/responses-in-pre-buildcollection.test.ts`: el test
  definitivo — invoca la CLI como subprocess sobre el fixture
  dedicado y verifica que el JSON escrito en disco lleva `response[]`.
  Esto es lo que un test in-process no podría probar: si el script y
  el pipeline divergen, este test falla.

### Slice 3 — drive-by de auditoría

**Files**:

- `packages/core/discovery/host-config-parser.ts` →
  `host-config-parser.service.ts` (lint:naming).
- `packages/core/exporters/postman-inferred-response.ts` →
  `postman-inferred-response.exporter.ts` (lint:naming).
- `scripts/build/build-binary.script.ts`: `currentTarget()` ahora
  distingue `darwin-x64` vs `darwin-arm64` por `os.arch()`. Sin
  esto, una Intel Mac local aún elegía arm64 (el binario fallaba
  con `Bad CPU type`). `release --all` ya tenía la entrada
  `darwin-x64`, pero el camino del binario local no.
- 4 docblocks + 1 export muerto limpiado (`_LITERAL_TYPES`) para
  pasar `lint:tsdoc`. Sin esto, `validate` se aborta antes de
  llegar al resto del pipeline.

**Gate**: `bun run typecheck` + `bun run lint:naming` + `bun run lint:tsdoc` + `bun run test:core` + `bun run test:e2e` + `bun run test:cli`.

## Acceptance

- `bun run typecheck` verde.
- `bun run lint:naming` verde (los dos ficheros renombrados
  satisfacen la regla de sufijo del directorio).
- `bun run test:core` 1186/1186 verde (+4 tests para
  `inferResponsesIntoSpecs`).
- `bun run test:e2e` los 2 nuevos tests verdes.
- `bun run test:cli` el nuevo `responses-in-pre-buildcollection` verde.
- Invocación manual de la CLI sobre el fixture dedicado escribe un
  Postman JSON con `response[]` en disco — no sólo en memoria.
- `bun run build:binary` en una Mac Intel elegiría `darwin-x64`
  en lugar de `darwin-arm64`.

## Risks

- **Comportamiento del inferrer en runtime**: el dispatcher ya
  corre con fail-soft (try/catch por inferrer y por spec). Si un
  inferrer lanza, el spec se queda sin `responses` y los demás
  specs siguen. No hay riesgo nuevo.
- **Latencia**: leer N ficheros una vez por servicio añade I/O al
  pipeline. Para un proyecto típico (10–50 endpoints en 1–5
  ficheros) son microsegundos. El cache Map por ruta lo minimiza.
- **Order-sensitive**: si un slice futuro quiere que el inferrer vea
  el `EndpointSpec` ya enriquecido con `formRequest`, hay que mover
  el orden. Por ahora el dispatcher sólo necesita el spec básico y
  la fuente, así que está bien.

## Cross-references

- [`f00014`](../done/feats/f00014-postman-exporter-emits-inferred-responses.md)
  — propuesta original que añadió `renderInferredPostmanResponses`
  al exporter. Cerrada como `done` después de este slice.
- [`x00061`](../done/refactors/x00061-response-inference-dispatcher-accepts-framework-hint.md)
  — el dispatcher ya aceptaba `frameworkHint`; este slice lo
  respeta dentro del nuevo helper.
- [`r00018`](../done/refactors/r00018-fastify-hono-scanner-rewiring-languageir.md)
  — el escáner ahora etiqueta `route.framework`, así que el helper
  puede despachar por ruta, no sólo por global.
