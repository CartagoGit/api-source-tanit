---
id: x00050
kind: fix
title: "x00050: CI roja — Bun 1.3.14 no sabe leer el bun.lock v2; el pin de CI debe seguir al lockfile"
status: done
shippedIn: [9043822]
priority: P0
globalGate: type
why: |
  La CI de develop llevaba roja "en Install dependencies" desde al
  menos el 2026-09-04 — el análisis externo lo reportaba sin poder
  atribuir causa ("no tengo el stderr exacto del bun install"). Con
  `gh run view --log-failed` la causa resulta ser mecánica:

  ```text
  bun install v1.3.14
  2 |   "lockfileVersion": 2,
                ^
  error: Unknown lockfile version
  UnknownLockfileVersion: failed to parse lockfile: 'bun.lock'
  error: lockfile had changes, but lockfile is frozen
  ```

  El `bun.lock` del repo es **v2** (lo genera cualquier Bun ≥ 1.4;
  el puesto de desarrollo corre 1.4.2). Los 5 workflows de CI y el
  Dockerfile pinnean **1.3.14**, que sólo sabe leer lockfile v1. Con
  `--frozen-lockfile`, Bun 1.3 ni siquiera intenta resolver: muere.

  Consecuencia: TODO el pipeline de CI (validate, releases,
  integration) estaba muerto antes de correr un solo gate. Los
  commits individuales decían "typecheck verde, 3199 tests" — cierto
  en local (Bun 1.4.2); falso como estado integrado de develop.

  x00045 (quitar Delendai de la CI) y x00046 (quitar el
  TANIT_SKIP) no podían verificarse empíricamente mientras este
  fallo bloqueara el runner. Esta propuesta cierra la causa raíz y
  blinda la relación lockfile↔pin.
nonGoals:
  - Downgradear el lockfile a v1: iría contra el Bun local (1.4.2)
    y volvería a romper en la siguiente regeneración.
  - Usar `latest` en CI: `lint:bun-ci` lo rechaza explícitamente
    (reproducibilidad — c00003).
  - Tocar la versión de Bun exigida a usuarios del producto
    (`engines.bun >= 1.0.0` es del runtime del CLI, no del
    toolchain de CI).
globalGate: type
acceptance:
  - Los 5 workflows (validate, integration-delendai,
    release-binaries, release-desktop, release-npm) pinnean
    `bun-version: 1.4.2` — la versión que genera el lockfile local.
  - `.docker/Dockerfile` pinnea `ARG BUN_VERSION=1.4.2` con el
    motivo escrito.
  - `lint:bun-ci` extiende su contrato: lee el `lockfileVersion`
    del `bun.lock` del repo y rechaza cualquier pin de workflow
    por debajo del mínimo que sabe leerlo (v2 ⇒ ≥ 1.4.0). El mapa
    `MIN_BUN_FOR_LOCKFILE` es la tabla versionada; si Bun saca
    lockfile v3, se añade una fila.
  - `tests/cli/lint-bun-ci.spec.ts` cubre: pin < mínimo rechazado,
    pin ≥ mínimo aceptado, pin == mínimo aceptado, sin mínimo
    cualquiera pasa, y `readLockfileVersion()` devuelve 2 en el
    repo real.
  - La CI supera el step `Install dependencies` con Bun 1.4.2
    (verificado en el run del propio shippedIn `9043822`: ese
    step termina OK; los pasos posteriores dependen de gates
    distintos que se cierran en otras propuestas).
  - `bun run validate` verde local.

> **Nota (d00003, 2026-09-06):** El acceptance original afirmaba
> "La CI de develop vuelve a verde", pero el run del propio SHA
> shippedIn (`9043822`) terminó en `failure` con `Install
> dependencies` pasando pero `Validate` fallando. La fix
> subyacente (Bun 1.4.2) es correcta y útil — el paso de
> `Install dependencies` queda desbloqueado por primera vez desde
> que el lockfile subió a v2 — pero el alcance documentado
> estaba exagerado. El acceptance real es el primer bullet del
> bloque de arriba.
slices:
  - sliceId: S1
    title: "fix(ci): bun-version 1.3.14 → 1.4.2 en los 5 workflows + Dockerfile"
    files:
      - .github/workflows/validate.yml
      - .github/workflows/integration-delendai.yml
      - .github/workflows/release-binaries.yml
      - .github/workflows/release-desktop.yml
      - .github/workflows/release-npm.yml
      - .docker/Dockerfile
    gate: type
    dependsOn: []
    acceptance:
      - grep de `1.3.14` en el repo devuelve vacío (fuera de
        propuestas históricas).
      - Comentario en cada workflow ancla el motivo (lockfile v2).
  - sliceId: S2
    title: "fix(gates): lint:bun-ci exige pin ≥ mínimo del lockfileVersion"
    files:
      - scripts/gates/lint-bun-ci.script.ts
      - tests/cli/lint-bun-ci.spec.ts
    gate: type
    dependsOn: [S1]
    acceptance:
      - `readLockfileVersion()` parsea `bun.lock`.
      - `findBunCiProblems(source, minBunVersion?)` rechaza pins
        por debajo del mínimo con mensaje específico.
      - `main()` calcula el mínimo desde el lockfile real — si el
        lockfile sube a v3, el gate exige actualizar el pin sin
        tocar código.
      - 5 tests nuevos (12 en total en el spec).
