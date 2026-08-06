# Propuestas de `postman-exporter`

Misma disposición que el repositorio `mcp-vertex`, que es de donde sale
la convención. **La carpeta tiene que coincidir con el `status` del
frontmatter**; si no, `bun run lint:proposals` falla.

## Estados

| Carpeta | `status:` | Qué significa |
|---|---|---|
| `ready/` | `ready` | Aprobada y lista para empezar. Nadie la está tocando. |
| `in-progress/` | `in-progress` | Alguien la está implementando ahora. |
| `review/` | `review` | Implementada, esperando revisión. |
| `done/` | `done` | Cerrada y entregada. Se archiva por kind. |
| `paused/` | `paused` | Parada a propósito. El frontmatter dice por qué en `paused-reason`. |
| `blocked/` | `blocked` | No se puede avanzar por algo externo. `blocked-reason` lo explica. |
| `retired/` | `retired` | Descartada o sustituida. Si la sustituye otra, `superseded_by` la nombra. |
| `legacy/` | `legacy` | Anterior a esta convención. No se reescribe. |

## Archivo por kind dentro de `done/`

Para que la vista de cerradas escale, `done/` refleja los kinds:

| Subcarpeta | `kind:` |
|---|---|
| `feats/` | `feat` |
| `fixes/` | `fix` |
| `chores/` | `chore` |
| `docs/` | `docs` |
| `refactors/` | `refactor` |
| `tests/` | `test` |
| `audits/` | `audit` |
| `perfs/` | `perf` |
| `plans/` | `plan` |
| `resumes/` | `resume` |

Una subcarpeta se crea cuando cae el primer fichero de ese kind.

## Reglas

1. **Referencia por `id:`, nunca por nombre de fichero.** Los ficheros se
   renombran; el `id` no. Escribe `related: p00014`, no la ruta.
2. **El `id` no cambia** aunque la propuesta se renombre o se mueva.
3. **Mover de carpeta y cambiar el `status` es la misma operación.**
   Hacer solo una de las dos deja el árbol mintiendo, que es justo lo
   que caza `lint:proposals`.
4. **Cerrar una propuesta se anota en la propia propuesta**, con una cita
   arriba que diga qué se entregó y qué quedó fuera. Un `status: done`
   sin esa nota no dice si se hizo entera.

## Estado actual

Ver el árbol. En resumen: lo cerrado está en `done/`, lo siguiente en
`ready/`, y `blocked/` solo tiene lo que depende de terceros.
