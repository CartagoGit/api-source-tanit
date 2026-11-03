---
id: x00073
title: "La release sin binarios y main en rojo: el tag dispara los workflows y la promoción es con merge commit"
kind: fix
status: done
type: proposal
track: general
date: 2026-11-01

last-transition-id: a013a9d7-38d3-475e-bf90-15f16d5d7d25
last-correlation-id: a013a9d7-38d3-475e-bf90-15f16d5d7d25
last-transition-from: review
last-transition-at: 2026-11-03T06:36:56.123Z
shippedIn:
  - "ecd09e30042d"
  - "b888be88acf3"


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
- **Status**: done
- **Files**: `.github/workflows/auto-approve.yml`, `tests/cli/auto-approve.spec.ts`, `docs/CI.md`
- **Gate**: type
- acceptance:
  - "El merge es **siempre** un merge commit, en las dos ramas: un squash aplana la historia y deja fuera del árbol los commits que `lint:proposals` audita."
  - "El auto-merge se pide por el endpoint REST `PUT /repos/{owner}/{repo}/pulls/{pull_number}/auto-merge` y no por `github.rest.pulls.enableAutoMerge`, que no existe en la versión de Octokit de `github-script@v7`."
  - "El test comprueba las dos cosas: que el método nunca sea squash y que la llamada sea por REST."
  - "`docs/CI.md` explica por qué merge y no squash, y por qué el endpoint REST."
