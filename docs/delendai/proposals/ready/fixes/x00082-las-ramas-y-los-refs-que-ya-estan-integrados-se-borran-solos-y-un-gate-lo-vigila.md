---
id: x00082
title: "Las ramas y los refs que ya estan integrados se borran solos, y un gate lo vigila"
kind: fix
status: ready
type: proposal
track: general
date: 2026-11-03
---

# x00082 — Las ramas y los refs que ya estan integrados se borran solos, y un gate lo vigila

## goal

Que la rama de la publicacion y la ref de trabajo de una unidad desaparezcan cuando su trabajo aterriza, y que un gate diga cuando queda alguna sin borrar.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — la politica borra el ref de trabajo cuando su trabajo aterriza
- **Status**: pending
- **Files**: `delendai.config.json`
- **Gate**: none
- acceptance:
  - "development.integration.deleteMergedWorkRef está en true: la rama de la publicación se borra al integrar, y el runtime borra la ref de trabajo local cuando su contenido está en develop."
  - "La política dice por qué en este repo es seguro: una unidad publica un pull request por propuesta, así que borrar esa rama no deja slices sin publicar."

### S2 — un gate que dice cuando hay ramas y refs que ya están integrados
- **Status**: pending
- **Files**: `scripts/gates/lint-work-refs.script.ts`, `tests/scripts-gates/lint-work-refs.spec.ts`, `package.json`
- **Gate**: lint
- acceptance:
  - "Hay un gate que falla si queda alguna publicación (pr/) o ref de trabajo (wip/) cuyo trabajo ya está en develop, y dice cuál es y cómo se limpia."
  - "El gate se apoya en el doctor del runtime, no en una copia de su lógica."
  - "El gate está encadenado en lint, así que la CI lo ve."

## acceptance

- development.integration.deleteMergedWorkRef está en true: la rama de la publicación se borra al integrar, y el runtime borra la ref de trabajo local cuando su contenido está en develop.
- La política dice por qué en este repo es seguro: una unidad publica un pull request por propuesta, así que borrar esa rama no deja slices sin publicar.
- Hay un gate que falla si queda alguna publicación (pr/) o ref de trabajo (wip/) cuyo trabajo ya está en develop, y dice cuál es y cómo se limpia.
- El gate se apoya en el doctor del runtime, no en una copia de su lógica.
- El gate está encadenado en lint, así que la CI lo ve.
