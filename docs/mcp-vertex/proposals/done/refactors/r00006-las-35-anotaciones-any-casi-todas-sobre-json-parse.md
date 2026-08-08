---
id: r00006
title: "Las 35 anotaciones `: any`, casi todas sobre JSON.parse"
kind: refactor
status: done
type: proposal
track: export-to-postman
date: 2026-08-08
---

> **Cerrada 2026-08-08.** Cero `any` en el repo —producción y tests— y
> `lint:no-type-escapes` amplía su regla para que no vuelvan.
> `parse-json.helper` es lo que lo hizo barato: los predicados que cada
> scanner repetía a mano, en un sitio.
>
> **Lo que no se pudo demostrar**: el ciclo de `$ref` en `mergeAllOf`. La
> recursión es ilimitada por construcción, pero no se consiguió
> reproducir un cuelgue ni por YAML ni por JSON. Se le puso cota igual —
> una recursión sin cota sobre ficheros ajenos no necesita una
> reproducción para merecerla.

# r00006 — Las 35 anotaciones `: any`, casi todas sobre JSON.parse

## Goal

Que el resultado de parsear un fichero ajeno entre al código como `unknown` y se estreche una vez, en un sitio, en vez de circular como `any` por medio scanner.

## why

Hallazgo nuevo, salido al escribir el gate de r00002. Al prohibir las aserciones (`as any`, `as unknown as`, `as never`) el lint destapó otras **35 anotaciones `: any`**, nueve de ellas en scanners de producción: `nestjs`, `nextjs`, `symfony` y seis en `openapi`. Casi todas son `let parsed: any` justo antes de un `JSON.parse`, y `resolveRef(obj: any, spec: any): any | null` en el scanner de OpenAPI. Es la misma familia que ya mordió: `__params` entró exactamente así, por un punto donde el tipo dejaba de describir lo que circulaba. Y es entrada no controlada — los scanners leen manifiestos y specs de otra gente. Se dejó fuera del gate de r00002 a propósito y con la cifra medida, porque pasar de `any` a `unknown` no es sustituir una palabra: obliga a estrechar cada uso aguas abajo, y eso es un refactor con su propio riesgo, no un remate.

## non-goals

- Prohibir `any` en los fixtures: son código de otros proyectos, la entrada de los scanners
- Meter una librería de validación en el núcleo: el binario compilado no puede cargar paquetes en ejecución

## Slices

- global_gate: type

### S1 — Un lector de JSON que devuelve `unknown` y estrecha una vez
- **Status**: pending
- **Files**: `projects/core/helpers/parse-json.helper.ts`, `tests/core/parse-json.helper.spec.ts`
- **Gate**: type
- acceptance:
  - "Devuelve `unknown`, nunca `any`"
  - "Distingue "no se pudo parsear" de "parsó a null", que hoy se confunden"
  - "Trae los predicados de estrechamiento que los scanners repiten: ¿es objeto?, ¿es array de objetos?, ¿tiene esta clave string?"

### S2 — Los cuatro scanners que parsean manifiestos
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `projects/frameworks/scanners/nestjs.scanner.ts`, `projects/frameworks/scanners/nextjs.scanner.ts`, `projects/frameworks/scanners/symfony.scanner.ts`
- **Gate**: e2e
- acceptance:
  - "Cero `: any`"
  - "Un manifiesto roto da el mismo resultado en los tres, que hoy no pasa"
  - "Los 21 ejemplos siguen detectándose"

### S3 — El scanner de OpenAPI, que es el que más superficie tiene
- **Status**: pending
- **DependsOn**: [S1]
- **Files**: `projects/frameworks/scanners/openapi.scanner.ts`, `tests/frameworks/openapi-types.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cero `: any` en los seis sitios, incluido `resolveRef`"
  - "Un `$ref` circular no cuelga: hoy no hay nada que lo impida y el tipo no ayuda a verlo"
  - "Los 23 endpoints medidos del ejemplo siguen saliéndo"

### S4 — Los tests, y el gate ampliado
- **Status**: pending
- **DependsOn**: [S2, S3]
- **Files**: `tests/core/exporters.spec.ts`, `tests/e2e/django-comprehensive.test.ts`, `tests/e2e/flask-comprehensive.test.ts`, `tests/helpers/compare-json.ts`, `scripts/gates/lint-no-type-escapes.script.ts`
- **Gate**: lint
- acceptance:
  - "`lint:no-type-escapes` añade `: any` a lo que prohíbe"
  - "Se comprueba metiendo uno y viendo romper el gate"
  - "El comentario que hoy explica por qué se dejó fuera se retira: ya no aplica"

## acceptance

- Devuelve `unknown`, nunca `any`
- Distingue "no se pudo parsear" de "parsó a null", que hoy se confunden
- Trae los predicados de estrechamiento que los scanners repiten: ¿es objeto?, ¿es array de objetos?, ¿tiene esta clave string?
- Cero `: any`
- Un manifiesto roto da el mismo resultado en los tres, que hoy no pasa
- Los 21 ejemplos siguen detectándose
- Cero `: any` en los seis sitios, incluido `resolveRef`
- Un `$ref` circular no cuelga: hoy no hay nada que lo impida y el tipo no ayuda a verlo
- Los 23 endpoints medidos del ejemplo siguen saliéndo
- `lint:no-type-escapes` añade `: any` a lo que prohíbe
- Se comprueba metiendo uno y viendo romper el gate
- El comentario que hoy explica por qué se dejó fuera se retira: ya no aplica
