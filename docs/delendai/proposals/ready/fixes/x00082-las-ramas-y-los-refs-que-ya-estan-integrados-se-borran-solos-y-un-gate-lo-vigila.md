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

Las unidades de trabajo publican su trabajo en una rama (`pr/...`) y
trabajan en otra (`wip/...`). Cuando ese trabajo aterriza en `develop`,
las dos refs dejan de guardar nada, y se quedan: el 3 de noviembre de
2026 eran **ocho publicaciones** y **dos worktrees** sin ref, más una
rama de trabajo local abandonada. Nadie lo notaba porque el runtime
solo lo dice cuando se le pregunta (`delendai work doctor`), y porque
`develop.integration.deleteMergedWorkRef` estaba en `false`: la política
del runtime es deliberada, pero en este repo no encaja.

La política del runtime dice por qué la deja apagada: *"una propuesta
aterriza un pull request por slice; el interruptor de GitHub borraría la
rama en la primera slice y dejaría huérfanas las demás"*. Aquí una
unidad publica **una propuesta entera con sus slices** (`--slice=all`),
así que borrar esa rama al integrar no deja slice sin publicar: lo que
queda es exactamente lo que hay que borrar.

Por dos medios, porque cada uno cubre una cosa:
- **La política** (`deleteMergedWorkRef: true`): GitHub borra la rama de
  la publicación al integrar, y el runtime borra la ref de trabajo local
  cuando su contenido está en `develop`.
- **Un gate** (`lint:work-refs`): si aun así queda alguna, el `lint` lo
  dice, con el nombre de la ref y el comando que la borra. El gate
  **pregunta al doctor del runtime** (`delendai --json work doctor`) y
  usa sus veredictos y su remedio; sin runtime —la CI de este repo no lo
  instala— hace la misma pregunta con `git`, y el remedio sigue siendo
  el comando del runtime.

## non-goals

- **No se toca el runtime**: `delendai` es de otra gente y la limpieza
  ya está hecha ahí (`work reap`, `work retire`, `work doctor`). Lo que
  falta es la política de este repo y que alguien mire.
- **No se borra trabajo**: el gate solo dice que una ref *ya está*
  integrada. Una ref cuyo commit no está en `develop` es una unidad
  viva, y ahí el gate se calla.
- **No se tocan las refs de archivo** (`refs/retired/...`): guardan el
  commit de un trabajo retirado para que no se pierda, y no son ramas.
- **No se tocan los claims** (`refs/delendai/claims/...`): son del
  runtime, y los suelta él cuando la propuesta se cierra.

## slices

- global_gate: none

### S1 — la politica borra el ref de trabajo cuando su trabajo aterriza
- **Status**: pending
- **Files**: `delendai.config.json`, `CONTRIBUTING.md`
- **Gate**: none
- acceptance:
  - "development.integration.deleteMergedWorkRef está en true: la rama de la publicación se borra al integrar, y el runtime borra la ref de trabajo local cuando su contenido está en develop."
  - "La política dice por qué en este repo es seguro, y lo dice en CONTRIBUTING.md («Cómo aterriza el trabajo»): una unidad publica un pull request por propuesta, así que borrar esa rama no deja slices sin publicar."

### S2 — un gate que dice cuando hay ramas y refs que ya están integrados
- **Status**: pending
- **Files**: `scripts/gates/lint-work-refs.script.ts`, `tests/scripts-gates/lint-work-refs.spec.ts`, `package.json`, `CONTRIBUTING.md`
- **Gate**: lint
- acceptance:
  - "Hay un gate que falla si queda alguna publicación (pr/) o ref de trabajo (wip/) cuyo trabajo ya está en develop, y dice cuál es y cómo se limpia."
  - "El gate pregunta al doctor del runtime (delendai --json work doctor) y usa sus veredictos y su remedio; sin runtime instalado —la CI de este repo no lo tiene— comprueba lo mismo con git, y el remedio sigue siendo el comando del runtime (delendai work retire / delendai work reap)."
  - "El gate está encadenado en lint, así que la CI lo ve."

## acceptance

- development.integration.deleteMergedWorkRef está en true: la rama de la publicación se borra al integrar, y el runtime borra la ref de trabajo local cuando su contenido está en develop.
- La política dice por qué en este repo es seguro, y lo dice en CONTRIBUTING.md («Cómo aterriza el trabajo»): una unidad publica un pull request por propuesta, así que borrar esa rama no deja slices sin publicar.
- Hay un gate que falla si queda alguna publicación (pr/) o ref de trabajo (wip/) cuyo trabajo ya está en develop, y dice cuál es y cómo se limpia.
- El gate pregunta al doctor del runtime (delendai --json work doctor) y usa sus veredictos y su remedio; sin runtime instalado —la CI de este repo no lo tiene— comprueba lo mismo con git, y el remedio sigue siendo el comando del runtime (delendai work retire / delendai work reap).
- El gate está encadenado en lint, así que la CI lo ve.
