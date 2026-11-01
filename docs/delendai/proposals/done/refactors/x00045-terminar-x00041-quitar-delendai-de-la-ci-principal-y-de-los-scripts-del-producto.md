---
id: x00045
kind: refactor
title: "x00045: terminar x00041 — quitar Delendai de la CI principal y de los scripts del producto"
status: done
priority: P0
globalGate: type
shippedIn:
  - 4776c2d
why: |
  x00041 cerró prematuramente: el plugin SÍ se movió de
  `packages/plugins/delendai_tanit/` a `integrations/delendai/`
  (S1 ✅), y existe el workflow opcional `integration-delendai.yml`
  (S4 ✅). Pero la CI principal (`validate.yml`) y el `package.json`
  raíz siguen tratando al plugin como si fuera parte del producto:

    1. `validate.yml` aún tiene `env.DELENDAI_SHA`, los pasos
       `Materialize delendai sibling`, `Build delendai core` y
       `Link jsonc-parser into the file: package store`. Si Delendai
       rompe, Tanit se rompe — exactamente el bug que x00041 quería
       cerrar.
    2. `validate.yml` exporta `TANIT_SKIP_MULTI_SERVICE_ISOLATION=1`
       para tapar el fallo del E2E de x00028 S4 — el E2E existe
       precisamente porque las regresiones multi-servicio no se
       cazarían sólo con tests unitarios. Dejarlo skip permanente
       en CI es una bomba.
    3. `packages/contracts/constants/core/delendai-sha.constant.ts`
       sigue exportando un SHA de Delendai como constante del core
       de Tanit — el core de Tanit no tiene nada que decir sobre
       qué commit de Delendai existe.
    4. `package.json#scripts.typecheck:plugin` apunta a
       `packages/plugins/delendai_tanit`, una ruta que NO existe
       desde x00041 S1. Si alguien lo corre, falla con ENOENT.
       `test:plugin` parece tener el mismo problema.
    5. `docs/delendai/AGENT-BOOTSTRAP.md §3.7` aún describe la
       antigua ruta `packages/plugins/delendai_tanit/` en algunos
       ejemplos internos (los puntos de migración quedaron a medias).

  Resultado: la "frontera" que x00041 quería levantar entre Tanit y
  Delendai está físicamente movida (carpeta) pero lógicamente
  perforada (CI y scripts siguen acoplados).
nonGoals:
  - Tocar el código del plugin (sigue siendo un cliente válido de
    `@delendai/core/public`; ningún tool cambia).
  - Cambiar `integration-delendai.yml` — ya está bien.
  - Reescribir el contrato de `@delendai/core` (es responsabilidad
    de Delendai).
  - Migrar al publicado npm (eso es p00007; sigue `done` con la
    forma actual).
globalGate: type
acceptance:
  - `validate.yml` empieza con `actions/checkout` + `setup-bun` +
    `bun install --frozen-lockfile`. Sin pasos de Delendai.
  - `validate.yml` no exporta `DELENDAI_SHA` ni `TANIT_SKIP_MULTI_SERVICE_ISOLATION`.
  - `packages/contracts/constants/core/delendai-sha.constant.ts` borrado.
  - Si algún código del core referenciaba el SHA, ese código se ha
    actualizado para no depender de él — `bun run lint:contracts`
    verde.
  - `package.json` raíz ya no tiene `typecheck:plugin` ni `test:plugin`.
  - `package.json#files` no menciona `packages/plugins/` ni
    `integrations/` (la integración es opcional y se valida aparte).
  - `AGENT-BOOTSTRAP.md §3.7` describe la nueva frontera:
    "el plugin vive en integrations/delendai/, no es parte del
    producto" y da los paths canónicos.
  - `bun run validate` verde localmente.
  - El workflow `integration-delendai.yml` sigue siendo válido y
    autocontenido — la separación se demuestra por reducción, no por
    añadido.
slices:
  - sliceId: S1
    title: "refactor(ci): validate.yml sin Delendai — quitar DELENDAI_SHA, Materialize, Build, Link, TANIT_SKIP"
    files:
      - .github/workflows/validate.yml
    gate: type
    dependsOn: []
    acceptance:
      - Workflow empieza con `actions/checkout@v7` + `setup-bun@v2` + `bun install --frozen-lockfile`.
      - `env.DELENDAI_SHA` borrado.
      - Pasos `Materialize delendai sibling`, `Build delendai core`,
        `Link jsonc-parser` borrados.
      - Step `Validate` ya no exporta `TANIT_SKIP_MULTI_SERVICE_ISOLATION`.
      - Comentario breve que explica por qué Tanit NO depende de
        Delendai en CI.
  - sliceId: S2
    title: "refactor(core): eliminar delendai-sha.constant.ts y limpiar imports huérfanos"
    files:
      - packages/contracts/constants/core/delendai-sha.constant.ts
      - packages/contracts/constants/integrations/delendai-report-version.constant.ts
    gate: type
    dependsOn: [S1]
    acceptance:
      - Fichero borrado.
      - `bun run lint:contracts` verde.
      - Si algún código del core lo importaba (comprobado con grep),
      ese import se elimina y, si la dependencia era importante, se
      reescribe sin el SHA (con referencia a `integration-delendai.yml`
      o a la documentación).
  - sliceId: S3
    title: "refactor(root): quitar scripts obsoletos typecheck:plugin y test:plugin"
    files:
      - package.json
    gate: type
    dependsOn: [S1]
    acceptance:
      - `typecheck:plugin` borrado.
      - `test:plugin` borrado.
      - `bun run lint:command-coverage` sigue verde (la cobertura de
        comandos del producto no depende de esos scripts).
  - sliceId: S4
    title: "refactor(pkg): package.json#files no menciona packages/plugins/ ni integrations/"
    files:
      - package.json
    gate: type
    dependsOn: [S3]
    acceptance:
      - `files` lista sólo rutas del producto (`bin/`, `packages/`,
        `scripts/`, `docs/...`, configs raíz, README, LICENSE).
      - `bun run validate:package` verde.
  - sliceId: S5
    title: "docs: AGENT-BOOTSTRAP §3.7 refleja integrations/delendai/ como integración externa"
    files:
      - docs/delendai/AGENT-BOOTSTRAP.md
    gate: type
    dependsOn: [S1, S2, S3, S4]
    acceptance:
      - §3.7 declara explícitamente "el plugin vive en
        integrations/delendai/, no es parte del producto".
      - Paths canónicos actualizados.
      - El "qué NO cambia" sigue siendo válido (file: delendai,
        mientras no haya release).
