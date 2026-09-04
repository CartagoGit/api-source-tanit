# Índice de propuestas

Este índice usa el `id` como referencia estable. La ruta refleja el estado
actual del frontmatter y, para `done`, también el `kind`.

## Ready

Las propuestas nuevas se escriben directamente en `ready/`, agrupadas
por `<kind>` cuando aplica (audits, fixes, chores, …). Las propuestas
abiertas hoy son:

| Id | Kind | Carpeta |
|---|---|---|
| `x00025` | `fix` | [`ready/fixes/x00025-routesbyservice-acumula-en-lugar-de-sobrescribir-dedupe-por-operationid.md`](ready/fixes/x00025-routesbyservice-acumula-en-lugar-de-sobrescribir-dedupe-por-operationid.md) |
| `x00027` | `fix` | [`ready/fixes/x00027-ci-verde-end-to-end-fix-delendai-sibling-checkout-en-validate-yml.md`](ready/fixes/x00027-ci-verde-end-to-end-fix-delendai-sibling-checkout-en-validate-yml.md) |
| `x00028` | `fix` | [`ready/fixes/x00028-multi-service-spec-isolation-buildforservice-aisla-specs-por-service-endpoints.md`](ready/fixes/x00028-multi-service-spec-isolation-buildforservice-aisla-specs-por-service-endpoints.md) |
| `x00030` | `fix` | [`ready/fixes/x00030-proposal-lifecycle-hardening-lint-proposals-exige-alineacion-y-cero-slices-pending-en-done.md`](ready/fixes/x00030-proposal-lifecycle-hardening-lint-proposals-exige-alineacion-y-cero-slices-pending-en-done.md) |
| `a00014` | `audit` | [`ready/audits/a00014-effectiveprojectroot-centralizado-en-core-migracion-de-los-21-scanners.md`](ready/audits/a00014-effectiveprojectroot-centralizado-en-core-migracion-de-los-21-scanners.md) |
| `a00015` | `audit` | [`ready/audits/a00015-graphql-embedded-sdl-por-ast-ts-no-regex-sobre-source-crudo.md`](ready/audits/a00015-graphql-embedded-sdl-por-ast-ts-no-regex-sobre-source-crudo.md) |
| `a00016` | `audit` | [`ready/audits/a00016-frontend-typescript-multi-estilo-languageir-this-router-get-factory-get-aliases-reexports-constant-prop.md`](ready/audits/a00016-frontend-typescript-multi-estilo-languageir-this-router-get-factory-get-aliases-reexports-constant-prop.md) |
<<<<<<< HEAD
=======
| `x00025` | `fix` | [`ready/fixes/x00025-routesbyservice-acumula-en-lugar-de-sobrescribir-dedupe-por-operationid.md`](ready/fixes/x00025-routesbyservice-acumula-en-lugar-de-sobrescribir-dedupe-por-operationid.md) |
| `x00029` | `fix` | [`ready/fixes/x00029-isolar-discovery-specs-por-servicio-en-buildforservice.md`](ready/fixes/x00029-isolar-discovery-specs-por-servicio-en-buildforservice.md) |
| `x00030` | `fix` | [`ready/fixes/x00030-atribucion-de-rutas-conservando-provenance-serviceid-scanner.md`](ready/fixes/x00030-atribucion-de-rutas-conservando-provenance-serviceid-scanner.md) |
| `x00031` | `fix` | [`ready/fixes/x00031-iservicegraph-agrupa-por-serviceid-un-servicio-varios-frameworks.md`](ready/fixes/x00031-iservicegraph-agrupa-por-serviceid-un-servicio-varios-frameworks.md) |
| `x00032` | `fix` | [`ready/fixes/x00032-lint-proposals-exige-coherencia-status-cuerpo-slices-index.md`](ready/fixes/x00032-lint-proposals-exige-coherencia-status-cuerpo-slices-index.md) |
| `i00002` | `infra` | [`ready/infras/i00002-desbloquear-ci-checkout-delendai-fuera-del-workspace-del-runner.md`](ready/infras/i00002-desbloquear-ci-checkout-delendai-fuera-del-workspace-del-runner.md) |
| `c00005` | `chore` | [`ready/chores/c00005-higiene-de-worktree-residuos-de-agencia-gate-de-arbol-limpio.md`](ready/chores/c00005-higiene-de-worktree-residuos-de-agencia-gate-de-arbol-limpio.md) |

## Bloqueadas

`status: blocked` vive en `blocked/`, con `blockedReason` en el frontmatter
que explica qué lo destraba:

| Id | Kind | Carpeta | Razón |
|---|---|---|---|
| `a00017` | `audit` | [`blocked/a00017-i18n-inversion-ingles-first-en-el-proyecto-i18n-solo-para-la-app-que-lo-usa.md`](blocked/a00017-i18n-inversion-ingles-first-en-el-proyecto-i18n-solo-para-la-app-que-lo-usa.md) | Priorización: i00002 (CI) y el bloque multi-service (x00029/x00030/x00031) cerrados antes. |
>>>>>>> agent/copilot-review-fixes

