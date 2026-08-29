---
id: p00033
title: "p00033 — I/O asíncrono con concurrencia acotada en el pipeline de escaneo"
kind: refactor
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00024
    - p00030 # el motor de AST cambiará dónde se va el 80% restante
---

> **Cerrada el 2026-08-07.** Con dos correcciones sobre lo que decía: la
> mitad del trabajo ya estaba hecha, y el número que prometía no era
> alcanzable. Las dos salieron de medir antes de tocar nada, que es lo
> que esta propuesta no había hecho.

# p00033 — I/O asíncrono con concurrencia acotada en el pipeline de escaneo

## Goal

~~Reemplazar todas las llamadas síncronas de I/O … reduciendo el tiempo
de escaneo en proyectos grandes (>500 archivos) en un factor ≥2×.~~

**Corregido tras medir**: leer los ficheros en paralelo con tope, que es
9-12× más rápido *en la lectura*, y por tanto ~1,5× en el total. El 2×
no era posible y el resto de este documento explica por qué.

## lo que se midió antes de tocar nada

Proyecto Express sintético de 1000 ficheros (500 de rutas, 500 de ruido),
mediana de tres pasadas tras una de calentamiento. Reproducible con
`bun run bench:scan`.

**1. Las premisas ya no eran ciertas.** La propuesta decía que
`source-scan.helper.ts` y `fs-walk.helper.ts` hacían lecturas síncronas
en bucles. Al abrirlos:

- `fs-walk.helper.ts` ya era asíncrono (lo reescribió el arreglo del
  bucle de enlaces simbólicos).
- `source-scan.helper.ts` no hace **ninguna** I/O: es manipulación de
  cadenas.
- `readFileSync` no aparecía en ningún camino caliente.

Lo que sí quedaba, y la propuesta no nombraba, era el patrón repetido en
los dieciocho scanners: `for (const f of files) { await readFile(f) }`.
Una lectura cada vez, esperando al disco antes de pedir la siguiente.

**2. La lectura no era el cuello de botella.**

| | 1000 ficheros |
| --- | --: |
| Lectura una a una | 98 ms |
| Lectura en paralelo (tope 16) | 8 ms |
| **Pipeline completo** | **746 ms** |

La lectura era el **13-19%** del total. Hacerla doce veces más rápida no
puede dar 2× por mucho que se optimice: el 80% restante es parseo, y ahí
no hay disco que valga. Prometer un factor sin medir de dónde sale el
tiempo es cómo se acaba tocando dieciocho ficheros para nada.

**3. No hay nada cuadrático.** Se comprobó de 250 a 2000 ficheros: el
coste por fichero es plano (~600 µs). La arquitectura aguanta; el
problema era de constante, no de forma.

## resultado

| | antes | después |
| --- | --: | --: |
| Lectura (1000 ficheros) | 98 ms | 8 ms (**12×**) |
| Pipeline (1000 ficheros) | 746 ms | 487 ms (**1,5×**) |

## slices

### S1 — el helper de lectura acotada
- **Estado**: done (2026-08-07)
- **Ficheros**: `packages/core/helpers/read-files.helper.ts` (nuevo),
  `tests/core/read-files.helper.spec.ts` (nuevo).

`readFilesInOrder(paths, limit)` es un generador con ventana deslizante.
Tres propiedades que los scanners dan por hechas:

- **Orden de entrada**, no de llegada. Los scanners construyen la
  colección recorriendo ficheros; si el orden bailara, la colección
  saldría distinta en cada ejecución.
- **Memoria acotada**: como mucho `limit` ficheros en vuelo, no diez mil.
  Por eso es un generador y no un `Promise.all` sobre la lista entera —
  que además agotaría los descriptores de fichero.
- **Un fichero ilegible no tumba el escaneo**, igual que hacía el
  `try/catch` de cada scanner.

### S2 — migrar los barridos
- **Estado**: done (2026-08-07)
- **Ficheros**: los scanners de `express`, `fastapi`, `fastify`, `hono`,
  `fiber`, `ktor`, `rust`.
- **Gate**: `bun run validate` verde.

Son los que **barren todos los ficheros fuente del proyecto**, o sea
donde el número crece con el tamaño del proyecto. Express, además,
cambia de forma: `parseModule(file)` pasa a `parseModule(file, raw)`, y
la lectura sube al llamador. Es lo que permite pedirlos en paralelo.

### S3 — los recorridos en grafo se quedan como están
- **Estado**: no se hace, y a propósito.

Los de `django`, `symfony`, `flask`, `nestjs` y `nextjs` no barren: van
siguiendo referencias (`include()` de urls.py, el controlador que nombra
una ruta YAML, el DTO que nombra una firma). Leen un puñado de ficheros
en un orden que **depende de lo que acaban de leer**, así que
paralelizarlos no es cambiar un bucle: es reordenar un recorrido de
grafo. Mucho riesgo y poco premio — no es ahí donde crece el número de
ficheros.

Si algún día pesan, lo que hay que mirar primero es el 80% de parseo
(p00030), no estas lecturas.

### S4 — el benchmark
- **Estado**: done (2026-08-07)
- **Ficheros**: `scripts/gates/bench-scan.script.ts` (nuevo),
  `package.json` (`bench:scan`).

Los ejemplos del repo son de 2 a 14 ficheros: no sirven para medir nada.
El script **genera** un proyecto sintético del tamaño que se le pida,
separa el coste de lectura del total, y avisa si el coste por fichero
deja de ser plano (que sería algo cuadrático). Existe para que la
siguiente afirmación sobre rendimiento salga de un número y no de una
intuición, como la de esta misma propuesta.

## acceptance

- Cero `readFileSync` en helpers calientes. ✔ (ya lo estaba)
- `bun run validate` verde sin regresiones. ✔ 1571 tests, 19/19 ejemplos.
- ~~Benchmark mostrando mejora ≥2×~~ → **1,5× en el total y 12× en la
  lectura**, medido y reproducible con `bun run bench:scan`. El 2× no era
  alcanzable porque la lectura nunca fue más del 19% del trabajo.
