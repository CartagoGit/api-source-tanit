# Propuestas de `export-to-postman`

Misma disposición que el repositorio `delendai`, que es de donde sale
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
| `resumes/` | `resume` |

Las subcarpetas están todas creadas de antemano, aunque estén vacías.

## Por qué hay un `.gitkeep` en cada carpeta

Git no versiona directorios, solo ficheros. Sin el `.gitkeep`, en cuanto
la última propuesta de un estado se mueve a otro sitio la carpeta
desaparece del repo — y el siguiente que quiera dejar algo en `review/`
se encuentra sin sitio donde dejarlo, o lo deja en la raíz.

El esqueleto entero (8 carpetas de estado + 13 kinds dentro de `done/`)
está anclado con `.gitkeep` y `lint:proposals` lo comprueba en cada
`bun run validate`. La lista no se escribe a mano en el lint: se deriva
de los mismos mapas de estados y kinds, así que añadir un estado nuevo
crea su carpeta obligatoria sola.

## Los ids llevan prefijo de kind

Un id nuevo es **una letra de familia + cinco dígitos**: `a00001`,
`x00003`, `r00002`, `d00001`, `f00001`, `t00001`. La letra sale del
`kind`, y quien la asigna es el servidor:

```
delendai_proposals_create_proposal { kind: "fix", title: "…" }
```

No se inventa a mano. Pedir un id concreto que no siga la convención
falla, y pedir uno con el prefijo `p` también: **`p` es el alias
retirado**, de solo lectura. Las 43 propuestas históricas (`p00001` a
`p00043`) lo conservan porque son registro de lo que pasó y renombrarlas
rompería las referencias cruzadas entre ellas.

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
5. **Las carpetas no se borran nunca**, ni cuando se quedan vacías. El
   `.gitkeep` las mantiene y el lint lo exige.

## Índice

El índice mantenido de propuestas activas y sus rutas canónicas está en
[`INDEX.md`](INDEX.md). Las propuestas cerradas se consultan por kind bajo
`done/`; los ids son estables aunque cambien el nombre del fichero o su
carpeta de estado.

## Estado actual

Ver el árbol. En resumen: lo cerrado está en `done/`, lo siguiente en
`ready/`, y `blocked/` solo tiene lo que depende de terceros.
