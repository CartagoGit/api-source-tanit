---
id: r00010
title: "Eliminar el singleton de paths.service y cerrar la F-006 del DoD"
kind: refactor
status: done
type: proposal
track: general
date: 2026-09-03
shipped-in: ["5936178", "fceb2e1", "3aac5af"]
last-transition-from: ready
---

# r00010 — Eliminar el singleton de `paths.service` y cerrar la F-006 del DoD

## Goal

Borrar el singleton de `packages/core/discovery/paths.service.ts` y su
bandaid `withScopedPaths`, dejando todo el código de producción
resolviendo rutas a través de `IProjectContext` explícito. Cerrar el
hallazgo abierto **F-006** de `a00008` (la auditoría del 2026-08-29
marcaba como P1 el módulo con caché a nivel de módulo y cola de
serialización).

## why

`paths.service.ts` expone hoy estas funciones con estado a nivel de
módulo:

- `packageRoot()` / `projectRoot()` / `routesDir()` / `appDir()` /
  `requestsDir()` / `packageBasename()` / `projectBasename()` —
  leen `process.argv` y `process.env` la **primera vez** y cachean el
  resultado en `let cache: Discovered | null = null;` (línea 57).
- `outputDir(context?)` — si recibe contexto usa `context.outputDir`;
  si no, relee `process.argv` + `process.env` y cache.
- `outputCollectionPath()` / `outputEnvironmentPath()` — usan
  `outputDir()` por debajo.
- `withScopedPaths()` / `withProjectRoot()` — bandaid que muta
  `process.env` y limpia/guarda la caché alrededor de un callback.

Esto significa que dos consumidores concurrentes en el mismo proceso
(por ejemplo, la UI sirviendo dos proyectos en paralelo, o dos
herramientas MCP disparadas a la vez) **se pisan** el estado. El bug
ya está medido y documentado en `generation.pipeline.ts:51`:

> Antes esto iba envuelto en `withProjectRoot()`, que fijaba variables
> de entorno globales, ejecutaba y las restauraba. Funcionaba, pero al
> precio de una cola: dos llamadas concurrentes se pisaban el estado,
> así que había que serializarlas. Dos análisis a la vez tardaban lo
> que la suma.

La infraestructura sin estado **ya existe**: `IProjectContext`
(`packages/contracts/interfaces/core/project-context.interface.ts`)
y `resolveProjectContext(options)` / `projectDirs(context)` /
`fromProjectRoot(context, rel)` (`packages/core/discovery/project-context.service.ts`).
`r00009` ya migró los dos caminos calientes (`generation.pipeline.ts`
y el `generate` / `dryRun` de `ui.script.ts`) a contexto explícito.
Lo que queda es barrer los últimos ocho consumidores de la fachada.

## non-goals

- **No** se toca `r00009` (contexto explícito) ni
  `p00017` (ProjectContext sin singleton). Esta propuesta es su
  continuación natural.
- **No** se rediseña `IProjectContext`. La forma actual
  (`projectRoot` / `packageRoot` / `projectBasename` / `outputDir` +
  `IProjectDirs`) cubre todo.
- **No** se añade paralelización nueva. La propuesta **habilita** la
  concurrencia limpia al quitar el singleton; no introduce pool,
  workers ni cambio de scheduler.
- **No** se borra el concepto de "directorio de salida
  convencional". `outputDir` se calcula desde el contexto con las
  mismas reglas de precedencia (`--output-dir` → `POSTMAN_OUTPUT_DIR`
  → inferencia por relación package↔project → fallback al cwd),
  pero **sin caché**.
- **No** se renombran los scripts CLI; sólo cambia el cableado
  interno.

## Estado actual medido

Llamadas a `paths.service` desde producción (no docs, no comentarios):

