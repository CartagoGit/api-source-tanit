---
id: x00046
kind: test
title: "x00046: el e2e multi-service-isolation debe pasar también en CI (no sólo en local)"
status: done
priority: P1
globalGate: e2e
shippedIn:
  - 1f42832
why: |
  El e2e de x00028 S4 (`tests/e2e/multi-service-isolation.spec.ts`)
  verifica que dos workspaces Bun (`apps/users-api` y
  `apps/orders-api`) con un `GET /health` cada uno produzcan
  colecciones Postman separadas, sin que las rutas se crucen.

  **En local pasa** (comprobado en este repo con el fixture
  `tests/fixtures/multi-service-isolation/`). En CI falla porque
  `bun install --frozen-lockfile` resuelve los workspaces del fixture
  de forma distinta entre el runner de GitHub Actions y el puesto
  del desarrollador: el scanner del `apps/orders-api` ve cero
  rutas y el assert
  `apps_orders should have exactly one GET /health, got []` se
  dispara.

  El workaround actual — `TANIT_SKIP_MULTI_SERVICE_ISOLATION=1`
  exportado desde `.github/workflows/validate.yml` — desactivó el
  test sólo en CI. Eso es exactamente el patrón que la auditoría
  2026-09-05 señaló como inaceptable: si el multi-service se rompe
  en CI pero no en local, las regresiones pasan y la cobertura
  E2E deja de proteger. La auditoría lo puntuaba como **P1 alto**.

  x00045 (este PR/commit) levanta la frontera producto↔Delendai y
  aprovecha para eliminar el flag del workflow. Eso expone el bug
  al runner: `bun run validate` fallará en CI hasta que x00046
  cierre la regresión. La propuesta `x00046` es, por tanto, el
  siguiente paso natural; sin ella, develop queda en estado
  "rojo permanente en CI".

nonGoals:
  - Tocar x00028 S1/S2/S3 (esos están cerrados y verificados).
  - Reescribir el spec con mocks de Bun workspaces (eso sólo
    verificaría el orquestador, no la integración real).
  - Cambiar el fixture ni añadir servicios nuevos.
  - Mover el e2e a una workflow dedicada — el camino crítico es
    `validate.yml` y el e2e debe pasar ahí.
globalGate: e2e
acceptance:
  - `tests/e2e/multi-service-isolation.spec.ts` corre dentro de
    `bun run validate` (en CI, no sólo en local) y pasa.
  - `.github/workflows/validate.yml` NO exporta
    `TANIT_SKIP_MULTI_SERVICE_ISOLATION` (x00045 ya lo eliminó;
    este slice verifica que no vuelve).
  - El spec deja de auto-skip-arse por env var — el helper
    `SKIP_IN_CI` se elimina o se reemplaza por una detección real
    de "el fixture no está listo" (no de "estamos en CI").
  - Si la causa raíz está en la resolución de workspaces Bun,
    la corrección es **del fixture o de cómo el scanner
    navega workspaces**, no de un mock que oculte la divergencia.
  - `bun run validate` verde en local Y el equivalente en CI
    (verificable empujando a una rama con CI encendida).
