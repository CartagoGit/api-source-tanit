---
id: p00027
title: "p00027 — el plugin de delendai como proyecto independiente"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00003 # el plugin de testing original
    - p00007 # @delendai/core sigue entrando por `file:`
    - p00013 # bugs previos del plugin
    - p00026 # avisos del editor: el tsconfig del plugin sale de ahí
    - p00028 # gates por sección: el plugin es una de ellas
---

> **Cerrada el 2026-08-07.** S1, S2 y S3 el 2026-08-06. S4 se retira con
> evidencia: el arreglo que proponía (dependencia de paquete en vez de
> `../../../../../`) resultó peor que el problema, y el problema que
> decía resolver lo resolvió p00043 por otra vía. Los detalles y las
> medidas, en su sección.

# p00027 — el plugin como proyecto independiente

## por qué

`plugins/postman-exporter/` no es una carpeta más del CLI: es un
paquete propio que se publica aparte y que delendai carga en su
proceso. Estaba tratado como un anexo, y eso había dejado cuatro cosas
rotas **a la vez, todas en silencio**:

### 1. `ctx.workspace.toString()` devolvía `"[object Object]"`

Los cuatro tools resolvían la raíz del workspace así:

```ts
const workspaceRoot = ctx.workspace.toString();
```

Pero el contrato de delendai es `IWorkspacePathProvider`, un objeto
plano `{ root, resolve }` sin `toString()` propio. En ejecución real,
los cuatro tools trabajaban sobre la ruta `"[object Object]"`.

Los tests no lo veían porque los tres specs se fabricaban el contexto a
mano, cada uno distinto y **los tres mal**: uno pasaba
`new URL("file://…/")`, otro `"file://" + process.cwd()`. Ambos tienen
un `toString()` que devuelve algo con pinta de ruta, así que los tests
pasaban en verde sobre un contrato que no era el real.

### 2. El plugin parseaba prosa, y la prosa cambió de idioma

`parseGenerateOutput` sacaba la ruta de la colección con
`/Colecci[oó]n escrita en (.+)/`. Cuando el CLI se tradujo al inglés
(`Collection written to …`) el regex dejó de casar y el tool empezó a
devolver `ok: true` con `collectionPath: "<no detectado>"` y
`requests: 0`. Medido antes de tocar nada:

```
parseGenerateOutput: { "collectionPath": null, "environmentPaths": [4 rutas] }
parseRequestCount:   null
```

Un éxito que no lo era, que es la peor forma de fallar.

### 3. `Bun` a pelo hacía inalcanzable su propio fallback

`runner.helper.ts` hacía `(Bun as {...}).spawnSync` en el top level.
Fuera de Bun eso no es `undefined`: es un `ReferenceError` al evaluar el
módulo. O sea que la rama "ejecución vía Node puro" que el propio
fichero documenta no se podía alcanzar nunca.

Al desbloquearla apareció un segundo fallo debajo: cuando el proceso no
llega ni a arrancar (cwd inexistente), `stderr` es `""`, y el
`stderr ?? String(error)` se quedaba con la cadena vacía. El consumidor
recibía `ok: false` sin ningún `detail`.

### 4. El tsconfig se contradecía y no cubría los tests

`noEmit: true` junto a `declaration: true` y `outDir`. Y un solo
proyecto para `src/` y `tests/`, con lo que los tipos de vitest podían
colarse en el código que se publica.

## no-objetivos

- Publicar el plugin en npm. Eso es p00008.
- Quitar el `file:` de `@delendai/core`. Eso es p00007, y depende del
  otro repo.

## slices

### S1 — el contrato con el host, bien
- **Estado**: done (2026-08-06)
- **Ficheros**: `src/lib/tools/*.ts`, `tests/helpers/plugin-context.ts`
  (nuevo), los 3 specs.
- **Gate**: `bunx vitest run --project plugin` verde.

- `ctx.workspace.toString()` → `ctx.workspace.root` en los 4 tools.
- Un único doble compartido en `tests/helpers/plugin-context.ts`, cuyo
  workspace se construye con la **fábrica real** del core
  (`createWorkspacePathProvider`) en vez de imitarla. Si delendai
  cambia la forma del proveedor, los tests se enteran.
- `captureHandler` y `registeredTools` compartidos: estaban duplicados
  en dos specs y ausentes en el tercero.
- **Aceptación**: ningún spec construye su propio `workspace`.

### S2 — informe máquina en vez de parsear texto
- **Estado**: done (2026-08-06)
- **Ficheros**: `contracts/generate-report.interface.ts` (nuevo),
  `scripts/generate.script.ts`, `src/lib/helpers/runner.helper.ts`,
  `src/lib/tools/generate.tool.ts`,
  `tests/cli/generate-json-report.test.ts` (nuevo),
  `tests/unit/runner.helper.spec.ts` (nuevo).
- **Gate**: `bun run test:cli && bun run test:plugin`.

