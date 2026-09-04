---
id: x00002
title: "Durabilidad: ninguna escritura del producto es atómica"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Cerrada 2026-08-08.** Las ocho escrituras durables pasan por
> `atomic-write.helper` (temporal + `rename`), y `lint:durable-writes`
> impide la novena. `init` deja además de escribir de forma síncrona.
> Comprobado devolviendo un `writeFile` crudo a `generate` y viendo
> romper el gate.

# x00002 — Durabilidad: ninguna escritura del producto es atómica

## Goal

Que ningún fallo a mitad de escritura pueda destruir una colección que ya estaba bien: o se escribe entera, o se queda la anterior.

## why

Hallazgo 2 (FATAL) de a00001. Trazadas todas las escrituras durables de `packages/core` y `packages/cli`: `generate` (3 sitios), `watch` (2), `enrich` (1), `init` (2, además síncronas). Ninguna usa fichero temporal + rename; no hay un solo `rename(` en el árbol. `writeFile` sobre una ruta existente trunca primero y escribe después, y entre esos dos momentos el fichero está a medias — si el proceso muere ahí, la colección queda truncada, y un JSON truncado no es una colección incompleta: es un fichero que Postman no abre. El caso serio es `watch`, que reescribe la colección en cada cambio del proyecto mientras el flujo que documenta el README es tenerla importada en Postman. Cada guardado es una ventana para leer un JSON a medio escribir, y el producto entero de esta herramienta es ese fichero.

## non-goals

- Bloqueo entre procesos: dos `generate` a la vez sobre la misma salida es un caso que no se ha visto y que el rename ya deja consistente
- `fsync` por defecto: cuesta latencia real en `watch` y protege de un corte de corriente, no de un fallo del proceso, que es lo que sí pasa

## Slices

- global_gate: e2e

### S1 — El helper de escritura atómica, con su test
- **Status**: done
- **Files**: `packages/core/helpers/atomic-write.helper.ts`, `tests/core/atomic-write.helper.spec.ts`
- **Gate**: type
- acceptance:
  - "Escribe en un temporal **del mismo directorio** y renombra: un `rename` entre sistemas de ficheros no es atómico y falla con EXDEV"
  - "El temporal se borra si la escritura falla, sin dejar basura al lado de la colección"
  - "Un test escribe encima de un fichero válido con un contenido que falla a mitad y comprueba que el original sigue intacto y sigue siendo JSON válido"

### S2 — Todos los comandos que escriben pasan por él
- **Status**: done
- **DependsOn**: [S1]
- **Files**: `packages/cli/commands/generate.script.ts`, `packages/cli/commands/watch.script.ts`, `packages/cli/commands/enrich.script.ts`, `packages/cli/commands/init.script.ts`
- **Gate**: e2e
- acceptance:
  - "Los 8 sitios que hoy llaman a `writeFile`/`writeFileSync` usan el helper"
  - "`init` deja de escribir de forma síncrona"
  - "Los 21 ejemplos siguen generando colección válida"

### S3 — Gate que prohíba la escritura cruda
- **Status**: done
- **DependsOn**: [S2]
- **Files**: `scripts/gates/lint-durable-writes.script.ts`, `tests/cli/durable-writes.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "El lint falla si aparece un `writeFile` directo sobre una ruta de salida fuera del helper"
  - "Los sitios legítimos (el propio helper, los tests que preparan fixtures) quedan declarados, no adivinados"
  - "Se comprueba devolviendo un `writeFile` crudo a `generate` y viendo romper el gate"

## acceptance

- Escribe en un temporal **del mismo directorio** y renombra: un `rename` entre sistemas de ficheros no es atómico y falla con EXDEV
- El temporal se borra si la escritura falla, sin dejar basura al lado de la colección
- Un test escribe encima de un fichero válido con un contenido que falla a mitad y comprueba que el original sigue intacto y sigue siendo JSON válido
- Los 8 sitios que hoy llaman a `writeFile`/`writeFileSync` usan el helper
- `init` deja de escribir de forma síncrona
- Los 21 ejemplos siguen generando colección válida
- El lint falla si aparece un `writeFile` directo sobre una ruta de salida fuera del helper
- Los sitios legítimos (el propio helper, los tests que preparan fixtures) quedan declarados, no adivinados
- Se comprueba devolviendo un `writeFile` crudo a `generate` y viendo romper el gate
