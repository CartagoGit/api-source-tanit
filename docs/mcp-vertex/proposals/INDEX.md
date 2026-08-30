# Índice de propuestas

Este índice usa el `id` como referencia estable. La ruta refleja el estado
actual del frontmatter y, para `done`, también el `kind`.

## Ready

Las propuestas nuevas se escriben directamente en `ready/`, sin una
subcarpeta por kind. El directorio está vacío en este snapshot.

## Activas

| Id | Kind | Estado | Ruta |
|---|---|---|---|
| `p00007` | `legacy` | `blocked` | [`blocked/p00007-consumir-mcp-vertex-core-publicado.md`](blocked/p00007-consumir-mcp-vertex-core-publicado.md) |
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

Las propuestas cerradas recientemente son `a00004`, `a00005`, `c00002`,
`r00008` y `x00008`; están archivadas bajo sus carpetas canónicas:

| Id | Kind | Ruta |
|---|---|---|
| `a00004` | `audit` | [`done/audits/a00004-auditoria-de-la-zona-rust-de-escritorio.md`](done/audits/a00004-auditoria-de-la-zona-rust-de-escritorio.md) |
| `a00005` | `audit` | [`done/audits/a00005-plan-post-auditoria-2026-08-29-hallazgos-abiertos-y-mejoras.md`](done/audits/a00005-plan-post-auditoria-2026-08-29-hallazgos-abiertos-y-mejoras.md) |
| `a00006` | `audit` | [`done/audits/a00006-auditoria-exhaustiva-de-tipado-validacion-lint-y-bugs.md`](done/audits/a00006-auditoria-exhaustiva-de-tipado-validacion-lint-y-bugs.md) |
| `c00002` | `chore` | [`done/chores/c00002-release-automatizada-de-npm-desde-ci.md`](done/chores/c00002-release-automatizada-de-npm-desde-ci.md) |
| `r00008` | `refactor` | [`done/refactors/r00008-contexto-explicito-en-los-lectores-residuales-del-singleton.md`](done/refactors/r00008-contexto-explicito-en-los-lectores-residuales-del-singleton.md) |
| `x00008` | `fix` | [`done/fixes/x00008-corregir-bugs-silenciosos-de-scanners-y-rutas-de-salida.md`](done/fixes/x00008-corregir-bugs-silenciosos-de-scanners-y-rutas-de-salida.md) |

Los informes de auditoría, distintos de las propuestas audit, viven en
[`../audits/`](../audits/), con nombres fechados y estables.