Las nuevas detecciones de lenguaje y los FEAT/REF aún no entran en
este pase.

## Bloqueadas

Propuestas pausadas por dependencias externas no resueltas. No son
candidatas hasta que se cierre el bloqueador.

| Id | Kind | Bloqueador | Ruta |
|---|---|---|---|
| `a00017` | `audit` | CI verde end-to-end + `buildForService()` aísla specs por servicio + `routesByService` (x00025) demuestra atribución correcta | [`blocked/a00017-i18n-inversion-ingles-first-en-el-proyecto-i18n-solo-para-la-app-que-lo-usa.md`](blocked/a00017-i18n-inversion-ingles-first-en-el-proyecto-i18n-solo-para-la-app-que-lo-usa.md) |

## Activas

| Id | Kind | Estado | Ruta |
|---|---|---|---|
| `p00006` | `legacy` | `retired` | [`retired/p00006-document-extension-contract.md`](retired/p00006-document-extension-contract.md) |

## Cerradas

Las propuestas con `status: done` están archivadas en `done/<kind>s/` y se
mantienen sin renombrar para conservar la trazabilidad histórica. El gate
`lint:proposals` verifica automáticamente que cada ruta siga coincidiendo
con su estado y kind.

| Kind | Carpeta |
|---|---|
| `audit` | [`done/audits/`](done/audits/) |
| `chore` | [`done/chores/`](done/chores/) |
| `docs` | [`done/docs/`](done/docs/) |
| `feat` | [`done/feats/`](done/feats/) |
| `fix` | [`done/fixes/`](done/fixes/) |
| `infra` | [`done/infras/`](done/infras/) |
| `refactor` | [`done/refactors/`](done/refactors/) |
| `test` | [`done/tests/`](done/tests/) |

Las referencias entre propuestas deben usar el id (`a00005`, `r00008`, etc.)
y no un nombre de fichero mutable.

Las propuestas cerradas recientemente son `a00003`, `a00004`, `a00005`, `a00006`,
`a00007`, `a00008`, `a00009`, `a00010`, `a00011`, `a00012`, `a00013`, `b00001`, `c00002`, `c00003`, `c00004`,
`f00010`, `f00011`,
`p00007`,
`r00008`, `r00010`,
<<<<<<< HEAD
`x00008`, `x00012`, `x00013`, `x00014`, `x00020`, `x00021`, `x00022`, `x00023`, `x00024`; están archivadas bajo sus carpetas canónicas. (Nota: `a00014`/`a00015`/`a00016`/`b00001`/`c00004`/`x00025` fueron reabiertos en la revisión 2026-09-05 por cierres prematuros — ver `ready/` y el motivo de cada transición.)
=======
`x00008`, `x00012`, `x00013`, `x00014`, `x00020`, `x00021`, `x00022`, `x00023`, `x00024`; están archivadas bajo sus carpetas canónicas:
>>>>>>> agent/copilot-review-fixes

