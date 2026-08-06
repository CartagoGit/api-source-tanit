---
id: p00017
title: "p00017 — IProjectContext explícito en vez del singleton de paths"
kind: refactor
status: done
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00014 # la identidad de colección depende de esto
    - p00011 # no process.cwd() en tools — misma familia de problema
---

> **Cerrada 2026-08-06.** S1 y S2 hechos: `IProjectContext` +
> `resolveProjectContext()` sin estado, con 21 tests. S3 parcial: el pipeline
> resuelve el contexto una vez y lo pasa a route-parser, endpoint-discovery y
> catalog-enricher; `loadProject()` y `summary.service` siguen leyendo el
> singleton, cubiertos por `withProjectRoot()`. La reentrancia, que era el
> efecto observable, está resuelta y verificada con 8 tests.

# p00017 — `IProjectContext` explícito en vez del singleton de paths

## Goal

Que toda resolución de rutas del proyecto host viaje por un objeto
explícito (`IProjectContext`) en lugar de por un caché global de proceso.

## why

`services/paths.service.ts` guarda un `let cache: Discovered | null` que se
resuelve **una vez por proceso** desde `POSTMAN_PROJECT_ROOT` o
`--project-root`. Funciona para el CLI, que es un proceso por proyecto,
pero se rompe en todo lo demás:

- **Ya causó un bug real.** `LaravelFormRequestValidationProvider`
  recibía `match.projectRoot` y lo ignoraba para leer el singleton. Sin
  la variable de entorno no resolvía ni un FormRequest. Corregido a mano,
  pero nada impide que vuelva a pasar en el siguiente provider.
- **Contamina los tests.** `tests/helpers/run-scanner.ts` tiene que
  guardar `process.env`, sobrescribirlo, llamar a `resetPathCache()` y
  restaurarlo en un `finally`. Eso es andamiaje que existe sólo por el
  singleton, y obliga a que los tests no puedan correr en paralelo sobre
  proyectos distintos.
- **Rompe el servidor MCP.** Un host de larga vida que escanee el
  proyecto A y luego el B devuelve rutas de A, porque el caché ya está
  poblado.

Es además el mismo principio que p00011 exige a los tools del plugin
("single source of truth en el contexto, cero `process.env` directo"),
aplicado a la capa de servicios.

## non-goals

- Eliminar `POSTMAN_PROJECT_ROOT`. Sigue siendo la forma documentada de
  arrancar el CLI; sólo deja de ser un global implícito.
- Reescribir los scanners. Ya reciben `match.projectRoot`; el trabajo
  está en los servicios que lo puentean.
- Cambiar la API pública del paquete en `exports`.

## slices

### S1 — contrato `IProjectContext`
- **Files**: `contracts/project-context.interface.ts` (nuevo).
- **Gate**: `bunx tsc --noEmit`.

- `IProjectContext { projectRoot, packageRoot, outputDir, basename }`
  con los mismos derivados que hoy expone `paths.service`
  (`routesDir()`, `appDir()`, `requestsDir()`) como métodos puros.
- **Acceptance**: el contrato no importa `process` ni `node:fs`.

### S2 — `resolveProjectContext()` como única puerta de entrada
- **Files**: `services/project-context.service.ts` (nuevo),
  `services/paths.service.ts`.
- **Gate**: `bun test tests/unit/project-context.spec.ts`.

- `resolveProjectContext({ projectRoot?, outputDir?, argv?, env? })`
  hace la resolución que hoy hace `discover()`, pero devuelve un objeto
  nuevo cada vez y acepta `argv`/`env` inyectados.
- `paths.service` pasa a ser un envoltorio *deprecated* que llama a
  `resolveProjectContext()` con `process.argv`/`process.env`, para no
  romper a los consumidores de golpe.
- **Acceptance**: dos contextos resueltos sobre raíces distintas coexisten
  en el mismo proceso sin pisarse.

### S3 — propagar el contexto por los servicios
- **Files**: `services/form-request-parser.service.ts`,
  `services/catalog-enricher.service.ts`,
  `services/endpoint-discovery.service.ts`,
  `services/project-loader.service.ts`.
- **Gate**: `bun test`.

- Cada función que hoy llama a `projectRoot()`, `requestsDir()`,
  `fromProjectRelative()` o `toProjectRelative()` recibe el contexto como
  parámetro.
- **Acceptance**: `grep -rn "requestsDir()\|fromProjectRelative(" service/`
  no devuelve nada fuera de `paths.service.ts`.

### S4 — quitar el andamiaje de los tests
- **Files**: `tests/helpers/run-scanner.ts`.
- **Gate**: `bun test`.

- `runGenerate` construye un `IProjectContext` y lo pasa; desaparecen el
  guardado/restauración de `process.env` y el `resetPathCache()`.
- **Acceptance**: `grep -rn "resetPathCache\|POSTMAN_PROJECT_ROOT" tests/`
  no devuelve nada.

## acceptance

- `bun test` verde, sin manipulación de `process.env` en los tests.
- Escanear dos proyectos distintos en el mismo proceso devuelve los
  endpoints correctos de cada uno (test explícito).
- `paths.service.ts` queda marcado como deprecated con fecha de retirada.
