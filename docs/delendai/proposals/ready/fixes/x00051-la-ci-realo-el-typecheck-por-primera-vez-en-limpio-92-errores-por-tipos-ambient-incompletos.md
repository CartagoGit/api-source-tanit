---
id: x00051
kind: fix
title: "x00051: la CI corrió el typecheck por primera vez en limpio — 92 errores por ambient types incompletos (@types/node huérfano en local)"
status: ready
priority: P0
globalGate: type
why: |
  x00050 arregló el install de CI (Bun 1.4.2 lee el lockfile v2) y por
  primera vez desde hace días la CI llegó al step "Validate". Ahí
  apareció la verdad: **92 errores de typecheck** que en local nadie
  veía.

  Causa raíz: el puesto de desarrollo tiene `@types/node@26.2.0`
  HOISTED en `node_modules/@types/` — llegó ahí cuando
  `integrations/delendai` era workspace del lockfile raíz. x00045
  sacó el plugin del lockfile, pero el `node_modules` local nunca se
  limpió: tsc encontraba `@types/node` por casualidad (auto-include
  de `node_modules/@types`) y TODO tipaba.

  La CI limpia nunca tuvo ese accidente: install desde lockfile v2
  (sin @types/node declarado en el root package.json) + `types: []`
  en tsconfig.base ⇒ tsc sólo ve las declaraciones ambient manuales
  de `packages/contracts/interfaces/runtime.d.ts`, que es la
  disciplina DECLARADA del repo ("no dependemos de @types/node; las
  ambient las escribimos a mano").

  El problema: runtime.d.ts está incompleto para el código que hoy
  existe porque nadie lo ejercitaba. Los 92 errores se agrupan en:

  1. **runtime.d.ts incompleto** (la mayoría):
     - `node:os` manca `homedir()` (3 ficheros de packages/ui).
     - `node:path` manca `parse()` (browse.service).
     - `node:child_process` manca `execFile` (5 gates que lo usan).
     - `node:util` no existe como módulo (promisify — 5 gates).
     - `performance` global no declarado (bench-scan, 6 usos).
     - `require` no declarado (2 gates + 1 spec lo usan).
     - namespace `NodeJS` no declarado (history.spec).
  2. **Errores reales de código** (pocos):
     - history.service.ts:113 pasa `mode` a un `mkdir` cuya ambient
       sólo declara `recursive` (TS2353) — la ambient manca `mode`,
       el código está bien.
     - ui-dev.script.ts:69 + ui-server.test.ts:50: `new Promise((r)
       => setTimeout(r, ms))` — el ejecutor de Promise ambient espera
       `() => void` y `r` es un resolver con argumento (TS2345). La
       ambient de Promise/executor está mal o el call site debe ser
       `(r) => { setTimeout(() => r(undefined), ms); }`. Decisión: 
       arreglar el call site (el contrato ambient de Promise no se
       toca así).
     - ui-server.test.ts:120,203: `.headers` en `IFetchResponse` —
       falta el campo en el contrato o el test usa un tipo equivocado.
     - gen-index.spec.ts + generate-monorepo-multi-service.spec.ts:
       "Expected 3 arguments, but got 2" (11 sitios) — firma de 
       `spawnSync`/similar en la ambient vs uso. Investigar: si la
       ambient de spawnSync marca obligatorio algo que es opcional en
       Node real, se relaja la ambient; si el test llama mal, se
       arregla el test.
     - lint-proposals.script.ts:457-458 `child.stdout` possibly null
       (TS18047) — guarda null.
     - lint-integration-verifier.script.ts:232 `p` implícito any —
       tipar el parámetro.
     - lint-integration-verifier.script.ts `require("node:fs")` (4
       sitios) — el repo es ESM: usar `import { readFileSync }` como
       el resto del gate. Esto es un bug real del gate nuevo (x00049).
nonGoals:
  - Instalar `@types/node` como dependencia del root: va contra la
    decisión documentada del repo (tsconfig.base `types: []`,
    runtime.d.ts existe precisamente para no depender de @types).
    La opción existe (runtime.d.ts lo dice en su cabecera) pero es
    una decisión arquitectónica aparte; esta propuesta mantiene la
    disciplina actual y la completa.
  - Tocar la CI (x00050 ya la arregló; esto es lo que la CI destapó).
  - Limpiar node_modules locales de otros desarrolladores — pero S3
    añade la protección para que el accidente no se repita.
globalGate: type
acceptance:
  - `bun run typecheck` pasa en 5/5 secciones CON
    `node_modules/@types/node` borrado del root (simulando CI
    limpia). Esta es la prueba real: hoy pasa sólo por el huérfano.
  - Los 92 errores de CI resueltos: ampliando runtime.d.ts (con
    motivo escrito por declaración nueva, igual que las existentes)
    o arreglando el call site cuando el error sea de código real.
  - `lint-integration-verifier.script.ts` deja de usar `require()`
    (ESM correcto).
  - `bun run validate` verde local con @types/node huérfano borrado.
  - CI de develop verde en el HEAD posterior (evidencia empírica
    final).
  - Nuevo gate o extensión de uno existente (S3): `lint:bun-ci` o
    un chequeo nuevo que detecte que el typecheck local NO depende
    de paquetes hoisted huérfanos. La forma más simple y honesta:
    documentar en CONTRIBUTING que hay que validar con install
    limpio, y añadir al integration-verifier una pregunta que
    compare `node_modules/@types/` con lo declarado en
    package.json+lockfile raíz y avise de huérfanos (warning o
    fallo).
slices:
  - sliceId: S1
    title: "fix(types): runtime.d.ts completo — homedir, path.parse, execFile, node:util(promisify), performance, NodeJS"
    files:
      - packages/contracts/interfaces/runtime.d.ts
    gate: type
    dependsOn: []
    acceptance:
      - `node:os` añade `homedir(): string`.
      - `node:path` añade `parse(p)` con el shape que browse.service
        usa (dir, base, name, ext, root).
      - `node:child_process` añade `execFile` (callback + promisified
        shape que los gates usan vía promisify).
      - Módulo `node:util` nuevo con `promisify`.
      - Global `performance` con `now(): number` (bench-scan).
      - Global `require` NO se añade (S2 quita sus usos; el repo es
        ESM y declarar require invitaría a usarlo).
      - Namespace `NodeJS` con lo mínimo que history.spec usa
        (investigar el tipo concreto, probablemente `NodeJS.Timeout`
        o `NodeJS.ProcessEnv`).
      - Cada declaración nueva con comentario de motivo, igual que
        las existentes (la disciplina del fichero).
  - sliceId: S2
    title: "fix(code): errores reales — require→import ESM, executor de Promise, null guards, spawnSync callers"
    files:
      - scripts/gates/lint-integration-verifier.script.ts
      - scripts/build/ui-dev.script.ts
      - tests/cli/ui-server.test.ts
      - scripts/gates/lint-proposals.script.ts
      - tests/cli/gen-index.spec.ts
      - tests/cli/generate-monorepo-multi-service.spec.ts
      - tests/cli/history.spec.ts
      - packages/ui/server/history.service.ts
    gate: type
    dependsOn: [S1]
    acceptance:
      - lint-integration-verifier: `readFileSync` importado de
        `node:fs` arriba, sin `require()`.
      - `new Promise((r) => setTimeout(r, ms))` → forma correcta
        (`setTimeout(() => r(undefined), ms)` o resolver tipado).
      - lint-proposals: guardas `child.stdout`/`child.stderr` null.
      - gen-index.spec / generate-monorepo specs: los 11 "Expected 3
        arguments" resueltos — investigar si la ambient de spawnSync
        es demasiado estricta (relajar con motivo) o el call site
        manca un argumento real.
      - ui-server.test `.headers`: añadir `headers` a
        `IFetchResponse` en contracts (si el fetch real los tiene) o
        arreglar el test. Decisión documentada en el commit.
      - history.service `mode` en mkdir: añadir `mode?: number` al
        mkdir ambient de runtime.d.ts (mkdirSync/mkdir reales lo
        soportan; la ambient estaba incompleta, no el código).
  - sliceId: S3
    title: "test(ci): verificar typecheck con install limpio + detección de huérfanos hoisted"
    files:
      - scripts/gates/lint-integration-verifier.script.ts (pregunta nueva) o scripts/gates/lint-bun-ci.script.ts
    gate: type
    dependsOn: [S1, S2]
    acceptance:
      - Prueba manual documentada: borrar
        `node_modules/@types/node` del root y correr
        `bun run typecheck` — debe seguir verde.
      - El integration-verifier (o bun-ci) añade una comprobación:
        entradas en `node_modules/@types/` que NO están declaradas
        en package.json (dependencies+devDependencies) ni son
        transitivas del lockfile de la raíz → offender
        "type package huérfano hoisted; tu typecheck local miente".
      - `bun run validate` verde con la comprobación activa.
---

# x00051 — La CI destapó 92 errores de typecheck que local no veía

## La historia

El análisis 2026-09-05 decía: "el estado integrado de develop no es
verde; falla en Install dependencies". x00050 arregló el install
(lockfile v2 ⇒ Bun ≥ 1.4). La CI avanzó al step Validate **por
primera vez** — y destapó 92 errores de typecheck.

No son errores nuevos: son errores **siempre presentes en CI-limpio**
que local enmascaraba. `node_modules/@types/node@26.2.0` estaba
hoisted desde que `integrations/delendai` era workspace del root
(pre-x00045). tsc auto-incluye `node_modules/@types/*` salvo que
`types: []` lo bloquee — y el repo SÍ tiene `types: []`. Pero el
auto-include no es lo único: con `@types/node` físicamente presente,
los `import type { X } from "node:..."` que las ambient NO cubren se
resolvían igual por fallback de resolución. Borrado el huérfano, sólo
queda lo que runtime.d.ts declara — que es la disciplina real.

## Disciplina del repo (no negociar en esta propuesta)

`tsconfig.base.json` lo dice con todas las letras:

> `types: []` es deliberado. El paquete no depende de `@types/node`
> ni de `@types/bun`: las declaraciones ambient que necesita están
> escritas a mano.

Y `runtime.d.ts` en su cabecera:

> If at some point we want stricter typechecking or a more complete
> IDE, just install `@types/node` and remove this file.

Esa migración es una decisión arquitectónica legítima pero SEPARADA.
Esta propuesta completa la disciplina existente: runtime.d.ts debe
cubrir TODO lo que el código del repo usa, con motivo por entrada.

## Inventario de los 92 errores (agrupados)

| Grupo | Errors | Fix |
|-------|--------|-----|
| `node:os` manca `homedir` | 3 | S1: ambient |
| `node:path` manca `parse` | 1 | S1: ambient |
| `execFile` no declarado | 5 | S1: ambient |
| `node:util` / `promisify` | 5 | S1: ambient (módulo nuevo) |
| `performance` global | 6 | S1: ambient |
| `NodeJS` namespace | 1 | S1: ambient |
| `require` en ESM (2 gates + 1 spec) | 5 | S2: importar ESM |
| "Expected 3 arguments, but got 2" (spawnSync callers) | 11 | S2: investigar ambient vs call site |
| Promise executor `(r) => setTimeout(r)` | 2 | S2: call site |
| `.headers` en IFetchResponse | 2 | S2: contrato o test |
| `child.stdout` possibly null | 2 | S2: guardas |
| `mkdir mode` no en ambient | 1 | S2: ambient (el código está bien) |
| `p` implícito any | 1 | S2: tipar |
| (resto: duplicados por sección — cli typecheck incluye scripts+ui+tests) | ~47 | cubierto por los fixes anteriores |

Nota: los 92 salen porque `bun run typecheck` corre 5 secciones y
varias compilan los mismos ficheros (cli incluye scripts/, packages/ui,
tests/cli). Los errores ÚNICOS son ~45; al arreglar la raíz, las 5
secciones sanan.

## S3 — que el accidente no se repita

El huérfano sobrevivió porque NADA compara lo que hay en
`node_modules/@types/` con lo declarado. Un gate que liste huérfanos
hoisted cierra la clase completa de "mi local miente".