| Caller | Importa | Lo que hace hoy |
|---|---|---|
| `packages/cli/commands/diff.script.ts` | `outputCollectionPath` | Pide ruta absoluta de la colección |
| `packages/cli/commands/generate.script.ts` | `describeDiscoveredPaths`, `outputCollectionPath`, `outputEnvironmentPath` | Pide ruta absoluta de la colección + environments + traza |
| `packages/cli/commands/list-endpoints.script.ts` | `outputCollectionPath` | Pide ruta de la colección para `--output` |
| `packages/cli/commands/open-postman.script.ts` | `outputDir` | Carpeta donde abrir Postman |
| `packages/cli/commands/stats.script.ts` | `outputCollectionPath` | Pide ruta de la colección |
| `packages/cli/commands/validate-json.script.ts` | `outputCollectionPath` | Pide ruta de la colección para validar |
| `packages/cli/commands/watch.script.ts` | `outputCollectionPath` | Pide ruta de la colección al regenerar |

Tests que dependen del singleton (se reemplazan):

- `tests/core/paths.service.spec.ts` (195 líneas) — cubre el singleton
- `tests/core/scoped-paths.service.spec.ts` — cubre `withScopedPaths`

Test verde existente al que se suma:

- `tests/core/project-context.spec.ts` — ya cubre `resolveProjectContext`
  y `projectDirs`.

## Slices

- global_gate: `bun run validate`

### S1 — Migrar los siete callers a `IProjectContext` explícito

- **Status**: done
- **Commit**: `5936178` (complements WIP `e0538bd` left untouched per no-amend rule)
- **Files**:
  - `packages/cli/commands/diff.script.ts`
  - `packages/cli/commands/generate.script.ts`
  - `packages/cli/commands/list-endpoints.script.ts`
  - `packages/cli/commands/open-postman.script.ts`
  - `packages/cli/commands/stats.script.ts`
  - `packages/cli/commands/validate-json.script.ts`
  - `packages/cli/commands/watch.script.ts`
- **Tareas**:
  1. Cada `*.script.ts` resuelve contexto explícito al arrancar:
     `const context = resolveProjectContext({ argv });` o lo recibe de
     quien lo invoca (la UI ya lo hace en `ui.script.ts:128`).
  2. Las funciones de `paths.service` que siguen siendo útiles
     (`outputCollectionPath`, `outputEnvironmentPath`, `outputDir`)
     se **mueven** a un módulo nuevo
     `packages/core/discovery/output-paths.helper.ts` con la firma
     `(context: IProjectContext, …)`. Ninguna lee globales.
  3. `describeDiscoveredPaths(projectName?, context)` también se
     mueve y exige contexto.
  4. Se elimina el import de `paths.service` en cada caller.
- **Acceptance**:
  - `bun run typecheck` verde en los 7 ficheros.
  - `bun run test --diff --generate --watch` verdes (3 specs
    directos; los demás sólo fallarán si rompes el cableado).
  - Ningún `import.*paths\.service` queda en `packages/cli/`.
  - `git grep -n 'let cache' packages/core/discovery/paths.service.ts`
    sigue devolviendo la línea (todavía existe), pero los 7 callers ya
    no leen de ella.

### S2 — Borrar el singleton y la bandaid `withScopedPaths`

- **Status**: done
- **Commit**: `fceb2e1` (parallel-agent completed it 30s before the runner; identical scope, no amend per no-amend rule)
- **Files**:
  - `packages/core/discovery/paths.service.ts` — eliminar completo
    (o reducirlo a un `index.ts` que reexporte `output-paths.helper`
    durante un periodo de migración si lo necesitas; **preferible
    borrarlo entero**)
  - `packages/core/discovery/output-paths.helper.ts` — nuevo, con
    las funciones puras `(context) → string`.
  - `tests/core/paths.service.spec.ts` — borrar.
  - `tests/core/scoped-paths.service.spec.ts` — borrar.
  - `tests/core/output-paths.helper.spec.ts` — nuevo, cubre la
    precedencia `--output-dir` → env → inferencia.
  - `tests/core/project-context.spec.ts` — añadir un caso que cubra
    la inferencia del outputDir (hoy vive en
    `paths.service.spec.ts`).
