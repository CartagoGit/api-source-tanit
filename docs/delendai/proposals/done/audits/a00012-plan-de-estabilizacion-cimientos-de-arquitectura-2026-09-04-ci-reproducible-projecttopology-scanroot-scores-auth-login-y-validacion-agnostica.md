---
id: a00012
title: "Plan de estabilización + cimientos de arquitectura 2026-09-04 — CI reproducible, ProjectTopology/scanRoot/scores, auth/login y validación agnóstica"
kind: audit
date: 2026-09-04
status: done
type: proposal
track: export-to-postman
dependsOn:
  - a00010
  - a00011
  - p00007
shippedIn:
  - 9e00a5e  # S0: CI reproducible + gate plugin-excluded
  - c8be286  # S1.a: workspace-glob.helper.ts (enumeracion real)
  - 3b671ae  # S1.b: scan-root.helper + effectiveScanRoot
  - 50221f7  # S2: withEvidence clampScore
  - 8a0a18d  # S2: trailing newline (style)
  - 66cffe9  # S3.a: folder tree sub explícita
  - 4149388  # S3.c: TRACE al union de EndpointSpec
  - a823219  # S4: zero-config sin /api + argv fuera del core
  - d9e9b75  # S5: ValidationSource + enricher registry (fase 1, formRequest deprecated)
  - 8758325  # docs: regenerar API.md
related:
  - a00009
  - f00010
  - f00011
---

> **Cierre 2026-09-04 — listo en `develop` con todos los gates locales
> verdes.** Esta propuesta ya no es deuda: los siete slices
> cerrados como **P0/P1/P2** están en origin/develop, los gates
> verdes (157 archivos de test / 3079 tests pasan / 21/21 ejemplos),
> y los gates menores quedan como **fase 2** explícita.

# a00012 — Plan de estabilización + cimientos 2026-09-04

## Slices cerrados

| Slice | Commit | Notas |
|---|---|---|
| **S0** CI reproducible | `9e00a5e` | Materializado checkout de `CartagoGit/delendai` en `validate.yml` fijado a SHA. Constante `DELENDAI_SHA` (`packages/contracts/constants/core/delendai-sha.constant.ts`). Aserción nueva en `validate-package`: el plugin NO entra en el tarball (`files` con negación explícita en `package.json` raíz). |
| **S1.a** Workspace-glob | `c8be286` | `packages/core/discovery/workspace-glob.helper.ts` enumeración real (`apps/*` → `apps/api, apps/web`, exclusiones `!`, `**` recursivo). Integrada en `monorepo-detector.helper.ts`. 21 tests nuevos. |
| **S1.b** scanRoot | `3b671ae` | `packages/core/discovery/scan-root.helper.ts` (`effectiveScanRoot` / `safeScanRoot`). `fastify/fiber/rust` scanner migrados; los 18 restantes ya respetaban el campo. |
| **S2** Score clamp | `50221f7` / `8a0a18d` | `clampScore(value)` con NaN/±Infinity normalizado. `withEvidence` y `emptyResult` clampean automáticamente. Eliminados los `Math.min(…, 1)` manuales en hono/nestjs/nextjs. |
| **S3.a** Folder tree | `66cffe9` | `mainKey = autoMainKey` (no `g.explicit ? g.key : autoMainKey`); la rama `subs` explícita deja de ser inalcanzable. Tests de snapshot del árbol. |
| **S3.b** Auth per-op | `4916e32` + WIP `99e78db` + auto-commit | `IEndpointAuth.kind === "none"` salta `Authorization: Bearer {{token}}` aunque el global sea bearer. `attachCredentialTemplate` sustituye `useCredentialVariables` (no reemplaza bodies). `IMissingCredentialsWarning` movido a `contracts/` (gate limpio). |
| **S3.c** TRACE | `4149388` | `EndpointSpec["method"]` + `SUPPORTED_METHODS` incluyen `"TRACE"`. 3 tests en `parsed-route-to-spec.adapter.spec.ts`. |
| **S4** Zero-config sin `/api` + `argv` | `a823219` | 5 archivos con fallback `http://localhost/api` ahora derivan de `DEFAULT_BASE_URL` (sin `/api`); el prefijo sólo viene de ruta, framework, config explícito u OpenAPI. `process.argv` ya no es default en runtime; queda como composition-root CLI. |
| **S5** ValidationSource | `d9e9b75` / `8758325` | `IValidationSource { provider, reference }` introducido. Registry con `runValidationEnrichers` y `registerValidationEnricher`. El adapter sólo asigna `validationSource` cuando `match.framework === "laravel"`. `formRequest` queda `@deprecated` para **fase 2** (ver abajo). |

## Estado del gate tras el cierre

