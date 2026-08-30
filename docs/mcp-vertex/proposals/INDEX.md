# Índice de propuestas

Este índice usa el `id` como referencia estable. La ruta refleja el estado
actual del frontmatter y, para `done`, también el `kind`.

## Activas

| Id | Kind | Estado | Ruta |
|---|---|---|---|
| `a00004` | `audit` | `ready` | [`ready/a00004-auditoria-de-la-zona-rust-de-escritorio.md`](ready/a00004-auditoria-de-la-zona-rust-de-escritorio.md) |
| `a00005` | `audit` | `ready` | [`ready/a00005-plan-post-auditoria-2026-08-29-hallazgos-abiertos-y-mejoras.md`](ready/a00005-plan-post-auditoria-2026-08-29-hallazgos-abiertos-y-mejoras.md) |
| `c00002` | `chore` | `ready` | [`ready/c00002-release-automatizada-de-npm-desde-ci.md`](ready/c00002-release-automatizada-de-npm-desde-ci.md) |
| `x00008` | `fix` | `in-progress` | [`in-progress/x00008-corregir-bugs-silenciosos-de-scanners-y-rutas-de-salida.md`](in-progress/x00008-corregir-bugs-silenciosos-de-scanners-y-rutas-de-salida.md) |
| `r00008` | `refactor` | `in-progress` | [`in-progress/r00008-contexto-explicito-en-los-lectores-residuales-del-singleton.md`](in-progress/r00008-contexto-explicito-en-los-lectores-residuales-del-singleton.md) |
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