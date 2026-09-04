# Índice de propuestas

Este índice usa el `id` como referencia estable. La ruta refleja el estado
actual del frontmatter y, para `done`, también el `kind`.

## Ready

Las propuestas nuevas se escriben directamente en `ready/`, agrupadas
por `<kind>` cuando aplica (audits, fixes, chores, …). Las propuestas
abiertas hoy son:

| Id | Kind | Carpeta |
|---|---|---|
| `a00014` | `audit` | [`ready/audits/a00014-effectiveprojectroot-centralizado-en-core-migracion-de-los-21-scanners.md`](ready/audits/a00014-effectiveprojectroot-centralizado-en-core-migracion-de-los-21-scanners.md) |
| `a00015` | `audit` | [`ready/audits/a00015-graphql-embedded-sdl-por-ast-ts-no-regex-sobre-source-crudo.md`](ready/audits/a00015-graphql-embedded-sdl-por-ast-ts-no-regex-sobre-source-crudo.md) |
| `a00016` | `audit` | [`ready/audits/a00016-frontend-typescript-multi-estilo-languageir-this-router-get-factory-get-aliases-reexports-constant-prop.md`](ready/audits/a00016-frontend-typescript-multi-estilo-languageir-this-router-get-factory-get-aliases-reexports-constant-prop.md) |
| `x00022` | `fix` | [`ready/fixes/x00022-path-containment-relative-en-lugar-de-startswith.md`](ready/fixes/x00022-path-containment-relative-en-lugar-de-startswith.md) |
| `x00023` | `fix` | [`ready/fixes/x00023-api-key-casing-en-countkeyusage.md`](ready/fixes/x00023-api-key-casing-en-countkeyusage.md) |
| `x00024` | `fix` | [`ready/fixes/x00024-generatecollection-estricto-no-perder-servicios.md`](ready/fixes/x00024-generatecollection-estricto-no-perder-servicios.md) |
| `x00025` | `fix` | [`ready/fixes/x00025-routesbyservice-acumular-en-lugar-de-sobrescribir.md`](ready/fixes/x00025-routesbyservice-acumular-en-lugar-de-sobrescribir.md) |
| `c00004` | `chore` | [`ready/chores/c00004-configurar-agent-orchestrator-portfactory-en-delendai-config.md`](ready/chores/c00004-configurar-agent-orchestrator-portfactory-en-delendai-config.md) |

Las nuevas detecciones de lenguaje y los FEAT/REF aún no entran en
este pase.

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
`a00007`, `a00008`, `a00009`, `a00010`, `a00011`, `a00012`, `a00013`, `c00002`,
`f00010`, `f00011`,
`p00007`,
`r00008`, `r00010`,
`x00008`, `x00012`, `x00013`, `x00014`, `x00020`, `x00021`,
`c00003`; están archivadas bajo sus carpetas canónicas:

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

Los informes crudos de auditoría, distintos de las propuestas `kind: audit`,
viven en [`../../audits/`](../../audits/), con nombres fechados y estables.
Las auditorías que forman parte del backlog y del estado del proyecto son
propuestas `kind: audit` y viven aquí, bajo `done/audits/`, indexadas por id.