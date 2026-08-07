---
id: p00036
title: "p00036 — modo watch: regeneración automática de colecciones al detectar cambios en rutas"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
---

> **Cerrada el 2026-08-07.** Con una decisión de forma: es
> `expostman watch`, un comando, no un flag `--watch`. Y con el bug que
> tenía que salir sí o sí, que salió.

# p00036 — modo watch

## el peligro, que es lo que gobierna el diseño

Esto no es "poner un `fs.watch` y regenerar". La herramienta **escribe
dentro de lo que vigila**: la colección va a
`<proyecto>/export-to-postman/`, que cuelga de la raíz observada. Un
watcher que no lo tenga en cuenta ve su propia escritura, regenera,
escribe, se ve otra vez — y no para nunca.

Es exactamente la forma del bucle infinito que se llevó por delante una
sesión entera de WSL en este repo (el del `lastIndex` en el scanner de
Fiber, ver `lint:regex-state`). Por eso aquí:

- La carpeta de salida se ignora **siempre**, no por configuración.
- `shouldIgnore` es una función **pura y exportada**, con sus tests: es
  la pieza de la que depende que esto no se cuelgue, y una pieza así
  tiene que poder probarse sin montar un sistema de ficheros.
- Hay un test **de integración** que escribe tres veces en la carpeta de
  salida y comprueba que el watcher no se despierta. Eso no se puede
  comprobar con dobles.

## el bug que salió al escribir ese test

Los tests de integración fallaban: el watcher no reaccionaba a **nada**.

`fs.watch` da la ruta relativa a la carpeta vigilada en Linux y Windows,
y absoluta en algunos casos de macOS. El código pasaba las dos por
`relative(root, fileName)`, y `relative()` sobre una ruta **ya relativa**
la resuelve contra el `cwd`: salía un `../../../../...` que no es nada.
Con el cwd bajo `/tmp`, ese engendro contenía un segmento `tmp`, que está
en la lista de ignorados — así que el watcher descartaba **todos** los
cambios.

Lo peor: los tres tests de "esto NO debe disparar" pasaban en verde.
Claro: no disparaba nada. Sin los dos tests de "esto SÍ debe disparar",
el modo watch se habría publicado sin funcionar y pareciendo probado.

## slices

### S1 — watcher con rebote
- **Estado**: done (2026-08-07)
- **Ficheros**: `projects/core/domain/watcher.service.ts` (nuevo),
  `tests/core/watcher.service.spec.ts` (20 tests),
  `tests/e2e/watch.test.ts` (5 tests).
- `fs.watch` recursivo, sin sondeo (era un no-objetivo). Si el sistema no
  soporta `recursive`, **lanza** en vez de mirar solo el primer nivel:
  vigilar la superficie de un proyecto de API es no vigilar nada, y
  parecería funcionar.
- Rebote de 300 ms, configurable con `--debounce`.
- Nunca hay dos generaciones a la vez. Si llega un cambio mientras se
  regenera, se encola: dos generaciones simultáneas escribirían el mismo
  fichero al mismo tiempo.

### S2 — integración con el CLI
- **Estado**: done (2026-08-07)
- **Ficheros**: `projects/cli/commands/watch.script.ts` (nuevo),
  `projects/cli/cli.script.ts`.

Es un **comando**, no un flag. La propuesta pedía `--watch`, pero el CLI
ya tiene un dispatcher por comandos y un flag que cambia el modo de
ejecución de otro comando —de "haz esto y sal" a "no termines nunca"— no
es una opción de `generate`: es otra cosa.

`--once` genera y sale. Es lo que hace falta en un pipeline: comprobar
que la colección sigue saliendo, sin un proceso que no termina.

Ctrl+C cierra el watcher antes de salir. Sin eso el handle queda abierto
y el proceso no termina.

### S3 — traza en la terminal
- **Estado**: done (2026-08-07)

```
[19:50:58] ✔ 9 requests en 3 carpetas · express · 54 ms
[19:51:12] · cambió src/routes/orders.ts
[19:51:12] ✔ 11 (+2) requests en 3 carpetas · 61 ms
```

El delta (`+2`) es lo que convierte la traza en información: sin él hay
que acordarse de cuántos había antes.

Un fallo al regenerar **no tumba el watcher**: mientras se edita, lo
normal es que un fichero esté a medias un instante.

## aceptación

- Regenera al cambiar un fichero de rutas. ✔ 54 ms en `example-express`,
  muy por debajo de los 500 ms que pedía.
- Sin el comando, nada cambia. ✔
- `bun run validate` verde. ✔ 1660 tests, 19/19 ejemplos.
