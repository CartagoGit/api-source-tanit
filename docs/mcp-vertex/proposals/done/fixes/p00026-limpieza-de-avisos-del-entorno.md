---
id: p00026
title: "p00026 — limpiar los avisos del editor (tsconfig del plugin, bun.lock)"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
---

> **Cerrada 2026-08-06.** Las cuatro slices.
>
> S3 se resolvió por otro camino del previsto: en vez de meter
> `plugins/` en el `include` de la raíz, el plugin es una **sección
> propia** del gate con sus DOS tsconfig (el que se publica y el de
> sus tests), y `typecheck` delega en su script. Eso evita el choque
> entre `@types/node` y las declaraciones a mano de
> `contracts/postman.d.ts` que la propuesta daba por pendiente: cada
> proyecto tipa con lo suyo.
>
> S4: el `$generado` que el generador de `.vscode/mcp.json` metía
> como clave JSON no está en el esquema de VS Code y salía en el
> panel de problemas — ahora va como comentario JSONC. Y se han
> devuelto los comentarios de los cinco tsconfig, que se perdieron
> al reescribirlos programáticamente durante p00020.


> **En curso.** S1 (rootDir del plugin + errores de tipos que el gate
> nunca vio) y S2 (bun.lock como JSONC) hechas el 2026-08-06. S3 y S4
> pendientes.

# p00026 — limpiar los avisos del editor

## Goal

Abrir el repositorio en VS Code sin errores ni avisos que no
correspondan a problemas reales.

## why

Dos avisos permanentes que enseñan ruido y entrenan a ignorarlo:

### 1. `rootDir` del plugin

```
El archivo '…/plugins/postman-exporter/tests/integration/summary.tool.spec.ts'
no está en "rootDir" '…/plugins/postman-exporter/src'.
```

`plugins/postman-exporter/tsconfig.json` declara `rootDir: "./src"` pero
`include` trae también `tests/**/*`. Con `noEmit: true`, `rootDir` no
sirve para nada: solo existe para calcular la estructura de salida, y no
hay salida.

### 2. `bun.lock` con comas finales

El editor lo abre como JSON estricto y marca cada coma final. Pero el
lockfile de Bun es **JSONC** por diseño; el fichero no está mal. Lo que
falta es decirle al editor cómo tratarlo.

Editar el lockfile a mano sería el arreglo equivocado: Bun lo regenera
igual en el siguiente `bun install`.

## non-goals

- Cambiar el formato del lockfile ni pasarlo a `bun.lockb`.
- Añadir `@types/node` al proyecto raíz. Las declaraciones a mano de
  `contracts/postman.d.ts` son una decisión tomada.

## slices

### S1 — quitar `rootDir` del tsconfig del plugin
- **Files**: `plugins/postman-exporter/tsconfig.json`.
- **Gate**: `bun run typecheck` y sin errores en el editor.

- **Acceptance**: abrir cualquier `*.spec.ts` del plugin no muestra
  errores.

### S2 — asociar `bun.lock` a JSONC
- **Files**: `.vscode/settings.json`.
- **Gate**: revisión manual.

- `"files.associations": { "bun.lock": "jsonc" }`.
- **Acceptance**: el fichero se abre sin avisos y sigue regenerándose
  igual.

### S3 — meter el plugin en el gate de tipos
- **Estado**: done (2026-08-06)
- **Files**: `plugins/postman-exporter/tsconfig.json`, `package.json`.
- **Gate**: `bun run typecheck` cubriendo también `plugins/`.

`bun run typecheck` usa el `tsconfig.json` de la raíz, cuyo `include`
lista `contracts/`, `services/`, `helpers/`, `scripts/` y
`examples/example-app/`. **`plugins/` no está**, así que el plugin nunca
se ha typecheckeado en el gate. Comprobado el 2026-08-06: tenía 5
errores, dos de ellos reales (una anotación `readonly[]` sobre un array
al que se hace `push`, y un `{ ok: true, ...out }` donde `out` ya trae
`ok` y lo sobrescribe). Corregidos en el commit de p00026 S1.

Lo que queda es la parte fina: el plugin compila contra `@types/node`
real mientras el resto del repo usa las declaraciones a mano de
`contracts/postman.d.ts`. Las dos fuentes chocan en `spawnSync` y en
`Bun`. Hay que decidir una de las dos vías antes de encadenarlo al gate:

- **(a)** El plugin deja de depender de `@types/node` y usa las
  declaraciones del proyecto.
- **(b)** El plugin mantiene `@types/node` y se typecheckea con su
  propio comando, encadenado aparte en `validate`.

- **Acceptance**: `bun run validate` falla si el plugin deja de
  compilar.

### S4 — barrido de avisos
- **Estado**: done (2026-08-06)
- **Files**: los que salgan.
- **Gate**: abrir el repo en limpio.

- Repasar que no queden más errores del editor en ficheros del repo.
- **Acceptance**: cero errores en el panel de problemas al abrir el
  proyecto.

## acceptance

- `bun run typecheck` verde.
- El panel de problemas de VS Code vacío en un checkout limpio.