- review-state: done
- review-implementer: minimax-m3.1-flash-preview
- review-reviewer: minimax-m3
- review-log: approved by minimax-m3 — verified at ecd09e30042d, validate exit 0 and tests 8/8 claimed, no recorded run cited; acceptance 4/4: (1) .github/workflows/auto-approve.yml:156 — const method = "merge"; (ya no hay base === "main" ? ... : ...). La protección real de main: required_linear_history.e… (2) .github/workflows/auto-approve.yml:158-166 — await github.request("PUT /repos/{owner}/{repo}/pulls/{pull_number}/auto-merge", {..., merge_method: method}). El … (3) tests/cli/auto-approve.spec.ts:83-107. Mutación verificada por el revisor y repetida aquí: borrar la llamada github.request() entera, cambiarla por otro endpoi… (4) docs/CI.md:135-150: un bloque con los dos porqués (el squash aplana la historia y deja fuera del árbol los commits que lint:proposals audita; enableAutoMerge n… — Revisión independiente por delivery-verifier, dos rondas. Ronda 1 sobre d5e5a51: 0 bloqueantes, 2 importantes y 3 menores. Ronda 2: los tres puntos de test verificados por mutación. El bloqueante de la ronda 2 (el tip de la rama, con 16 propuestas movidas por el runtime) corregido en 77acac8: git diff --name-status -M origin/develop HEAD -- docs/delendai/proposals/done/ vacío y lint:proposals exit 0 (168 propuestas sin drift).

### S2-el-gate-vigila-la-rama-de-release — S2 — El gate de protección comprueba también la rama de release
- **Status**: done
- **Files**: `scripts/gates/branch-protection.script.ts`, `tests/scripts-gates/branch-protection.spec.ts`, `docs/CI.md`
- **Gate**: type
- acceptance:
  - "El gate verifica la rama de release declarada en `development.branches.release` —`main`— y no sólo `develop` y las `release/*`."
  - "Para la rama de release se compara contra la política de release: `releaseRequiredApprovals` aprobaciones y el mismo `linearHistory` y `mergeMethod` que la de integración."
  - "Una divergencia en `main` —la que costó la release: historia lineal exigida con `mergeMethod: \"merge\"`— hace fallar el gate con el motivo escrito."
  - "El gate dice qué hacer cuando divergen: la rama se protege con la política, o la política se cambia."
  - "Tests cubren la rama de release conforme y las tres divergencias: aprobaciones, historia lineal y método de merge."
- review-state: done
- review-implementer: minimax-m3
- review-reviewer: minimax-m3.1-flash
- review-log: approved by minimax-m3.1-flash — verified at b888be88acf3, validate exit 0 and tests 15/15 claimed, no recorded run cited; acceptance 5/5: (1) scripts/gates/branch-protection.script.ts:135-136 saca INTEGRATION_BRANCH y RELEASE_BRANCH de DECLARED_BRANCHES, y :121-133 se niega a arrancar si el bloque no… (2) scripts/gates/branch-protection.script.ts:154-163 lee development.integration.releaseRequiredApprovals y lanza si no está declarado, sin inventar un valor; :17… (3) scripts/gates/branch-protection.script.ts:582-587 dice cuál divergió (la historia con su linearHistory, el force-push o el borrado) y :593-600 añade el motivo … (4) scripts/gates/branch-protection.script.ts:570-571 (aprobaciones) y :600-601 (historia, force-push y borrado) dicen «Protege la rama con la política, o cambia l… (5) tests/scripts-gates/branch-protection.spec.ts, 15 tests en verde: :358 la rama de release conforme, :373 menos aprobaciones, :394 historia lineal y :423 método… — Revisión independiente de la entrega b888be88acf3476a002bea542da625be85b024e4 (merge del PR #74). Leí el diff entregado de la slice y ejecuté su gate y sus propios specs: bunx vitest run tests/scripts-gates/branch-protection.spec.ts da 15/15 en verde y bun run typecheck da las 6 secciones en verde. Comprobé los cinco criterios de aceptación contra el código entregado, no contra el de hoy: scripts/gates/branch-protection.script.ts y tests/scripts-gates/branch-protection.spec.ts no han cambiado desde la entrega. Dientes por mutación verificados sobre el gate: sin RELEASE_BRANCH caen 3 tests, sin conmutar en requiredApprovalsFor caen 5, sin comparar required_linear_history cae 1 y sin la frase de remedio caen 2. Los cambios posteriores c50d1454 y 25498006 no tocan los ficheros de esta slice.

### S3-alfa-2-y-sus-notas — S3 — La versión 0.1.0-alpha.2 y sus notas de release
- **Status**: done
- **Files**: `package.json`, `packages/desktop/tauri.conf.json`, `packages/contracts/constants/cli/cli-version.constant.ts`, `CHANGELOG.md`
- **Gate**: none
- acceptance:
  - "La versión es `0.1.0-alpha.2` en las tres copias: `package.json`, `packages/desktop/tauri.conf.json` y `CLI_VERSION`."
  - "El gate `lint-release-channel` dice que el canal es `alpha`."
  - "El CHANGELOG tiene la sección `0.1.0-alpha.2` con lo que cambia respecto a `alpha.1`: los binarios adjuntos, la promoción con merge commit y el auto-merge del bot."
- review-state: done
- review-implementer: minimax-m3
- review-reviewer: minimax-m3.1-flash
- review-log: approved by minimax-m3.1-flash — verified at b888be88acf3, validate exit 0 and tests 16/16 claimed, no recorded run cited; acceptance 3/3: (1) En el commit entregado b888be88 las tres copias dicen 0.1.0-alpha.2: package.json ("version": "0.1.0-alpha.2"), packages/desktop/tauri.conf.json ("version": "0… (2) bun run lint:release-channel responde "lint:release-channel — 0.1.0-alpha.2 (canal alpha, prerelease): las tres copias coinciden" y sale con 0. El criterio lla… (3) CHANGELOG.md:3 abre "## 0.1.0-alpha.2 (2026-11-02) — La release con binarios de verdad" y dice que alpha.1 se publicó sin un solo ejecutable adjunto. Las tres … — Revisión independiente de la entrega b888be88acf3476a002bea542da625be85b024e4. Esta slice no trae specs propios, así que corrí los que cubren lo que entrega: tests/release/release-channel.spec.ts y tests/release/release-notes.spec.ts dan 16/16 en verde, y el gate que nombra el criterio, bun run lint:release-channel, sale con 0 diciendo que el canal es alpha. Comprobé los tres criterios contra el estado entregado (git show del commit de entrega) y no contra el de hoy: las tres copias de la versión y la sección del CHANGELOG son las que b888be88 dejó.

## acceptance

- La release `v0.1.0-alpha.2` tiene **cuatro ejecutables adjuntos** (`apisrc-*`, uno por plataforma) y ninguno de ellos vacío.
- `main` está **verde**: `lint:proposals` encuentra todos los `shippedIn` y el gate de protección dice que la rama de release es conforme con la política.
- La promoción de `develop` a `main` deja los commits de `develop` **en la historia de `main`**: `git merge-base --is-ancestor` es cierto para los commits que auditan las propuestas cerradas.
- Un PR del dueño con la validación en verde se **aprueba y se mergea solo**, sin que haga falta pulsar ningún botón.
- Ninguno de los tres fallos vuelve a pasar en silencio: cada uno tiene un test o un gate que se enroja.
