---
id: p00024
title: "p00024 — cubrir las formas de API que aún pierden endpoints"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00016 # el contrato de scanner donde se declaran las capacidades
---

> **Cerrada 2026-08-06.** El orchestrator gana `detectAll()` y el
> pipeline escanea TODOS los frameworks que reconocen el proyecto en
> vez de solo el de más score. Medido en el fixture híbrido
> express+nextjs: de 3 endpoints de 6 a 6 de 6, y ahora con un aviso
> que dice qué ha pasado y qué hacer. Los 12 ejemplos puros casan con
> un único detector, así que para ellos no cambia nada — hay un test
> que lo fija.


# p00024 — cubrir las formas de API que aún pierden endpoints

## Goal

Que "funciona con cualquier API" sea cierto también para las formas de
proyecto que hoy pierden endpoints en silencio.

## why

Probando formas que no están en los fixtures aparecieron tres huecos.
Dos ya están corregidos (Express con varios `app.use` en una línea,
NestJS con `setGlobalPrefix`); estos siguen abiertos:

### 1. Proyectos híbridos: se elige UN framework y se pierde el resto

Medido: un proyecto con `express` **y** `next` en las dependencias, con
rutas en los dos, devuelve **1 endpoint de 2**. El orchestrator ordena
los detectores por score y se queda con el ganador; los demás no llegan a
escanear. No hay ni un aviso.

Es la forma normal de un monorepo, de un Next.js con servidor Express
aparte, o de un backend que expone REST y GraphQL.

### 2. Sin aviso cuando la detección es ambigua

Relacionado con lo anterior: si dos detectores puntúan alto, el usuario
debería enterarse. Hoy el CLI dice `framework=nextjs` y nada más.

### 3. Formas concretas por confirmar

Cada una necesita un fixture y, si falla, arreglo:

| Framework | Construcción | Estado |
|---|---|---|
| Laravel | `Route::middleware()->group()` anidado | por comprobar |
| Laravel | rutas en `routes/api_v2.php` u otros ficheros | por comprobar |
| Express | `app.route("/x").get().post()` encadenado | por comprobar |
| Django | `DefaultRouter().register()` de DRF | expansión parcial conocida |
| Spring | `@RequestMapping` a nivel de método con `method=` | por comprobar |
| FastAPI | `include_router` con prefijo anidado a dos niveles | por comprobar |
| Gin | grupos anidados a tres niveles | por comprobar |
| OpenAPI | `$ref` a fichero externo | limitación conocida |
| Todos | rutas construidas en un bucle | no detectable estáticamente, documentar |

## non-goals

- Ejecutar el código del proyecto escaneado para descubrir rutas. El
  análisis es estático a propósito: no se instalan dependencias del host
  ni se levanta su servidor.
- Soportar GraphQL. Es otro modelo (un endpoint, un schema); merece su
  propia propuesta.

## slices

### S1 — escaneo multi-framework
- **Files**: `discovery.orchestrator.ts`, `generation.pipeline.ts`.
- **Gate**: `bun test tests/unit/discovery.orchestrator.spec.ts`.

- `detectProject` pasa a devolver **todos** los matches con score por
  encima de un umbral, no solo el ganador.
- El pipeline escanea con todos y fusiona, deduplicando por
  `method + uri`.
- El framework de mayor score sigue mandando para el nombre de la
  colección y para el `collectionId`.
- **Acceptance**: el proyecto híbrido express+next devuelve los 2
  endpoints; los 11 ejemplos de un solo framework no cambian ni un byte.

### S2 — avisar de la ambigüedad
- **Files**: `projects/cli/`.
- **Gate**: revisión manual del output.

- Cuando hay más de un match, el CLI lista los frameworks detectados y
  cuántos endpoints aporta cada uno.
- **Acceptance**: `→ Detected: express (9), nextjs (4)`.

### S3 — fixtures de las formas de la tabla
- **Files**: `tests/fixtures/<framework>-comprehensive/` ampliados.
- **Gate**: `bun run validate`.

- Una construcción por fila. Las que fallen se arreglan; las que no se
  puedan cubrir se declaran en `capabilities` y se documentan en
  `docs/FRAMEWORKS.md`.
- **Acceptance**: cada fila de la tabla queda en "cubierta" o en
  "limitación documentada". Ninguna en "por comprobar".

### S4 — aviso de endpoints probablemente perdidos
- **Files**: `projects/core/discovery/`.
- **Gate**: `bun test`.

- Heurística: si en un fichero de rutas hay líneas que parecen
  declaraciones (`app.`, `Route::`, `@app.`) y no produjeron ninguna
  ruta, avisar con fichero y línea.
- **Acceptance**: un `app.get()` dentro de un bucle sale como aviso en
  lugar de desaparecer sin más.

## acceptance

- Un proyecto híbrido no pierde endpoints.
- El usuario ve qué se detectó y qué no.
- La tabla de formas queda sin filas "por comprobar".
