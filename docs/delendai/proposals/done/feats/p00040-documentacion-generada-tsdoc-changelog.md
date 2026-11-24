---
id: p00040
title: "p00040 — documentación generada automáticamente: API docs site, JSDoc/TSDoc y CHANGELOG semántico"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00037
shippedIn:
  - 868d16b  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# p00040 — documentación generada automáticamente: API docs site, JSDoc/TSDoc y CHANGELOG semántico

## Goal

Generar automáticamente un sitio de documentación de la API pública del
paquete, completar la cobertura de JSDoc/TSDoc en todos los exports
públicos y automatizar la generación de CHANGELOG a partir de
Conventional Commits.

## why

Un proyecto 11/10 no solo funciona bien, sino que está **documentado
impecablemente**:

1. **TSDoc en exports públicos**: Cada función, interfaz y tipo exportado
   tiene documentación de propósito, parámetros y retorno.
2. **Sitio de docs**: Un site generado (VitePress / TypeDoc) publicable
   en GitHub Pages con guías de uso, API reference y ejemplos.
3. **CHANGELOG automático**: Generado por `conventional-changelog` desde
   los commits `fix:`, `feat:`, `feat!:`.

## non-goals

- Documentar código interno no exportado.
- Mantener el sitio de docs en un repo separado.

> **Cerrada el 2026-08-07.** Con un cambio de forma en S2/S4: no hay
> sitio de docs en GitHub Pages, hay un `docs/API.md` generado y
> comprobado por un gate. El motivo, abajo.

## por qué no hay un sitio de documentación

La propuesta pedía TypeDoc publicado en Pages. Eso son **dos sitios
donde vive la misma información**: los docblocks del código y una copia
generada en otro dominio. La copia es la que se queda vieja — y este
repo lleva la sesión entera arreglando justo esa clase de problema
(`lint:docs`, `lint:paths`, `root.helper.ts`).

Además, el producto principal del paquete es un **CLI**. Su
documentación de uso es `expostman --help`, que ya se genera del propio
dispatcher y del registro de scanners, más los `docs/*.md` que
`lint:docs` verifica enlace a enlace.

Lo que sí faltaba era un índice de lo **importable**: el `exports` deja
entrar `./core/*` y `./frameworks`, y no había forma de saber qué hay
ahí sin abrir las carpetas. Eso es un fichero, no un sitio.

`docs/API.md` se genera con `bun run docs:api` y `bun run lint:api`
falla si se queda atrás. Mismo trato que `.vscode/mcp.json`: generado,
versionado y comprobado, que es lo que impide que mienta.

## el alcance de "export público"

`lint:tsdoc` no exige documentar **todo** lo exportado: exige documentar
lo que **otra persona puede importar**, o sea lo que el `exports` deja
entrar. Un `export` dentro de un scanner existe para que lo vea su test
o el módulo de al lado; pedirle documentación de API sería pedir que se
documente un detalle interno, y un gate que pide de más se acaba
desactivando.

La regla que sí se puede sostener: **si alguien puede escribirlo en un
`import`, tiene que poder leer qué hace sin abrir el fuente.**

Y un docblock de relleno no cuenta. `/** El registro. */` sobre algo
llamado `registry` repite el nombre en prosa: ocupa el sitio del
comentario que hacía falta y además pasaría el gate. Se compara el
vocabulario del texto con el del identificador, y si no aporta ninguna
palabra nueva, se marca.

## slices

### S1 — Cobertura TSDoc 100% en exports públicos
- **Estado**: done (2026-08-07)
- **Ficheros**: `scripts/gates/lint-tsdoc.script.ts` (nuevo) + 36
  docblocks escritos en `packages/core/`.
- Se midió antes: 36 exports públicos sin explicar, entre ellos los
  siete tipos del formato Postman —los que más se importan— y las cinco
  clases de exportador recién añadidas.
- **Files**: `contracts/*.ts`, `services/*.ts` (solo exports), `helpers/*.ts`.
- **Gate**: `bun run lint:docs` (linter de TSDoc coverage).
- Cada función exportada debe tener `@param`, `@returns` y `@example`.

### S2 — Referencia de la API (sin TypeDoc, sin sitio)
- **Estado**: done (2026-08-07) con el cambio de forma explicado arriba.
- **Ficheros**: `scripts/build/api-reference.script.ts` (nuevo),
  `docs/API.md` (generado, 190 símbolos en 42 módulos).
- **Files**: `typedoc.json`, `docs/api/`.
- **Gate**: `bun run docs:build` sin errores.

### S3 — CHANGELOG automático
- **Estado**: done (2026-08-07)
- **Ficheros**: `scripts/build/changelog.script.ts` (nuevo), `CHANGELOG.md`.
- Sin `conventional-changelog`: el formato de commit del repo ya es
  estable y la herramienta traería un árbol de dependencias para leer
  `git log` y agrupar por prefijo.
- Lo que **no** viene de serie y aquí importa: en este repo el asunto
  dice qué se hizo y el cuerpo dice **por qué**. Un CHANGELOG que solo
  copiara los asuntos tiraría justo la mitad que costó escribir, así que
  el primer párrafo del cuerpo va debajo de cada entrada.
- **Files**: `.changelogrc.json`, `CHANGELOG.md`.
- **Gate**: `bun run changelog` genera la versión correcta.

### S4 — GitHub Pages deployment
- **Estado**: no se hace. Ver el razonamiento de arriba: un sitio es una
  segunda copia de lo que ya está en el código, y la copia es la que
  envejece. `lint:api` da la garantía que un Pages no da.
- **Files**: `.github/workflows/docs.yml`.
- **Gate**: push y verificación del site en Pages.

## aceptación

- ~~Sitio de docs navegable~~ → `docs/API.md` generado, versionado y
  **comprobado** por `lint:api`. ✔
- CHANGELOG generado desde los commits, con el porqué de cada uno. ✔
- 100% de cobertura en el área importable, sostenido por `lint:tsdoc`. ✔
- `bun run validate` verde. ✔ 1772 tests, 19/19 ejemplos, **12 lints**.