- `generate --json` emite un documento JSON versionado por stdout; la
  traza legible se va a stderr, que es donde va lo que acompaña a un
  resultado sin formar parte de él.
- El plugin lo valida con zod y rechaza una versión que no sepa leer,
  con un mensaje que dice qué hacer.
- Fuera `parseGenerateOutput`, `parseRequestCount` y `parseTestSummary`
  (esta última ni se usaba).
- `IGenerateOutput` gana `framework`, `collectionId` y `auth`: el
  agente ya no tiene que volver a leer el fichero para saberlo.
- **Aceptación**: un test comprueba que el texto legible **no** cuela
  como informe, y otro que stdout es exactamente un JSON.

### S3 — dos tsconfig y vitest propio
- **Estado**: done (2026-08-06)
- **Ficheros**: `tsconfig.json`, `tsconfig.test.json` (nuevo),
  `vitest.config.ts` (nuevo), `package.json`, `.vscode/settings.json`
  (nuevo), `.gitignore` de la raíz.
- **Gate**: `bun run --cwd plugins/postman-exporter typecheck`.

- `tsconfig.json` tipa **solo `src/`**: es lo que acaba en `dist/`, y
  así los tipos de vitest no pueden colarse en el paquete publicado.
- `tsconfig.test.json` tipa los tests, con `vitest/globals` y sin
  `noUnusedLocals` (en un doble es normal declarar de más).
- `vitest.config.ts` propio, recogido por el glob `plugins/*` del root.
- `bun.lock`: asociación a `jsonc` también dentro del plugin, porque
  los settings de la raíz no aplican cuando se abre esta carpeta sola.
  Y el lockfile pasa a versionarse — estaba en `.gitignore`, con lo que
  ni CI ni otra máquina resolvían las mismas versiones.
- **Aceptación**: los dos proyectos typechequean a 0 errores.

### S4 — dependencia por paquete, no por ruta relativa
- **Estado**: retirada con evidencia (2026-08-07). El diagnóstico era
  correcto; el arreglo propuesto es peor que el problema.
- **Gate original**: `grep -r '\.\./\.\./\.\./\.\./\.\.' plugins/` sin
  resultados.

Cinco ficheros de `src/` trepan hasta el código del CLI (eran tres; las
rutas cambiaron con p00020):

```
src/lib/tools/test.tool.ts           → "../../../../../frameworks/framework.registry"
src/lib/tools/summary.tool.ts        → "../../../../../frameworks/index"
src/lib/tools/generate.tool.ts       → "../../../../../frameworks/index"
src/lib/contracts/plugin.interface.ts→ "../../../../../frameworks/index"
src/lib/helpers/smoke-runner.helper.ts → "../../../../../core/contracts/scanner.interface"
```

**Lo que se midió al intentarlo.** Se declaró `export-to-postman` como
dependencia `file:../../..`, se ajustó el `exports` de la raíz y se
cambiaron los cinco imports por especificador. Typechequea, pero:

> Bun **copia** un `file:` en vez de enlazarlo. Se comprobó con inodos
> distintos y con la prueba directa: se añade un `export` a
> `packages/frameworks/index.ts` y la copia de
> `node_modules/.bun/export-to-postman@root/` no lo ve. El plugin
> tiparía y testearía contra una **foto congelada** del repo hasta el
> siguiente `bun install`.

Eso es peor que la ruta fea: una copia que diverge en silencio es
exactamente la clase de fallo contra la que va medio repositorio
(`lint:paths`, `lint:docs`, `root.helper.ts`). `link:` no vale — exige
un `bun link` previo, no acepta una ruta.

**Y el diagnóstico ya no aplica.** La premisa era que las rutas
relativas impedían activar las reglas estrictas. Comprobado al reabrir:

| Regla | Errores | Dónde |
| --- | --: | --- |
| `noUncheckedIndexedAccess` | 0 | — (p00043 los arregló en todo el repo) |
| `noUnusedLocals` | 3 | `@delendai/core`, **otro repositorio** |

Los tres son de `assemble-plugins.ts` y `wire-plugin.ts` de
`@delendai/core`, que entra por `customConditions:
["@delendai/source"]` — a propósito, para que el plugin se entere si el
core cambia de forma. `skipLibCheck` no los tapa porque son `.ts`, no
`.d.ts`. No son nuestros para arreglar, y renunciar a la condición para
callarlos sería cambiar corrección por silencio.

- **Resultado**: `noUncheckedIndexedAccess` **activada** en el tsconfig
  del plugin, 0 errores. `noUnusedLocals` sigue fuera, y ahora el
  comentario del tsconfig dice el motivo de verdad en vez de acusar a
  las rutas relativas.

## aceptación global

- `bunx vitest run --project plugin` verde.
- Los dos tsconfig del plugin a 0 errores.
- Ningún tool usa `toString()` sobre el workspace.
- Ningún parser del plugin lee texto pensado para personas.
