---
id: r00005
title: "Cerrar la migracion fuera del singleton de paths y process.env"
kind: refactor
status: ready
type: proposal
track: export-to-postman
date: 2026-08-08
related:
  - p00017
  - a00002
---

> **Parcial a 2026-08-08.** S1 entregado: `resolveRoot()` responde por
> los tres comandos que divergían, y de paso arregla que **`push` no
> leía `--project-root`** — pasárselo no hacía nada.
>
> Devuelve además **de dónde** salió la raíz, que es lo que permite
> avisar cuando se ha adivinado. Hacía falta: `watch` lanzado desde
> `/tmp` recorrió el árbol y generó la colección de un proyecto suelto
> entre los temporales.
>
> **S2 entregada a 2026-08-08.** El pipeline ya no se envuelve en
> `withProjectRoot()`: el contexto llega como argumento hasta el loader,
> que era el último sitio del camino feliz que preguntaba al singleton.
>
> Quitar la cola destapó lo que la cola tapaba, y no era poco. Dos
> `generateCollection` **del mismo proyecto** a la vez devolvían 19 y 18
> rutas en Django. La causa: los scanners recorren su fuente con regex
> `/g` declarados a nivel de módulo, y el `lastIndex` de esos regex lo
> comparte el proceso entero. El bucle hace `await` dentro, así que la
> otra ejecución le reseteaba la posición a mitad y releía rutas.
>
> Estaba en **12 ficheros y 29 sitios**. La ruta duplicada se fusionaba
> después por método + URI, así que la colección salía correcta: lo único
> que mentía era el contador, y un aviso que decía «declarado por más de
> un framework» habiendo solo uno. Por eso llevaba ahí sin que nadie lo
> viera.
>
> `lint:regex-state` ya prohibía mover el `lastIndex` a una posición
> arbitraria —eso colgaba el bucle— pero permitía `= 0` por inofensivo.
> Lo es con una sola ejecución. Ahora prohíbe también usar el regex
> compartido directamente, y se verificó reintroduciendo el fallo.
>
> El test que lo cubre compara **una ejecución consigo misma** en los 21
> frameworks: no hace falta saber cuál es el número bueno, solo que sea
> el mismo las dos veces.
>
> Queda S3, el candado contra la recaída del singleton.

# r00005 — Cerrar la migracion fuera del singleton de paths y process.env

## Goal

Que el contexto del proyecto deje de vivir en estado global de proceso, para que el CLI, el MCP y cualquier consumidor de vida larga puedan operar sin cola global, sin carreras y sin ramas especiales por comando.

## why

La refactorizacion de `p00017` mejoro mucho la situacion, pero no la cerro. `projects/core/discovery/paths.service.ts` sigue diciendo en su propia cabecera que se prefiera `resolveProjectContext()` en codigo nuevo, y a la vez mantiene `let cache: Discovered | null = null`, una `queue` para serializar llamadas concurrentes y `withScopedPaths()` para salvar el estado global mientras ocho servicios y varios scripts aun dependen de el. Eso ya no es deuda teorica: es deuda observada y documentada por el propio codigo. `summary.script.ts` sigue resolviendo `--project-root` con `process.env.POSTMAN_PROJECT_ROOT` o cwd, `scan.script.ts` mezcla `projectRootFlag ?? process.env.POSTMAN_PROJECT_ROOT ?? projectRoot()`, `push.script.ts` llama a `projectRoot()` del singleton, y `project-loader.service.ts` sigue leyendo `POSTMAN_CONFIG` y `POSTMAN_EXAMPLE` directamente.

La consecuencia no es solo estetica. Mientras el contexto del proyecto viva ahi:

- el MCP paga una cola global para evitar carreras,
- dos peticiones concurrentes no pueden fiarse de un contexto explicito de punta a punta,
- y cada comando conserva pequeñas diferencias de semantica en como resuelve su raiz, su config o sus flags.

## non-goals

- Reescribir de una vez todos los consumers legacy sin una ruta de migracion.
- Prohibir `process.env` en entrypoints donde un secreto o una bandera de shell si son parte legitima de la interfaz externa.
- Cambiar el comportamiento visible del producto mas alla de hacerlo consistente.

## Slices

- global_gate: e2e

### S1 — Un solo lector de contexto para los entrypoints que aun divergen
- **Status**: done
- **Files**: `projects/core/discovery/project-context.service.ts`, `projects/core/discovery/project-loader.service.ts`, `projects/cli/commands/summary.script.ts`, `projects/cli/commands/scan.script.ts`, `projects/cli/commands/push.script.ts`, `tests/core/project-context.service.spec.ts`
- **Gate**: type
- acceptance:
  - "`summary`, `scan` y `push` dejan de resolver `projectRoot` cada uno a su manera"
  - "`project-loader.service.ts` deja de leer `POSTMAN_CONFIG` y `POSTMAN_EXAMPLE` por libre si el contexto ya lo sabe"
  - "La politica de precedencia de flags y env queda escrita una vez"

### S2 — Sacar al pipeline y a los comandos del singleton caliente
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `projects/core/discovery/paths.service.ts`, `projects/core/discovery/generation.pipeline.ts`, `projects/core/discovery/project-context.service.ts`, `projects/cli/commands/generate.script.ts`, `projects/cli/commands/watch.script.ts`, `tests/core/scoped-paths.service.spec.ts`
- **Gate**: e2e
- acceptance:
  - "La ruta feliz del producto deja de depender de `withScopedPaths()` y de la `queue` global"
  - "`paths.service.ts` queda como shim legacy minimo o desaparece donde ya no aporte valor"
  - "Dos ejecuciones concurrentes sobre proyectos distintos no se pisan"

### S3 — Candado contra la recaida
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `scripts/gates/lint-project-context.script.ts`, `tests/cli/project-context-boundary.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "El lint falla si aparece un nuevo acceso directo a `POSTMAN_PROJECT_ROOT` o `projectRoot()` del singleton en capas donde ya debe entrar contexto explicito"
  - "Se comprueba metiendo uno y viendo romper el gate"
  - "La excepcion legitima de entrypoints queda declarada, no inferida"

## acceptance

- `summary`, `scan` y `push` dejan de resolver `projectRoot` cada uno a su manera
- `project-loader.service.ts` deja de leer `POSTMAN_CONFIG` y `POSTMAN_EXAMPLE` por libre si el contexto ya lo sabe
- La politica de precedencia de flags y env queda escrita una vez
- La ruta feliz del producto deja de depender de `withScopedPaths()` y de la `queue` global
- `paths.service.ts` queda como shim legacy minimo o desaparece donde ya no aporte valor
- Dos ejecuciones concurrentes sobre proyectos distintos no se pisan
- El lint falla si aparece un nuevo acceso directo a `POSTMAN_PROJECT_ROOT` o `projectRoot()` del singleton en capas donde ya debe entrar contexto explicito
- Se comprueba metiendo uno y viendo romper el gate
- La excepcion legitima de entrypoints queda declarada, no inferida