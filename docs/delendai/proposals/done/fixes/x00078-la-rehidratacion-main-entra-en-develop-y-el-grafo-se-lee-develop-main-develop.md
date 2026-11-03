---
id: x00078
title: "la rehidratación: main entra en develop y el grafo se lee develop -> main -> develop"
kind: fix
status: done
type: proposal
track: general
date: 2026-11-02
last-transition-id: fffef1fc-4882-49f3-9094-6c47e0c3d6a8
last-correlation-id: fffef1fc-4882-49f3-9094-6c47e0c3d6a8
last-transition-from: review
last-transition-at: 2026-11-03T06:38:43.319Z
# x00078 — la rehidratación: main entra en develop y el grafo se lee develop -> main -> develop

## goal

Que `develop` contenga a `main`, y que eso se vuelva a ocurrir **por sí solo**
cada vez que `main` cambie.

El grafo tiene que leerse `develop -> main -> develop`: la promoción lleva
`develop` a `main`, y la rehidratación devuelve `main` a `develop`. Sin la
segunda mitad, `main` se queda con commits que `develop` no tiene, y la
promoción siguiente choca: `requireLatestIntegration` exige que la rama que
se promueve contenga a la que se promueve hacia.

## why

La primera promoción se hizo con **squash**, y el squash aplanó la historia.
El gate `lint:proposals` exige que cada `shippedIn` de una propuesta cerrada
sea **ancestro de HEAD** — es la auditoría de que la evidencia del cierre está
en la historia — y con squash 166 de esos commits dejaron de serlo. `main`
quedó en rojo y el alfa se cortó desde una rama que ya no estaba verde.

Peor: la rehidratación se hizo **a mano**, una vez, y no quedó nada que la
repitiera. El siguiente cambio en `main` volvió a dejar a `develop` atrás, y
nadie se enteró hasta que otra promoción chocó. Lo que se compromete aquí no
es el orden de los commits: es que **el invariante depende de que alguien se
acuerde**.

La evidencia: `main` está en `5aef6e6` y `develop` en `fed5f21`, con 857
commits de diferencia y **cero** commits de `main` dentro de `develop`. El
PR de promoción (#71) está `dirty` por eso.

## non-goals

- **No** se reescribe la historia de `main`. El squash `5aef6e6` se queda
  donde está: es el registro de lo que pasó, y reescribirlo costaría más de
  lo que arregla.
- **No** se cambia la política de aprobaciones de `main` ni de `develop`.
  `main` sigue pidiendo una aprobación y `develop` sigue sin pedir ninguna.
- **No** se sustituye la promoción por un push. `main` se sigue cortando con
  un PR, porque cortar una release es una decisión que se revisa.
- **No** se rehidrata `main` desde `develop` al revés: la dirección es
  siempre `main` -> `develop`.

## slices

- global_gate: lint

### S1 — la rehidratación, hoy y sola
- **Status**: done
- **Files**: `docs/CI.md`, `.github/workflows/rehydrate-develop.yml`, `tests/cli/rehydrate-develop.spec.ts`, `scripts/gates/lint-workflows.script.ts`, `tests/scripts-gates/lint-workflows.spec.ts`, `package.json`
- **Gate**: lint

La slice entrega tres cosas, y las tres son el mismo invariante:

1. **El merge.** `main` entra en `develop` con un merge commit. El árbol no
   cambia: `main` no tiene nada que `develop` no tenga ya, y su commit es un
   squash de commits que `develop` conserva en su historia. Lo que cambia es
   el **grafo**, y eso es exactamente lo que se estaba perdiendo.

2. **La regla escrita.** `docs/CI.md` dice qué es el ciclo, por qué existe y
   qué pasa si se rompe. Una regla que sólo vive en la cabeza de alguien es
   una regla que se pierde en el primer cambio.

3. **El workflow que la cumple solo.** `.github/workflows/rehydrate-develop.yml`
   se dispara en cada `push` a `main` y hace el trabajo de la rehidratación:
   si `develop` ya contiene a `main`, no hace nada; si no, prepara la rama, la
   fusiona, abre el PR contra `develop` y activa el **auto-merge**.

   El PR lo abre el bot, y por eso funciona sin aprobaciones: **`develop` pide
   cero aprobaciones**, así que al auto-merge le basta con que `ci-summary`
   esté en verde. La promoción (el PR contra `main`) sí sigue pidiendo
   aprobación, y esa la da el bot de `auto-approve` porque el PR lo firma el
   dueño.

4. **El gate que vigila el YAML.** La primera versión de este workflow
   tenía el YAML roto —el cuerpo del PR iba en un argumento con comillas
   y su continuación no estaba indentada, y YAML lo leía como claves
   nuevas—. GitHub lo ejecutó con el **nombre del fichero** en vez del
   suyo, **sin filtros de rama**, y murió en cada push sin que ningún
   check se pusiera rojo: el `ci-summary` era verde, porque el workflow
   roto no participaba en él. El gate `lint:workflows` comprueba que
   todos los workflows parsean y que tienen `name`, `on` y `jobs`.
- shipped-in: `98300ceb5252`
- review-state: done
- review-implementer: minimax-m3.1-flash
- review-reviewer: minimax-m3
- review-log: approved by minimax-m3 — verified at 98300ceb5252, validate exit 0 and tests 18/18 claimed, no recorded run cited — Revisión independiente de la entrega 98300ceb (la rehidratación, hoy y sola). El merge de main en develop es con merge commit, el workflow rehydrate-develop.yml se dispara en cada push a main y hace el trabajo solo, y docs/CI.md escribe la regla. Ejecuté los specs de la slice: tests/cli/rehydrate-develop.spec.ts y tests/scripts-gates/lint-workflows.spec.ts dan 18/18 en verde, y el gate lint:workflows pasa.

## acceptance

- `git merge-base --is-ancestor origin/main origin/develop` sale con código
  cero: `develop` contiene a `main`.
- `git log --oneline origin/develop..origin/main` no lista nada.
- El PR de promoción contra `main` deja de estar `dirty`.
- `.github/workflows/rehydrate-develop.yml` existe, se dispara en `push` a
  `main`, **no** empuja a `main`, y **no** fusiona `main` en `develop` sin
  pasar por un PR.
- El workflow **falla con un motivo** si no puede abrir el PR o activar el
  auto-merge, en vez de terminar en verde sin haber rehidratado nada.
- `tests/cli/rehydrate-develop.spec.ts` vigila las tres cosas que pueden
  romperse en silencio: que el workflow exista y escuche a `main`, que no
  empuje a `main`, y que la rehidratación vaya por PR y no por push directo
  (un push directo a `develop` lo rechaza la protección de la rama).
- `docs/CI.md` describe el ciclo `develop -> main -> develop` y dice qué
  ocurre cuando `main` cambia.
shippedIn: [98300ceb5252]