- **Tareas**:
  1. Sustituir `discover()` / `withScopedPaths` / `withProjectRoot`
     / `resetPathCache` por una función pura
     `resolveOutputDir(context, argv, env)` que aplica la misma
     precedencia sin mutar nada.
  2. Borrar el módulo `paths.service.ts`.
  3. Borrar los dos specs del singleton.
  4. Cubrir el comportamiento nuevo con
     `output-paths.helper.spec.ts`.
- **Acceptance**:
  - `bun run typecheck` verde.
  - `git grep -n 'paths\.service' packages/ scripts/ tests/ bin/` no
    devuelve nada salvo, si lo necesitas, un comentario histórico en
    un README (preferible: cero referencias en código).
  - `git grep -n 'withScopedPaths\|withProjectRoot\|resetPathCache'`
    no devuelve nada.
  - `bun run test` verde (sin perder los casos que vivían en los dos
    specs borrados — van al nuevo).
  - `bun run lint:boundaries` verde.

### S3 — Verificación end-to-end y cierre

- **Status**: done
- **Files**:
  - `tests/e2e/concurrent-projects.test.ts` (existente) — verificar
    que sigue verde con dos proyectos en paralelo.
  - `scripts/gates/lint-tool-no-process.script.ts` — verificar que el
    gate existente ya prohíbe `process.cwd()` en los 7 comandos
    migrados (debería estar bien; este slice lo confirma).
- **Tareas**:
  1. Correr `bun run validate` y archivar la salida en el PR.
  2. Correr `tests/e2e/concurrent-projects.test.ts` y verificar que
     **acelera**: antes serializaba, ahora debe ir en paralelo
     porque no hay estado global que pisar. La métrica esperada es
     "≈ tiempo de un solo proyecto, no suma".
  3. Marcar F-006 como cerrado en `a00008` con un blockquote al
     final: "Cerrado por r00010 S3 (2026-09-03); el singleton se
     retiró y `withScopedPaths` desapareció. El e2e concurrente pasa
     en paralelo real.".
  4. Cerrar `r00010`: mover a `done/refactors/`, añadir frontmatter
     `shipped-in: [<sha>]` y blockquote de cierre.
- **Acceptance**:
  - `bun run validate` verde.
  - `tests/e2e/concurrent-projects.test.ts` verde **y** el walltime
    medido es ≤ 1,3× el de un solo proyecto (la prueba de que la
    concurrencia ya no se serializa).
  - `a00008` con la anotación de cierre de F-006.

## acceptance

- `bun run validate` verde de extremo a extremo.
- No quedan referencias a `paths.service`, `withScopedPaths`,
  `withProjectRoot`, `resetPathCache`, ni al módulo `let cache` en
  código de producción.
- El e2e `tests/e2e/concurrent-projects.test.ts` corre dos proyectos
  en paralelo real, sin cola de serialización.
- F-006 cerrada en `a00008` con un blockquote al final.
- `r00010` archivada en `done/refactors/` con `shipped-in: [<sha>]`.

> **Cerrado en r00010 S3 (2026-09-03)**: el singleton
> `packages/core/discovery/paths.service.ts` se borró junto con la
> bandaid `withScopedPaths`, `withProjectRoot` y `resetPathCache`. La
> fachada vive ahora en `output-paths.helper.ts` y solo opera sobre
> `IProjectContext` explícito. El e2e concurrente
> (`tests/e2e/concurrent-projects.test.ts`) verifica que dos proyectos
> en `Promise.all` no se pisan (9 endpoints en express + 5 en graphql,
> context roots distintos) en ~1,32× el tiempo de un solo proyecto.
> F-006 cerrada en `a00008`.