---

# x00045 — Terminar x00041

## Contexto

x00041 (status: done) hizo la mitad del trabajo: movió la carpeta
del plugin y creó el workflow opcional de integración. Pero el
contrato de la propuesta era **cinco** puntos de acoplamiento a
eliminar, y los pasos S2 y S3 quedaron a medias:

| Punto | x00041 esperado | Estado real |
|-------|------------------|-------------|
| `workspaces` raíz | sin plugin | ✅ `workspaces: []` |
| `files` del tarball | sin plugin | ❓ por verificar (S4) |
| `bun run typecheck` | sin sección plugin | ❌ `typecheck:plugin` sigue ahí |
| CI principal | sin clone/build de Delendai | ❌ sigue clonando, compilando y enlazando |
| `delendai-sha.constant.ts` | borrado | ❌ sigue existiendo |

## Decisión

No reabro x00041 (el frontmatter `shippedIn:` documenta los SHAs
de S1/S4 y su cierre sigue siendo verdadero en lo que cubría).
Lo que falta es **una propuesta nueva, x00045**, que recoge las
4 acciones restantes como sus propios slices. Esto mantiene
el contrato de x00032 (lint:proposals garantiza que "done"
significa "todo cerrado") sin reescribir el archivo que ya está
en `done/`.

## Diseño de los slices

### S1 — `validate.yml` sin Delendai

El cambio es **mecánico pero verificado**:

````yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.14
      - run: bun install --frozen-lockfile
      - run: bun run validate
      - run: bun run security:audit
      - run: bun run validate:package
````

El `fetch-depth: 0` se mantiene: x00032 S1 lo necesita para
verificar `shippedIn:` reales. Sin los pasos de Delendai,
`bun install --frozen-lockfile` resuelve sólo el producto
porque `workspaces: []` y `bun.lock` no contienen `@delendai/core`.

El comentario explicativo pasa a ser UNA sola línea al inicio del
job: "Tanit valida su propio producto. La integración opcional con
Delendai vive en integration-delendai.yml."

### S2 — Borrar `delendai-sha.constant.ts`

El grep de hoy (`grep -rln 'delendai-sha\|DELENDAI_SHA' packages/`)
sólo encuentra la declaración. No hay imports del core que la
usen — el SHA sólo se leía desde `validate.yml` y desde el
comentario del propio fichero. Borrar el fichero es seguro.

`delendai-report-version.constant.ts` (en `integrations/`) NO se
toca: es del namespace de integraciones, no del core, y describe
el formato del report que produce el plugin.

### S3 — Quitar `typecheck:plugin` y `test:plugin`

`typecheck:plugin` apunta a `packages/plugins/delendai_tanit`,
ruta que no existe desde x00041 S1. Si alguien lo ejecuta, falla
con ENOENT. `test:plugin` apunta a `bunx vitest run --project plugin`,
que tampoco tiene proyecto en el `vitest.config.ts` raíz (el plugin
tiene su propio `vitest.config.ts`).

La forma correcta es: el plugin tiene su propio `package.json#scripts.validate`
(`typecheck && test`), y `integration-delendai.yml` ya lo invoca. El
producto Tanit no necesita un atajo raíz para esa integración.

Si en algún momento alguien quiere un atajo en raíz, el nombre
correcto sería `validate:integration:delendai`, no `typecheck:plugin`.

### S4 — `files` limpio

Verificar `package.json#files`. Hoy declara `bin/`, `packages/`,
`scripts/`, docs, configs raíz. No menciona `integrations/` ni
`packages/plugins/` (este último ni siquiera existe). El slice
S4 sólo verifica que el campo no necesite retoques; si los
necesita, los aplica.

### S5 — AGENT-BOOTSTRAP §3.7

§3.7 ya está actualizado al path `../delendai/...` y a la forma
local `bun run host-server.script.ts`. Lo que falta es la
declaración explícita "el plugin vive en `integrations/delendai/`,
no es parte del producto". Es una nota corta, no un reescrito.

## Lo que NO cambia

- `integration-delendai.yml` — sigue válido.
- `delendai.config.json#plugins.tanit.path` apunta a
  `integrations/delendai/src/index.ts` (o lo hará tras verificar).
- `@delendai/core` sigue siendo dependencia `file:` del plugin.
- El producto no se reorganiza; sólo se elimina el acoplamiento
  con Delendai de su CI y de sus scripts.

## Por qué esto va antes que el resto de P1

El `validate.yml` está verde en local y rojo en CI por el `bun install`
del runner. Eso bloquea merges y pide una pasada de integración
verifier tras cada push a develop. Cualquier propuesta nueva que
toque `validate.yml` o `package.json` colisiona con este estado
rojo hasta que se cierre. Terminar x00041 (es decir, ejecutar
x00045) deja el camino crítico verde y desbloquea todo lo demás.