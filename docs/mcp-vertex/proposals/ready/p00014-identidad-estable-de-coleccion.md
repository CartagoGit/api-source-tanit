---
id: p00014
title: "p00014 — identidad estable de colección por proyecto"
kind: fix
status: done
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00017 # paths.service singleton — misma raíz del problema
---

> **Cerrada 2026-08-06.** UUID v5 determinista para colecciones y environments,
> `collectionId` opcional en `ProjectConfig` y aviso de colisión de nombres.
> Verificado: dos ejecuciones del mismo proyecto dan el mismo id; proyectos
> distintos, ids distintos.

# p00014 — identidad estable de colección por proyecto

## Goal

Que `info._postman_id` sea **determinista por proyecto** y distinto entre
proyectos, de modo que:

- Regenerar y re-importar el **mismo** proyecto **actualice** la colección
  existente en Postman en lugar de crear una copia.
- Importar dos proyectos **distintos** produzca siempre dos colecciones
  separadas, nunca una fusión.

## why

Medido hoy, generando dos veces el mismo proyecto sin tocar nada:

```
run1  example-express.postman_collection.json  id=bdca0bc1-18e8-4bb0-a59b-297a600ccfd3
run2  example-express.postman_collection.json  id=5b525031-c526-4d7c-980d-197f8fcd20c0
```

`collection-builder.service.ts` llama a `crypto.randomUUID()` en cada
build. Postman usa `info._postman_id` como clave de identidad al importar:
con un UUID nuevo cada vez, **cada regeneración deja una colección más**
en el workspace. Tras una semana de trabajo el usuario tiene quince
copias de la misma API y no sabe cuál está viva.

El otro lado del problema es el nombre. Sin `--basename`, el nombre sale
de `projectBasename()`, que depende del singleton de `paths.service`
(ver p00017). Dos proyectos con el mismo nombre de carpeta
(`backend/`, `api/`… muy común) colisionan.

## non-goals

- Hablar con la API de Postman para sincronizar. El artefacto sigue
  siendo un fichero que el usuario importa a mano.
- Cambiar el formato de salida. Sigue siendo Postman v2.1.0 estricto.
- Renombrar los ficheros de environment. Solo la identidad de la
  colección.

## slices

### S1 — UUIDv5 determinista desde la identidad del proyecto
- **Files**: `helper/collection-identity.helper.ts` (nuevo),
  `service/collection-builder.service.ts`, `contract/project-config.interface.ts`.
- **Gate**: `bun test tests/unit/collection-identity.helper.spec.ts`.

- Nueva función `collectionIdFor(seed: string): string` que produce un
  UUID v5 (namespace fijo del paquete) a partir de una semilla estable.
- La semilla se toma, en orden de preferencia:
  1. `config.collectionId` si el host lo declara explícitamente.
  2. `config.collectionName` normalizado.
  3. El nombre de la carpeta del proyecto + el nombre del framework.
- `buildCollection` usa `collectionIdFor(seed)` en vez de
  `crypto.randomUUID()`.
- **Acceptance**:
  - Generar dos veces el mismo proyecto produce el mismo `_postman_id`.
  - Generar dos proyectos distintos produce IDs distintos.
  - Un test verifica que el ID es un UUID v5 sintácticamente válido
    (Postman rechaza IDs mal formados).

### S2 — `collectionId` explícito en `ProjectConfig`
- **Files**: `contract/project-config.interface.ts`,
  `service/project-loader.service.ts`, `scripts/init.script.ts`.
- **Gate**: `bun test tests/unit/project-loader.spec.ts`.

- Añadir `collectionId?: string` al `ProjectConfig`, documentado como
  "fíjalo si mueves el proyecto de carpeta y quieres conservar la
  colección en Postman".
- `scripts/init.script.ts` lo escribe con un valor generado la primera vez.
- **Acceptance**: mover la carpeta del proyecto con `collectionId` fijado
  sigue produciendo el mismo ID.

### S3 — aviso de colisión
- **Files**: `scripts/generate.script.ts`.
- **Gate**: manual + test unitario del helper de detección.

- Si el `outputDir` ya contiene una colección con el **mismo nombre** pero
  **distinto** `_postman_id`, avisar por stderr: significa que dos
  proyectos distintos van a competir por el mismo hueco en Postman.
- **Acceptance**: el aviso aparece y sugiere fijar `collectionId`.

## acceptance

- Regenerar N veces el mismo proyecto → siempre el mismo `_postman_id`.
- Importar 11 ejemplos distintos → 11 colecciones separadas en Postman,
  cero fusiones.
- Documentado en el README junto al flujo de import.
