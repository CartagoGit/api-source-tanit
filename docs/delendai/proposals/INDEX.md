# Índice de propuestas

Este índice usa el `id` como referencia estable. La ruta refleja el estado
actual del frontmatter y, para `done`, también el `kind`.

> Regenerado 2026-09-05 para resolver el conflicto merge no resuelto entre
> `develop` y `agent/copilot-review-fixes` que arrastraba marcas
> `<<<<<<< HEAD / >>>>>>> agent/copilot-review-fixes`. La fuente de verdad es
> ahora el resultado de `find docs/delendai/proposals -name '*.md'` cruzado
> con el frontmatter (`id`, `kind`, `status`, `path`); el gate `lint:proposals`
> rechaza cualquier divergencia.

## Ready

Las propuestas nuevas se escriben directamente en `ready/`, agrupadas
por `<kind>` cuando aplica (audits, fixes, chores, …).

| Id | Kind | Carpeta |
|---|---|---|
| `a00016` | `audit` | [`ready/audits/a00016-frontend-typescript-multi-estilo-languageir-this-router-get-factory-get-aliases-reexports-constant-prop.md`](ready/audits/a00016-frontend-typescript-multi-estilo-languageir-this-router-get-factory-get-aliases-reexports-constant-prop.md) |
| `c00005` | `chore` | [`ready/chores/c00005-higiene-de-worktree-residuos-de-agencia-gate-de-arbol-limpio.md`](ready/chores/c00005-higiene-de-worktree-residuos-de-agencia-gate-de-arbol-limpio.md) |
| `x00025` | `fix` | [`ready/fixes/x00025-routesbyservice-acumula-en-lugar-de-sobrescribir-dedupe-por-operationid.md`](ready/fixes/x00025-routesbyservice-acumula-en-lugar-de-sobrescribir-dedupe-por-operationid.md) |
| `x00027` | `fix` | [`ready/fixes/x00027-ci-verde-end-to-end-fix-delendai-sibling-checkout-en-validate-yml.md`](ready/fixes/x00027-ci-verde-end-to-end-fix-delendai-sibling-checkout-en-validate-yml.md) |
| `x00031` | `fix` | [`ready/fixes/x00031-iservicegraph-agrupa-por-serviceid-un-servicio-varios-frameworks.md`](ready/fixes/x00031-iservicegraph-agrupa-por-serviceid-un-servicio-varios-frameworks.md) |
| `x00032` | `fix` | [`ready/fixes/x00032-lint-proposals-exige-coherencia-status-cuerpo-slices-index.md`](ready/fixes/x00032-lint-proposals-exige-coherencia-status-cuerpo-slices-index.md) |
| `x00035` | `fix` | [`ready/fixes/x00035-package-manager-detection-bun-lock-tambien-admitido-bun-lockb-como-fallback.md`](ready/fixes/x00035-package-manager-detection-bun-lock-tambien-admitido-bun-lockb-como-fallback.md) |
| `x00036` | `fix` | [`ready/fixes/x00036-aspnet-coverage-http-head-y-http-options-no-se-descartan.md`](ready/fixes/x00036-aspnet-coverage-http-head-y-http-options-no-se-descartan.md) |
| `x00037` | `fix` | [`ready/fixes/x00037-i18n-completeness-gate-bloquea-locales-placeholder-de-ingles.md`](ready/fixes/x00037-i18n-completeness-gate-bloquea-locales-placeholder-de-ingles.md) |

## Bloqueadas

`status: blocked` vive en `blocked/`, con `blockedReason` en el frontmatter
que explica qué lo destraba.

| Id | Kind | Carpeta | Razón |
|---|---|---|---|
| `a00017` | `audit` | [`blocked/a00017-i18n-inversion-ingles-first-en-el-proyecto-i18n-solo-para-la-app-que-lo-usa.md`](blocked/a00017-i18n-inversion-ingles-first-en-el-proyecto-i18n-solo-para-la-app-que-lo-usa.md) | Bloqueada por CI verde end-to-end (i00002/x00027) y el bloque multi-service (x00028/x00031). |

## Activas

| Id | Kind | Estado | Ruta |
|---|---|---|---|
| `p00006` | `legacy` | `retired` | [`retired/p00006-document-extension-contract.md`](retired/p00006-document-extension-contract.md) |
| `x00029` | `fix` | `retired` | [`retired/x00029-isolar-discovery-specs-por-servicio-en-buildforservice.md`](retired/x00029-isolar-discovery-specs-por-servicio-en-buildforservice.md) |
| `x00030` | `fix` | `retired` | [`retired/x00030-atribucion-de-rutas-conservando-provenance-serviceid-scanner.md`](retired/x00030-atribucion-de-rutas-conservando-provenance-serviceid-scanner.md) |

## Cerradas

Las propuestas con `status: done` están archivadas en `done/<kind>s/` y se
mantienen sin renombrar para conservar la trazabilidad histórica. El gate
`lint:proposals` verifica automáticamente que cada ruta siga coincidiendo
con su estado y kind.

| Kind | Carpeta |
|---|---|
| `audit` | [`done/audits/`](done/audits/) |
| `breaking` | [`done/breakings/`](done/breakings/) |
| `chore` | [`done/chores/`](done/chores/) |
| `docs` | [`done/docs/`](done/docs/) |
| `feat` | [`done/feats/`](done/feats/) |
| `fix` | [`done/fixes/`](done/fixes/) |
| `infra` | [`done/infras/`](done/infras/) |
| `refactor` | [`done/refactors/`](done/refactors/) |
| `test` | [`done/tests/`](done/tests/) |

Las propuestas cerradas son `a00003`, `a00004`, `a00005`, `a00006`, `a00007`,
`a00008`, `a00009`, `a00010`, `a00011`, `a00012`, `a00013`, `b00001`, `c00002`,
`c00003`, `c00004`, `f00010`, `f00011`, `p00007`, `r00008`, `r00010`, `x00008`,
`x00012`, `x00013`, `x00014`, `x00020`, `x00021`, `x00022`, `x00023`, `x00024`;
están archivadas bajo sus carpetas canónicas.

> **Nota histórica (2026-09-05):** `a00014`, `a00015`, `a00016`, `b00001`,
> `c00004` y `x00025` fueron reabiertos en la revisión por cierres prematuros;
> ver `ready/` y el motivo de cada transición individual en su frontmatter.

Los informes crudos de auditoría, distintos de las propuestas `kind: audit`,
viven en [`../../audits/`](../../audits/), con nombres fechados y estables.
Las auditorías que forman parte del backlog y del estado del proyecto son
propuestas `kind: audit` y viven aquí, bajo `done/audits/`, indexadas por id.
