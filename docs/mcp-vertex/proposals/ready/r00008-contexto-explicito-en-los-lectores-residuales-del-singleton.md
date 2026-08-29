---
id: r00008
title: "contexto explicito en los lectores residuales del singleton"
kind: refactor
status: ready
type: proposal
track: export-to-postman
date: 2026-08-29
related:
  - p00017
  - r00005
---

# r00008 — contexto explícito en los tres lectores residuales del singleton

## Goal

Cerrar la deuda que `lint:project-context` declara como `debt` (3 sitios,
no puede crecer): que `project-loader.service.ts`, el camino legacy de
Laravel y los tools del plugin MCP dejen de leer el singleton de
`paths.service.ts`, recibiendo el contexto como argumento en cada borde.
Cuando la lista `debt` quede vacía, la cola de serialización y el cache
a nivel de módulo de `paths.service.ts` pierden su razón de ser. Esto es
lo que F-006 de la auditoría vigente llama "deshacer el singleton".

## why

`p00017` y `r00005` cerraron la mayor parte de la migración:
`IProjectContext` existe, `resolveProjectContext()` no tiene estado, y
el pipeline pasa contexto explícito. Lo que queda es el parche que
compensa a los lectores residuales: `withScopedPaths()` guarda estado
global, lo pisa y lo restaura, con una cola de `Promise` para que dos
llamadas concurrentes no se destrocen. Mientras exista un lector
residual, cualquier consumidor de vida larga (host MCP, tests en
paralelo, dos proyectos en un proceso) depende de esa cola.

La auditoría vigente (2026-08-29, F-006) lo mide: cache (línea ~57) y
cola (línea ~250) siguen citados como deuda; branches 64,2 % con 2,2
puntos de margen es el síntoma visible de que el camino feliz está
medido pero no los caminos alternativos.

## non-goals

- No cambia la heurística de `resolveProjectRoot()` ni el fallback a
  `process.cwd()`: sigue siendo cómodo y está avisado vía
  `projectRootWasExplicit()`.
- No toca la superficie MCP del plugin más allá de lo que exige el
  contrato de cada tool (cada tool ya declara input/output schema).
- No se quita la variable `POSTMAN_PROJECT_ROOT` para los entrypoint:
  `lint:project-context` los declara `entrypoint` de forma legítima.

## Slices

- global_gate: lint

### S1 — `project-loader.service.ts` sin fallback al singleton
- **Status**: pending
- **Files**: `packages/core/discovery/project-loader.service.ts`,
  `packages/cli/commands/*.script.ts` (los que llaman a `loadProject()`)
- **Gate**: test
- acceptance:
  - "Los comandos del CLI que llaman a `loadProject()` pasan el contexto resuelto por `resolveRoot()`"
  - "El fallback al singleton en `loadProject()` desaparece o queda reservado a un único borde declarado"

### S2 — Los tools del plugin reciben contexto, no envuelven
- **Status**: pending
- **Files**: `packages/plugins/mcp-vertex_expostman/src/lib/tools/*.ts`,
  `packages/cli/commands/{list,stats,scan,diff}.script.ts` (sus exports `run*`)
- **Gate**: test
- acceptance:
  - "`runList`/`runStats`/`runScan`/`runCheck` aceptan un contexto explícito en vez de leer el singleton"
  - "Los tools pasan ese contexto desde su input, sin `withScopedPaths` alrededor del comando completo"
  - "`validate` sigue verde con las 10 tools ejercitadas por el plugin"

### S3 — Camino legacy de Laravel fuera del singleton o retirado
- **Status**: pending
- **Files**: `packages/frameworks/laravel/*`
- **Gate**: test
- acceptance:
  - "El camino legacy de Laravel no cae al singleton; recibe contexto como el resto o se retira con su último caller"
  - "Si se retira, queda escrito en la propuesta qué lo sustituye"

### S4 — Encoger la lista `debt` y, si queda vacía, quitar la cola
- **Status**: pending
- **Files**: `scripts/gates/lint-project-context.script.ts`,
  `packages/core/discovery/paths.service.ts`
- **Gate**: lint
- acceptance:
  - "`lint:project-context` declara 0 `debt` o cada entrada restante tiene motivo nuevo verificado"
  - "Si la lista queda vacía: la cola de serialización (`queue`, `depth`) sale de `paths.service.ts` y los tests de concurrencia pasan sin ella"

## acceptance

- "`bun run lint:project-context` muestra 3 → 0 (o motivo nuevo) lectores en `debt`"
- "Dos consumidores en el mismo proceso pueden analizar proyectos distintos sin depender de la cola"
- "`bun run validate` verde al cierre con la cadena completa"
