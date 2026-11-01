---
id: x00073
title: "La release sin binarios y main en rojo: el tag dispara los workflows y la promoción es con merge commit"
kind: fix
status: ready
type: proposal
track: general
date: 2026-11-01
---

# x00073 — La release sin binarios y main en rojo: el tag dispara los workflows y la promoción es con merge commit

## goal

Que la release de GitHub salga con sus binarios adjuntos y que main vuelva a estar verde.

Tres fallos encadenados:

1. La release v0.1.0-alpha.1 salió sin un solo ejecutable adjunto, y ningún check falló. La causa es una regla de GitHub: release-cut crea la release con GITHUB_TOKEN, y los eventos que dispara el propio GITHUB_TOKEN no crean ejecuciones nuevas. Con release-binaries y release-desktop escuchando al evento `release`, la release se creaba bien y nadie adjuntaba nada — un fallo invisible. El tag sí lo dispara GitHub siempre.

2. La promoción a main se hizo con squash, y un squash aplana la historia. El gate lint:proposals exige que cada shippedIn de una propuesta cerrada sea ancestro de HEAD —es la auditoría de la evidencia del cierre— y con squash 166 de esos commits dejaron de serlo. main quedó en rojo y el alfa se cortó desde una rama que ya no estaba verde. La política del repo ya decía mergeMethod: "merge"; la protección de main divergía de ella.

3. El bot de auto-aprobación llamaba a github.rest.pulls.enableAutoMerge, y ese método no existe en la versión de Octokit que trae github-script@v7: la llamada moría con "enableAutoMerge is not a function". El PR quedaba aprobado y sin auto-merge, esperando a un humano que no hacía falta. El endpoint REST sí funciona.

## why

La primera release del proyecto salió **sin un solo ejecutable adjunto** y
`main` quedó **en rojo**, y ninguno de los dos fallos se ven como lo que
son. Son fallos invisibles: no hay check rojo, no hay log que diga
«no se adjuntó nada», no hay error. La release se creó con sus notas y su
marca de prerelease —perfectamente— y sin dentro lo único que la hacía
utilizable.

Los tres fallos tienen la misma raíz de fondo: **la forge y el repo
decidieron cosas distintas, y el repo se lo cuenta tarde**. La release
la crea `GITHUB_TOKEN`, y lo que dispara `GITHUB_TOKEN` no crea
ejecuciones: el evento `release` nunca llegaba a nadie. La promoción se
hizo con squash mientras la política del repo —`mergeMethod: "merge"`—
decía otra cosa, y el gate que audita la historia de las propuestas
cerradas dejó de encontrar 166 commits. El bot pedía un método de
Octokit que no existe en la versión que trae `github-script@v7`, y
moría con un aviso que nadie lee.

Los tres se pueden volver a romper. Un workflow que escucha un evento
que `GITHUB_TOKEN` no dispara; una rama cuya protección diverge de la
política declarada; una llamada a una API que cambió de nombre. Cada
uno necesita un **test que falle cuando vuelve a pasar**, y el tercero
además necesita que el gate de protección mire la rama donde se corta
la versión, que es donde la divergencia costó una release.

## non-goals

- No se cambia el canal de releases ni se toca `release-cut`: la release
  se creó bien, con sus notas y su marca de prerelease.
- No se firma ni se publica la app de escritorio: el canal `alpha`
  construye los instaladores pero no los publica, y eso ya estaba bien.
- No se toca el gate `lint:proposals`: su regla es correcta —exige que
  la evidencia del cierre esté **en la historia**— y el que la incumplía
  era el método de merge.
- No se reescribe la release `v0.1.0-alpha.1`: no se puede adjuntar a
  una release que ya salió sin binarios. Se corta `v0.1.0-alpha.2`.
- No se toca la protección de `main` desde el código: es configuración
  del forge, y lo que se arregla aquí es que el gate la **verifique**.

## slices

- global_gate: e2e

### S1-autoapprove-merge-commit-y-auto-merge-por-rest — S1 — El bot integra con merge commit y activa el auto-merge por REST
- **Status**: pending
- **Files**: `.github/workflows/auto-approve.yml`, `tests/cli/auto-approve.spec.ts`, `docs/CI.md`
- **Gate**: type
- acceptance:
  - "El merge es **siempre** un merge commit, en las dos ramas: un squash aplana la historia y deja fuera del árbol los commits que `lint:proposals` audita."
  - "El auto-merge se pide por el endpoint REST `PUT /repos/{owner}/{repo}/pulls/{pull_number}/auto-merge` y no por `github.rest.pulls.enableAutoMerge`, que no existe en la versión de Octokit de `github-script@v7`."
  - "El test comprueba las dos cosas: que el método nunca sea squash y que la llamada sea por REST."
  - "`docs/CI.md` explica por qué merge y no squash, y por qué el endpoint REST."

### S2-el-gate-vigila-la-rama-de-release — S2 — El gate de protección comprueba también la rama de release
- **Status**: pending
- **Files**: `scripts/gates/branch-protection.script.ts`, `tests/scripts-gates/branch-protection.spec.ts`, `docs/CI.md`
- **Gate**: type
- acceptance:
  - "El gate verifica la rama de release declarada en `development.branches.release` —`main`— y no sólo `develop` y las `release/*`."
  - "Para la rama de release se compara contra la política de release: `releaseRequiredApprovals` aprobaciones y el mismo `linearHistory` y `mergeMethod` que la de integración."
  - "Una divergencia en `main` —la que costó la release: historia lineal exigida con `mergeMethod: \"merge\"`— hace fallar el gate con el motivo escrito."
  - "El gate dice qué hacer cuando divergen: la rama se protege con la política, o la política se cambia."
  - "Tests cubren la rama de release conforme y las tres divergencias: aprobaciones, historia lineal y método de merge."

### S3-alfa-2-y-sus-notas — S3 — La versión 0.1.0-alpha.2 y sus notas de release
- **Status**: pending
- **Files**: `package.json`, `packages/desktop/tauri.conf.json`, `packages/contracts/constants/cli/cli-version.constant.ts`, `CHANGELOG.md`
- **Gate**: none
- acceptance:
  - "La versión es `0.1.0-alpha.2` en las tres copias: `package.json`, `packages/desktop/tauri.conf.json` y `CLI_VERSION`."
  - "El gate `lint-release-channel` dice que el canal es `alpha`."
  - "El CHANGELOG tiene la sección `0.1.0-alpha.2` con lo que cambia respecto a `alpha.1`: los binarios adjuntos, la promoción con merge commit y el auto-merge del bot."

## acceptance

- La release `v0.1.0-alpha.2` tiene **cuatro ejecutables adjuntos** (`apisrc-*`, uno por plataforma) y ninguno de ellos vacío.
- `main` está **verde**: `lint:proposals` encuentra todos los `shippedIn` y el gate de protección dice que la rama de release es conforme con la política.
- La promoción de `develop` a `main` deja los commits de `develop` **en la historia de `main`**: `git merge-base --is-ancestor` es cierto para los commits que auditan las propuestas cerradas.
- Un PR del dueño con la validación en verde se **aprueba y se mergea solo**, sin que haga falta pulsar ningún botón.
- Ninguno de los tres fallos vuelve a pasar en silencio: cada uno tiene un test o un gate que se enroja.
