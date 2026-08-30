# Índice de propuestas

Este índice usa el `id` como referencia estable. La ruta refleja el estado
actual del frontmatter y, para `done`, también el `kind`.

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
`r00008` y `x00008`; están archivadas bajo `done/<kind>/`.