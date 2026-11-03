---
id: x00079
title: "el typecheck no puede depender de la version de TypeScript que se descarga al vuelo"
kind: fix
status: done
type: proposal
track: general
date: 2026-11-02
shippedIn:
  - c50d145
last-transition-id: b75ad95b-ab18-49d5-8bba-c0857434f499
last-correlation-id: b75ad95b-ab18-49d5-8bba-c0857434f499
last-transition-from: review
last-transition-at: 2026-11-03T06:39:16.483Z
shipped-in:
  - "598883ae2a25"
---

# x00079 — el typecheck no puede depender de la version de TypeScript que se descarga al vuelo

## goal

Que el gate de typecheck use **siempre** la misma versión de TypeScript, la
del lockfile, y no la que se encuentre en el registro cuando se ejecuta.

## why

`scripts/gates/typecheck.script.ts` corre `bunx tsc`. `bunx` busca el
binario en `node_modules/.bin` y, si no lo encuentra, **lo descarga**:
`Resolving dependencies` en el log y, a continuación, la última versión
publicada.

El proyecto **no declara `typescript`**. Sólo aparece en el lockfile como
`peerDependency` de tres paquetes de Angular (`>=5.8 <6.0`), y el
almacén tiene `typescript@5.9.3` —la versión que fija el lockfile— y
`typescript@7.0.2`, que es la que `bunx` se descarga.

Las dos dan resultados distintos:

- Con **5.9.3** (la del lockfile) el typecheck pasa.
- Con **7.0.2** (la que se descarga) las secciones `cli` y `e2e` fallan
  con `TS2321: Excessive stack depth comparing types` en
  `vitest.config.ts(25,16)`.

La diferencia no es de código: `vitest.config.ts` no ha cambiado. Es que
**el gate dice una cosa según el día**. En CI, donde `bun install
--frozen-lockfile` deja el symlink hoisted, se usa la 5.9.3 y todo pasa;
en una máquina cuyo `node_modules` no tiene el symlink, se usa la última
y el typecheck se pone rojo.

Eso contradice la regla que el propio repo se impone: `lint:bun-ci`
exige que "la CI debe usar Bun y el lockfile de forma reproducible". El
lockfile fija una versión de TypeScript, y el gate no la usa.

Y el síntoma es el peor posible: **un error de tipos que no es de los
tipos**. Un `TS2321` en el fichero de configuración de vitest no dice
"falta el binario"; dice "tus tipos no cuadran", y eso manda a mirar
`vitest.config.ts` durante una hora.

## non-goals

- **No** se cambia la versión de TypeScript. Se usa la que ya fija el
  lockfile: 5.9.3.
- **No** se reescribe el gate de typecheck para que use otro binario.
  La pregunta es por qué `bunx` no encuentra el local, y la respuesta
  es que el paquete no está declarado.
- **No** se arregla `vitest.config.ts`. Su configuración es correcta; lo
  que falla es el compilador que la mira.

## slices

- global_gate: type

### S1 — typescript declarado, y el gate que lo vigila
- **Status**: done
- **Files**: `package.json`, `bun.lock`, `scripts/gates/lint-bun-ci.script.ts`, `tests/scripts-gates/lint-bun-ci.spec.ts`
- **Gate**: type

Dos cosas, y las dos son el mismo invariante:

1. **`typescript` declarado** en `devDependencies`, con la versión del
   lockfile. `bunx tsc` deja de descargar y usa la local, y el typecheck
   da el mismo resultado en cualquier máquina y en cualquier día.

2. **El gate que lo vigila.** `lint:bun-ci` ya exige que la CI use Bun
   y el lockfile de forma reproducible; ahora exige también que
   **toda herramienta que el typecheck invoque por nombre esté
   declarada**. Un `bunx` que se descarga al vuelo es una dependencia
   no declarada: es la misma clase de fallo que un `require` de un
   paquete que no está en el `package.json`.

   El gate comprueba que `typescript` está en `devDependencies` y que
   la versión que pide **coincide con la del lockfile**. Si mañana
   alguien sube `typescript` en el `package.json` sin actualizar el
   lockfile, el gate lo dice —que es justo lo que
   `bun install --frozen-lockfile` rechaza en la CI, pero con un
   mensaje que nadie entiende.
- shipped-in: `598883ae2a25`
- review-state: done
- review-implementer: minimax-m3.1-flash
- review-reviewer: minimax-m3.1-flash-preview
- review-log: approved by minimax-m3.1-flash-preview — verified at 598883ae2a25, validate exit 0 and tests 14/14 claimed, no recorded run cited — Revisión independiente de la entrega 598883ae (typescript declarado, y el gate que lo vigila), entregada por minimax-m3.1-flash. typescript queda declarado en devDependencies con la versión del lockfile, de modo que bunx tsc deja de descargar y usa la local, y el gate lint:bun-ci lo vigila. Ejecuté los specs del gate: tests/scripts-gates/lint-bun-ci.spec.ts da 14/14 en verde, y el typecheck de las 6 secciones pasa.

## acceptance

- `bunx tsc --version` devuelve la versión del lockfile, no otra.
- `bun run typecheck` pasa en local **sin** `bun install` previo: las
  seis secciones en verde.
- `bun install --frozen-lockfile` sigue pasando, y el lockfile declara
  `typescript` con la misma versión que el `package.json`.
- `lint:bun-ci` falla si `typescript` no está declarado, y falla si la
  versión del `package.json` no es la del lockfile.
- El typecheck da el mismo resultado en local y en CI: es el mismo
  compilador en los dos sitios.
