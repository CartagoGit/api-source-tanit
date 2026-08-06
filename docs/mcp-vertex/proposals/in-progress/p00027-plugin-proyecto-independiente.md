---
id: p00027
title: "p00027 — el plugin de mcp-vertex como proyecto independiente"
kind: fix
status: in-progress
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00003 # el plugin de testing original
    - p00007 # @mcp-vertex/core sigue entrando por `file:`
    - p00013 # bugs previos del plugin
    - p00026 # avisos del editor: el tsconfig del plugin sale de ahí
    - p00028 # gates por sección: el plugin es una de ellas
---

> **En curso.** S1, S2 y S3 cerradas el 2026-08-06. S4 (dependencia por
> paquete en vez de `../../../../../`) queda para la reorganización de
> carpetas, porque el destino de `scanner-registry` lo decide p00020.

# p00027 — el plugin como proyecto independiente

## por qué

`plugins/postman-exporter/` no es una carpeta más del CLI: es un
paquete propio que se publica aparte y que mcp-vertex carga en su
proceso. Estaba tratado como un anexo, y eso había dejado cuatro cosas
rotas **a la vez, todas en silencio**:

### 1. `ctx.workspace.toString()` devolvía `"[object Object]"`

Los cuatro tools resolvían la raíz del workspace así:

```ts
const workspaceRoot = ctx.workspace.toString();
```

Pero el contrato de mcp-vertex es `IWorkspacePathProvider`, un objeto
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
- Quitar el `file:` de `@mcp-vertex/core`. Eso es p00007, y depende del
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
  (`createWorkspacePathProvider`) en vez de imitarla. Si mcp-vertex
  cambia la forma del proveedor, los tests se enteran.
- `captureHandler` y `registeredTools` compartidos: estaban duplicados
  en dos specs y ausentes en el tercero.
- **Aceptación**: ningún spec construye su propio `workspace`.

### S2 — informe máquina en vez de parsear texto
- **Estado**: done (2026-08-06)
- **Ficheros**: `contract/generate-report.interface.ts` (nuevo),
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
- **Estado**: ready
- **Ficheros**: `plugins/postman-exporter/package.json`, `package.json`
  de la raíz (`exports`), 3 ficheros de `src/`.
- **Gate**: `grep -r '\.\./\.\./\.\./\.\./\.\.' plugins/` sin resultados.

Tres ficheros de `src/` trepan hasta el código del CLI:

```
src/lib/tools/test.tool.ts        → "../../../../../service/scanner-registry"
src/lib/tools/summary.tool.ts     → "../../../../../service/summary.service"
src/lib/helpers/smoke-runner.ts   → "../../../../../contract/scanner.interface"
```

Consecuencia medible: esos ficheros entran en el programa de TypeScript
del plugin y heredan **sus** reglas, no las suyas. Activar
`noUncheckedIndexedAccess` y `noUnusedLocals` en el plugin producía 30
errores en ficheros que este proyecto no mantiene, así que hubo que
dejarlos apagados.

El arreglo es declarar `@postman-exporter/cli` como dependencia de
workspace e importar por especificador. Requiere que el `exports` de la
raíz cubra `scanner-registry`, que hoy no encaja con el patrón
`./service/*` → `*.service.ts`. Se hace junto a p00020, que es quien
decide dónde acaba viviendo el registro.

- **Aceptación**: `noUncheckedIndexedAccess` y `noUnusedLocals` vuelven
  a estar activos en el tsconfig del plugin, con 0 errores.

## aceptación global

- `bunx vitest run --project plugin` verde.
- Los dos tsconfig del plugin a 0 errores.
- Ningún tool usa `toString()` sobre el workspace.
- Ningún parser del plugin lee texto pensado para personas.
