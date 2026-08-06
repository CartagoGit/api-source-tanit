---
id: p00033
title: "p00033 — I/O asíncrono con concurrencia acotada en el pipeline de escaneo"
kind: refactor
status: ready
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00024
---

# p00033 — I/O asíncrono con concurrencia acotada en el pipeline de escaneo

## Goal

Reemplazar todas las llamadas síncronas de I/O (`readFileSync`, `existsSync`
en bucles calientes) por operaciones asíncronas con concurrencia acotada,
reduciendo el tiempo de escaneo en proyectos grandes (>500 archivos) en un
factor ≥2×.

## why

Los helpers `source-scan.helper.ts` y `fs-walk.helper.ts` actualmente hacen
lecturas síncronas dentro de bucles de recorrido de directorios. En un proyecto
con 1000 archivos fuente, cada `readFileSync` bloquea el event loop. Cambiar
a `readFile` de `node:fs/promises` con un pool de concurrencia (p.ej.
`Promise.all` con chunk size o un semáforo tipo `p-limit`) aprovechará el I/O
del kernel sin sobrecargar el file descriptor limit.

## non-goals

- Eliminar `existsSync` en código de arranque (boot-time). Solo afecta a
  bucles calientes de escaneo.
- Usar worker threads. El cuello de botella es I/O, no CPU.

## slices

### S1 — `fs-walk.helper.ts` asíncrono
- **Files**: `helpers/fs-walk.helper.ts`.
- **Gate**: `bun test tests/core/fs-walk.spec.ts`.
- `walkDir` devuelve un `AsyncGenerator<string>` en lugar de un array
  síncrono. Los consumidores migran a `for await`.

### S2 — `source-scan.helper.ts` asíncrono con pool de concurrencia
- **Files**: `helpers/source-scan.helper.ts`.
- **Gate**: `bun test tests/core/source-scan.spec.ts`.
- `scanSourceFiles` usa `readFile` con un pool de máximo 16 lecturas
  paralelas. Se implementa un semáforo interno (sin dependencia externa).

### S3 — Migración de consumidores
- **Files**: todos los `*.scanner.ts` que llaman a `scanSourceFiles` o
  `walkDir`.
- **Gate**: `bun run validate` verde.
- Adaptar las firmas de los 12+ scanners para consumir las variantes
  asíncronas.

### S4 — Benchmark comparativo
- **Files**: `scripts/bench-scan.script.ts`.
- **Gate**: revisión manual del output.
- Medir antes/después en el proyecto de ejemplo más grande
  (`example-django`) y documentar la mejora.

## acceptance

- Zero `readFileSync` en helpers calientes (enforced por
  `lint-tool-no-process.ts` ampliado).
- `bun run validate` verde sin regresiones.
- Benchmark documentado mostrando mejora ≥2× en proyectos >200 archivos.