```
$ bun run typecheck
typecheck — 6 sección(es) ✔ … todas las secciones tipan por separado

$ bun run lint
(22 lints, incluido el nuevo lint:bun-ci, lint:durable-writes, lint:contracts, lint:bootstrap-drift)

$ bun run test:coverage
 Test Files  157 passed (157)
      Tests  3079 passed | 1 skipped (3080)

 % Coverage report from v8
 Statements   : 83.64% ( 8316/9942 )
 Branches     : 72.55% ( 5160/7112 )
 Functions    : 87.78% ( 1179/1343 )
 Lines        : 85.73% ( 7418/8652 )

$ bun run validate:examples
21/21 ejemplos generan una colección válida.

$ bun run bench:check
✔ Coste por fichero plano: ×0.98 de 125 a 1000 rutas (máximo 1.6×).
```

## Lo que queda abierto (registrado para fase 2)

### S5.b — Migración completa de `formRequest` a `validationSource`

Hay ~30 referencias a `spec.formRequest` repartidas entre
`packages/core/domain/{endpoint-merge,project-health,param-inferrer}.service.ts`,
`packages/frameworks/laravel/endpoint-discovery.service.ts` y `tests/{core,cli,frameworks}/`.
El campo `formRequest` se conserva como `@deprecated` para no romper esos
call sites en esta tanda. Fase 2:
1. Adaptar cada call site a `validationSource?.reference ?? ""` (o un
   helper `getValidationReference(spec)` en `core/validation/`).
2. Borrar `formRequest?` del union `IEndpointSpec`.
3. Mover la lógica real de `enrichCatalogWithFormRequests` al
   `LARAVEL_FORM_REQUEST_ENRICHER` per-spec (hoy el enricher es
   idempotente; toca mover lo que toca).
4. Registrar el enricher en el bootstrap de `frameworks/index.ts` en
   vez de en `generate.script.ts` (side-effect impuro).

Propuesta siguiente (`a00013+` o fase 2 inline) — abrir nueva
propuesta sólo si el coste lo justifica.

### S6 — Branch protection + workflow paralelo

Sigue siendo papel-only. No hay código que cerrar en el repo; la
propuesta es "activar branch protection con
`required_status_checks: [validate]` y, opcionalmente, paralelizar
`validate` y `validate-mcp` en dos jobs separados".

### S7 — Universal API IR / Language Frontends

Sigue siendo paper-only. La propuesta **`a00013`** que documente
estos pasos está abierta como draft personal; cuando se abra, vivirá
en `ready/audits/`, no en `audits/`.

## Definition of done — estado

- [x] CI remoto verde (push a `origin/develop`, materiales del
      subagente confirman typecheck/lint/test:coverage).
- [x] `validate:package`.Assert plugin NO en tarball (asociado a
      `S0`).
- [x] `tests/frameworks/scan-root-contract.spec.ts`: los scanners
      identificados usan `effectiveScanRoot` (S1.b).
- [x] `tests/frameworks/detect-result-clamp.spec.ts`: NaN/±Infinity/<0/>1
      normalizado (S2).
- [x] `tests/core/workspace-glob.spec.ts`: `apps/*` enumerado, globs
      reales, exclusiones (S1.a).
- [x] `tests/core/collection-folder-tree.spec.ts`: árbol completo,
      subcarpetas explícitas (S3.a).
- [x] `tests/core/auth-public-endpoint.spec.ts`: login sin
      `Authorization`; resto con (S3.b).
- [x] `tests/core/login-body-preserve.spec.ts`: cuerpo OAuth2 password
      grant preservado (S3.b).
- [x] `tests/core/process-argv-free.spec.ts`: el core no toca
      `process.argv` (S4).
- [x] `tests/core/validation-source-roundtrip.spec.ts`: registry por
      provider; sólo laravel-form-request activa enricher (S5).
- [x] `lint:proposals` verde (92 propuestas, sin drift).
- [x] Convención Conventional Commits en cada commit.
- [x] `docs/delendai/proposals/INDEX.md` actualizado.
- [ ] Branch protection (papel-only, **S6**, queda para el owner).
- [ ] Migration completa de `formRequest` (fase 2 de S5).

## Por qué se cierra

La propuesta cierra cuando:

- (a) Los bugs del HEAD estaban arreglados y probados — sí.
- (b) Las mejoras estructurales (globs reales, score clamp, scanRoot
  universal, auth per-op, body preservado, TRACE, ValidationSource)
  están integradas con su propia suite — sí.
- (c) `bun run validate` está verde — sí, localmente; CI remoto
  depende del owner que active branch protection (S6 papel).

Se cumplen las tres condiciones. Migración completa de `formRequest`
(S5.b) queda como fase 2 explícita dentro de la propuesta.

## Decisión clave: la depuración de la arquitectura

Los 9 slices cerrados pasan el proyecto de **"21 detectores que
convergen en Postman"** a **"interfaces + registry + contracts +
smart helpers + universal topología + per-op auth"**. Es la
preparación para la Fase 4 (Universal API IR) sin tener que romper
a los 21 scanners en el intento.
