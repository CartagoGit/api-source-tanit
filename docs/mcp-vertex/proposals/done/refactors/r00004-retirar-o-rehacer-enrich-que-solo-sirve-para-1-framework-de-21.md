---
id: r00004
title: "Retirar o rehacer `enrich`, que solo sirve para 1 framework de 21"
kind: refactor
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Cerrada 2026-08-08. `enrich` se retira**, medido en vez de opinado:
> sobre `example-laravel`, el único framework que soportaba, `generate`
> solo daba 18 requests y `generate + enrich` **10**. Se llevaba por
> delante 8 de 18 en el framework para el que se escribió, y no aportaba
> las variantes que se creía —`generate` ya las trae, porque llama al
> mismo enricher—.
>
> **S1 no procedía.** La propuesta daba por hecho que `catalog-enricher`
> era genérico porque `generate` lo usa para los 21. Al moverlo,
> `lint:boundaries` falló: importa el parser de FormRequests, que es de
> Laravel. Funciona en los 21 porque en veinte el índice llega vacío y no
> hace nada. Devuelto a su sitio; partirlo de verdad es otro rediseño.

# r00004 — Retirar o rehacer `enrich`, que solo sirve para 1 framework de 21

## Goal

Decidir de una vez: o `enrich` hace para los 21 lo que hoy hace para 1, o se retira porque `generate` ya lo hace. Y mover lo que es genérico fuera de la carpeta de un framework, que es lo que hizo creer que el comando era de Laravel.

## why

Hallazgo 5 (BAD) de a00001. `enrich` descubre por el camino legacy de Laravel (`frameworks/laravel/endpoint-discovery`), no por el registro de scanners. Lanzado contra los 21 ejemplos: 1 con contenido, 20 vacíos. La pérdida de datos ya está cerrada —`a2ce484` puso la guarda y `tests/cli/enrich-command.test.ts` la cubre, después de medir que sobre `example-express` dejaba una colección de 27.514 bytes en 502 imprimiendo un ✔ y saliendo con 0—, así que esto no es urgente. Lo que queda abierto es que un comando de doce solo sirva para un framework de veintiuno, y que además duplique a `generate`: reconstruye la colección, aplica el flujo de auth y enriquece con la misma función. Es un resto de cuando esto era una herramienta solo para Laravel. Y hay un segundo resto al lado: `catalog-enricher.service.ts` vive en `frameworks/laravel/` pero lo usa `generate` para los veintiuno, así que no es de Laravel — está aparcado ahí.

## non-goals

- Quitar la guarda que impide el vaciado: se queda pase lo que pase con el comando
- Tocar el descubrimiento legacy de Laravel en sí: sigue siendo el fallback legítimo de `diff` cuando el orquestador no reconoce el proyecto

## Slices

- global_gate: e2e

### S1 — Sacar de `frameworks/laravel/` lo que no es de Laravel
- **Status**: pending
- **Files**: `projects/core/domain/catalog-enricher.service.ts`, `projects/frameworks/laravel/catalog-enricher.service.ts`, `projects/cli/commands/generate.script.ts`, `tests/core/catalog-enricher.service.spec.ts`
- **Gate**: e2e
- acceptance:
  - "`catalog-enricher` vive donde corresponde a algo que usan los 21 frameworks"
  - "`generate` deja de importar de `frameworks/laravel/`"
  - "`lint:boundaries` sigue verde y los 21 ejemplos también"

### S2 — La decisión, medida en vez de opinada
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `docs/mcp-vertex/proposals/ready/DECISION-enrich.md`
- **Gate**: none
- acceptance:
  - "Escrito qué hace `enrich` que `generate` no haga, comando a comando y con la salida delante"
  - "Si no hace nada distinto: se retira, y la propuesta lo dice con esa evidencia"
  - "Si hace algo distinto: se nombra, y ese algo es lo único que sobrevive"

### S3 — Ejecutar la decisión
- **Status**: pending
- **DependsOn**: [S2]
- **Files**: `projects/cli/commands/enrich.script.ts`, `projects/cli/cli.script.ts`, `tests/cli/enrich-command.test.ts`, `docs/INSTALL.md`, `README.md`
- **Gate**: e2e
- acceptance:
  - "Si se retira: desaparece del CLI, del README y de `--help`, y no queda un comando fantasma que alguien encuentre en un script viejo"
  - "Si se rehace: funciona en los 21 ejemplos, medido uno a uno como se midió que fallaba"
  - "`lint:docs` sigue verde: comprueba que todo comando citado existe"

## acceptance

- `catalog-enricher` vive donde corresponde a algo que usan los 21 frameworks
- `generate` deja de importar de `frameworks/laravel/`
- `lint:boundaries` sigue verde y los 21 ejemplos también
- Escrito qué hace `enrich` que `generate` no haga, comando a comando y con la salida delante
- Si no hace nada distinto: se retira, y la propuesta lo dice con esa evidencia
- Si hace algo distinto: se nombra, y ese algo es lo único que sobrevive
- Si se retira: desaparece del CLI, del README y de `--help`, y no queda un comando fantasma que alguien encuentre en un script viejo
- Si se rehace: funciona en los 21 ejemplos, medido uno a uno como se midió que fallaba
- `lint:docs` sigue verde: comprueba que todo comando citado existe