| Id | Kind | Ruta |
|---|---|---|
| `a00003` | `audit` | [`done/audits/a00003-auditoria-completa-postman-exporter.md`](done/audits/a00003-auditoria-completa-postman-exporter.md) |
| `a00004` | `audit` | [`done/audits/a00004-auditoria-de-la-zona-rust-de-escritorio.md`](done/audits/a00004-auditoria-de-la-zona-rust-de-escritorio.md) |
| `a00005` | `audit` | [`done/audits/a00005-plan-post-auditoria-2026-08-29-hallazgos-abiertos-y-mejoras.md`](done/audits/a00005-plan-post-auditoria-2026-08-29-hallazgos-abiertos-y-mejoras.md) |
| `a00006` | `audit` | [`done/audits/a00006-auditoria-exhaustiva-de-tipado-validacion-lint-y-bugs.md`](done/audits/a00006-auditoria-exhaustiva-de-tipado-validacion-lint-y-bugs.md) |
| `a00007` | `audit` | [`done/audits/a00007-auditoria-completa-2026-08-08-estado-real-puntuacion-por-areas-y-backlog-de-excelencia.md`](done/audits/a00007-auditoria-completa-2026-08-08-estado-real-puntuacion-por-areas-y-backlog-de-excelencia.md) |
| `a00008` | `audit` | [`done/audits/a00008-auditoria-completa-2026-08-29-el-gate-de-dod-con-agujeros-cerrados-y-verificados.md`](done/audits/a00008-auditoria-completa-2026-08-29-el-gate-de-dod-con-agujeros-cerrados-y-verificados.md) |
| `a00009` | `audit` | [`done/audits/a00009-auditoria-exhaustiva-2026-09-03-cli-scanners-core-ui.md`](done/audits/a00009-auditoria-exhaustiva-2026-09-03-cli-scanners-core-ui.md) |
| `a00010` | `audit` | [`done/audits/a00010-plan-consolidado-auditoria-exhaustiva-2026-09-03.md`](done/audits/a00010-plan-consolidado-auditoria-exhaustiva-2026-09-03.md) |
| `a00011` | `audit` | [`done/audits/a00011-plan-correcciones-revision-a00010.md`](done/audits/a00011-plan-correcciones-revision-a00010.md) |
| `a00012` | `audit` | [`done/audits/a00012-plan-de-estabilizacion-y-arquitectura-2026-09-04.md`](done/audits/a00012-plan-de-estabilizacion-y-arquitectura-2026-09-04.md) |
| `a00013` | `audit` | [`done/audits/a00013-multi-service-para-monorepos-servicegraph-base-config-baseurl-auth-por-workspace-combine-services-explicito.md`](done/audits/a00013-multi-service-para-monorepos-servicegraph-base-config-baseurl-auth-por-workspace-combine-services-explicito.md) |
| `c00002` | `chore` | [`done/chores/c00002-release-automatizada-de-npm-desde-ci.md`](done/chores/c00002-release-automatizada-de-npm-desde-ci.md) |
| `p00007` | `chore` | [`done/chores/p00007-consumir-delendai-core-publicado.md`](done/chores/p00007-consumir-delendai-core-publicado.md) |
| `f00010` | `feat` | [`done/feats/f00010-mejorar-experiencia-de-deteccion-de-framework.md`](done/feats/f00010-mejorar-experiencia-de-deteccion-de-framework.md) |
| `f00011` | `feat` | [`done/feats/f00011-mejoras-en-la-deteccion-de-lenguajes.md`](done/feats/f00011-mejoras-en-la-deteccion-de-lenguajes.md) |
| `r00008` | `refactor` | [`done/refactors/r00008-contexto-explicito-en-los-lectores-residuales-del-singleton.md`](done/refactors/r00008-contexto-explicito-en-los-lectores-residuales-del-singleton.md) |
| `r00010` | `refactor` | [`done/refactors/r00010-eliminar-el-singleton-de-paths-service.md`](done/refactors/r00010-eliminar-el-singleton-de-paths-service.md) |
| `x00008` | `fix` | [`done/fixes/x00008-corregir-bugs-silenciosos-de-scanners-y-rutas-de-salida.md`](done/fixes/x00008-corregir-bugs-silenciosos-de-scanners-y-rutas-de-salida.md) |
| `x00022` | `fix` | [`done/fixes/x00022-path-containment-correcto-en-toprojectrelative-relative-en-lugar-de-startswith.md`](done/fixes/x00022-path-containment-correcto-en-toprojectrelative-relative-en-lugar-de-startswith.md) |
| `x00023` | `fix` | [`done/fixes/x00023-api-key-casing-en-countkeyusage-clave-canonica-lowercase-displayname-original.md`](done/fixes/x00023-api-key-casing-en-countkeyusage-clave-canonica-lowercase-displayname-original.md) |
| `x00024` | `fix` | [`done/fixes/x00024-generatecollection-estricto-error-explicito-cuando-hay-1-servicio-y-no-se-pidio-combinar.md`](done/fixes/x00024-generatecollection-estricto-error-explicito-cuando-hay-1-servicio-y-no-se-pidio-combinar.md) |
<<<<<<< HEAD
| `c00004` | `chore` | [`done/chores/c00004-configurar-agent-orchestrator-portfactory-en-delendai-config-json-para-que-los-bounded-agents-puedan-delegar.md`](done/chores/c00004-configurar-agent-orchestrator-portfactory-en-delendai-config-json-para-que-los-bounded-agents-pueden-delegar.md) |
=======
| `b00001` | `breaking` | [`done/breakings/b00001-rebrand-tanit-el-proyecto-pasa-de-export-to-postman-a-tanit-api-source-discovery.md`](done/breakings/b00001-rebrand-tanit-el-proyecto-pasa-de-export-to-postman-a-tanit-api-source-discovery.md) |
| `c00004` | `chore` | [`done/chores/c00004-configurar-agent-orchestrator-portfactory-en-delendai-config-json-para-que-los-bounded-agents-puedan-delegar.md`](done/chores/c00004-configurar-agent-orchestrator-portfactory-en-delendai-config-json-para-que-los-bounded-agents-puedan-delegar.md) |
>>>>>>> agent/copilot-review-fixes

Los informes crudos de auditoría, distintos de las propuestas `kind: audit`,
viven en [`../../audits/`](../../audits/), con nombres fechados y estables.
Las auditorías que forman parte del backlog y del estado del proyecto son
propuestas `kind: audit` y viven aquí, bajo `done/audits/`, indexadas por id.