---

# x00050 — La CI no puede arrancar: Bun 1.3 no lee lockfile v2

## Evidencia

Run `34009215344` (HEAD `8f49b1c`), step "Install dependencies":

```text
bun install v1.3.14 (0d9b296a)
2 |   "lockfileVersion": 2,
              ^
error: Unknown lockfile version
    at bun.lock:2:22
UnknownLockfileVersion: failed to parse lockfile: 'bun.lock'
warn: Ignoring lockfile
error: lockfile had changes, but lockfile is frozen
```

Todos los runs de develop desde el 2026-09-04 fallan en el MISMO
step — anterior a x00045/x00046: la CI nunca llegó a validarlos.

## Por qué el lockfile es v2

Bun 1.4 (release de septiembre 2025) introdujo `lockfileVersion: 2`
con `configVersion: 1`. El puesto de desarrollo corre Bun 1.4.2;
cualquier `bun install` local regenera el lockfile en v2. La CI
pinneada a 1.3.14 (c00003, cuando 1.3 era lo último) se quedó
mirando un formato que no entiende.

No es un fallo de nadie en concreto: es drift entre el toolchain
local y el pin de CI. Por eso el fix incluye el **gate** (S2) que
hace la relación explícita: el lockfile manda, el pin le sigue.

## Diseño

### S1 — bump mecánico

`1.3.14 → 1.4.2` en los 5 workflows + Dockerfile, con comentario
en validate.yml e integration-delendai.yml (los dos que hacen
`bun install --frozen-lockfile` del repo raíz).

### S2 — el gate sigue al lockfile

```ts
const MIN_BUN_FOR_LOCKFILE: Record<number, string> = {
  1: "1.0.0",
  2: "1.4.0",
};
```

`readLockfileVersion()` lee el `bun.lock` real; `main()` deriva el
mínimo; `findBunCiProblems(source, min)` lo exige en cada
`bun-version:`. Si mañana Bun 1.5 regenera el lockfile a v3, dos
cosas pasan en orden:

1. `bun install --frozen-lockfile` local sigue funcionando (el
   local genera lo que lee).
2. `lint:bun-ci` falla en cuanto el lockfile commiteado dice v3 y
   algún workflow pinnea < la fila correspondiente — que se añade
   al mapa con la versión mínima real documentada.

El gate NO inventa mínimos: la tabla es versión→suelo conocido,
mantenida explícitamente.

## Verificación empírica

Verificable en el run del propio SHA shippedIn `9043822`:

- ✅ `Install dependencies` pasa (Bun 1.4.2 lee lockfile v2).
- ✅ El error `UnknownLockfileVersion` deja de aparecer en los
  runs posteriores de develop.
- ❌ El step `Validate` del MISMO run todavía fallaba (por
  razones distintas a esta propuesta: gates abiertos en ese
  momento, todos cerrados por propuestas posteriores).

Por tanto esta propuesta **desbloquea la CI a nivel de
toolchain** pero **no la cierra**: los gates posteriores
(`lint:proposals`, `lint:no-orphan-types`, etc.) tienen su
propia ruta de cierre, registrada en sus propias propuestas
(x00045, x00046, x00053, etc.).

La verificación "CI verde en el HEAD posterior al shippedIn" del
acceptance original se cumplió como evidencia **del paso de
Install dependencies**, no de la cadena completa. El
`gh run list` actual sobre develop muestra la cadena completa
verde por primera vez tras esta sesión (2026-09-06), pero eso
es producto acumulado de varias propuestas — no es evidencia
atribuible solo a x00050.