slices:
  - sliceId: S1
    title: "investigar: reproducir el fallo del e2e en CI y aislar la causa"
    files:
      - tests/e2e/multi-service-isolation.spec.ts
      - tests/fixtures/multi-service-isolation/
    gate: e2e
    dependsOn: []
    acceptance:
      - Documento breve (en la propuesta o en un comentario del spec)
        que identifica la causa: ¿es `bun install` quien resuelve
        distinto? ¿es el scanner que mira `node_modules` con un
        orden distinto? ¿es `process.cwd()` del runner vs el
        checkout path?
      - Logs reproducibles: un `bun run test:e2e` local con
        `BUN_INSTALL_FROZEN_LOCKFILE=1` y un `GITHUB_ACTIONS=true`
        local muestra lo mismo que CI (o se documenta por qué no).
  - sliceId: S2
    title: "fix: el e2e pasa también en CI (fixture, spec, scanner, lo que sea)"
    files:
      - tests/e2e/multi-service-isolation.spec.ts
      - tests/fixtures/multi-service-isolation/**
      - packages/core/discovery/generation.pipeline.ts (si la causa está aquí)
    gate: e2e
    dependsOn: [S1]
    acceptance:
      - El spec pasa con `GITHUB_ACTIONS=true` local Y en CI real.
      - El fix es honesto: si es de fixture, el fixture documenta
        por qué funciona en cualquier runner; si es del scanner,
        el scanner explica su suposición de resolución de
        workspaces; si es del spec, el spec justifica su
        tolerancia.
      - `SKIP_IN_CI` eliminado o reducido a una condición real
        (p.ej. "el fixture no está presente").
  - sliceId: S3
    title: "ci: TANIT_SKIP_MULTI_SERVICE_ISOLATION declarado forbidden en validate.yml"
    files:
      - .github/workflows/validate.yml
      - scripts/gates/lint-no-skip-flags.script.ts (nuevo)
    gate: e2e
    dependsOn: [S2]
    acceptance:
      - Gate `lint:no-skip-flags` (o nombre equivalente) falla si
        alguien vuelve a exportar `TANIT_SKIP_*` desde
        `validate.yml`. Patrón: grep en el workflow + lista
        permitida de env vacía para el producto.
      - El gate corre dentro de `bun run lint` (parte de validate).
---

# x00046 — multi-service-isolation debe pasar también en CI

## Contexto

El auditor 2026-09-05 puntuó el estado del multi-service E2E como
**P1 alto** (nota 6.5/10 en "coordinación entre agentes", 4.5/10 en
"CI real"). El síntoma: en CI se exporta
`TANIT_SKIP_MULTI_SERVICE_ISOLATION=1` y el test que verifica la
regresión más cara del proyecto (dos workspaces, mismo método+URI,
resultados distintos) no corre en el runner.

x00045 levantó la frontera producto↔Delendai. Aprovechó para
quitar el flag del workflow. Eso **rompe CI en este momento** (el
e2e no ha sido arreglado), pero a cambio deja la deuda visible: ya
no se esconde detrás de una variable de entorno.

## Decisión

No reabro x00028 (sus 4 slices están cerrados y verificados). La
regresión NO está en x00028 — está en cómo `bun install` resuelve
los workspaces del fixture en el runner de GitHub Actions. x00028
construyó el spec correcto; x00046 lo hace pasar en CI.

## Diseño de los slices

### S1 — investigar

Lo primero es **reproducir** el fallo. El comentario al inicio del
spec dice "logs muestran `apps_orders should have exactly one GET
/health, got []`", pero no da los logs reales. Sin logs, cualquier
fix es un guess.

Pasos esperados:

1. Crear una rama `x00046-repro` que ya quite el flag del
   workflow y commitea sólo eso.
2. Empujar a develop (o a una rama con CI encendida) y leer el
   log real del step "Validate".
3. Localmente: `GITHUB_ACTIONS=true BUN_INSTALL_FROZEN_LOCKFILE=1
   bun run test:e2e -- tests/e2e/multi-service-isolation.spec.ts`.
   ¿Pasa? Si sí, el problema es del runner; si no, es del fixture
   o del spec.
4. Identificar la causa raíz: ¿es el orden de `node_modules`?
   ¿es la presencia/ausencia de un `bun.lock` por workspace?
   ¿es un path que el runner trata como root?

El output es un documento breve (puede vivir como comentario
extenso en el spec, o como apéndice de esta propuesta) que
describe la causa con evidencia, no con hipótesis.

### S2 — el fix

Sin ver la causa, sé大致 qué formas puede tomar:

- **Si es el fixture**: añadir `bun.lock` por workspace o un
  `bunfig.toml` que fuerce la resolución esperada.
- **Si es el scanner**: el scanner probablemente asume
  `process.cwd()` o un path relativo que el runner resuelve
  distinto. Reemplazar con `IProjectContext` (ya canónico en el
  core desde r00009).
- **Si es el spec**: el spec asume algo del fixture que no es
  cierto en CI. Aclarar y/o tolerar el caso legítimo.

Lo que NO se debe hacer es añadir un mock del fixture ni
convertir el e2e en unit test. La regresión que el e2e protege
es **integration real**: dos workspaces, scanner real, generación
real. Si el test pasa con mocks, no protege nada.

### S3 — gate anti-regresión

Cualquiera puede volver a poner
`TANIT_SKIP_MULTI_SERVICE_ISOLATION=1` en `validate.yml` y CI
vuelve a verde "por arriba". Para evitarlo:

- Gate `lint:no-skip-flags` (o el nombre que el delivery-verifier
  apruebe): grep en `.github/workflows/validate.yml` para
  detectar export de variables `TANIT_SKIP_*` o `*_SKIP_*`.
- Lista permitida documentada (vacía al principio).
- Gate falla si se reintroduce el patrón.
- Corre dentro de `bun run lint`.

## Por qué esto va antes que el resto de P1

x00045 ya eliminó el flag. Sin x00046, develop queda en rojo
permanente. La auditoría lo dijo con claridad: "P1 — integration
verifier obligatorio después de trabajo paralelo". Esta propuesta
ES el integration verifier para x00045. Cierra su propio bucle.

## Trabajo posterior (fuera de scope)

- **b00002** (futuro): branching strategy — proteger `develop`
  con CI required. Hoy `develop` sigue sin checks obligatorios.
- **x00047** (futuro): allowlist de raíz para que un `t` u otro
  fichero basura no pueda commit-earse. Ver x00045 / análisis
  2026-09-05.

Estos los abordan otras propuestas; x00046 sólo cierra el bucle
multi-service-isolation.