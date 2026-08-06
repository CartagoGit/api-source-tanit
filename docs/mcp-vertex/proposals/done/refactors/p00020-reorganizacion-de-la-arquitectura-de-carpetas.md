---
id: p00020
title: "p00020 — reorganizar la arquitectura de carpetas por responsabilidad"
kind: refactor
status: done
type: proposal
track: export-to-postman
date: 2026-08-06
related:
    - p00021 # runtime/ se retira como parte de esta reorganización
    - p00022 # el bin multi-lenguaje depende de esta estructura
---

> **Cerrada 2026-08-06.** Las cinco slices.
>
> `projects/{core,frameworks,cli,ui,plugin}` y `scripts/{gates,build}`.
> `core/` queda partido en `contracts/`, `domain/`, `discovery/`,
> `adapters/` y `helpers/`; los 11 comandos salen de `scripts/` y se
> agrupan en `projects/cli/commands/`.
>
> Los movimientos se hicieron con `scripts/gates/move-module.script.ts`,
> nuevo: resuelve cada especificador a ruta absoluta, le aplica el
> movimiento y recalcula la relativa desde donde acabe el fichero. Con
> `sed` esto sale mal de tres formas y las tres pasaron antes de
> escribirlo.
>
> Dos bugs destapados: los gates contaban sus propios `..` hasta la
> raíz y cuatro se quedaron apuntando a otro sitio **sin fallar** (el
> lint decía "no se encontró ninguna propuesta"); y el gate del
> paquete tenía el nombre del bin a fuego, roto desde el renombrado
> del proyecto.


# p00020 — reorganizar la arquitectura de carpetas por responsabilidad

## Goal

Que la estructura de carpetas diga qué hace cada cosa. Hoy hay que abrir
los ficheros para saberlo.

## why

El repositorio creció desde "generador para Laravel" hasta "generador
agnóstico con CLI, binario, plugin MCP y 12 scanners", y la estructura se
quedó en la de la primera versión. Los síntomas concretos:

- **No hay un centro.** Lo que el proyecto *hace* está repartido entre
  `services/`, `helpers/` y `contracts/` en la raíz, al mismo nivel que
  `scripts/`, `examples/` y `docs/`. Nada dice cuál es el núcleo.
- **`services/` mezcla tres cosas distintas**: servicios de dominio
  (`collection-builder`, `auth-flow`), adaptadores (`adapters/`) y el
  registro de scanners (`scanner-registry.ts`), todos al mismo nivel.
- **`scripts/` tiene 13 ficheros planos** que son tres familias
  distintas: comandos del CLI (`generate`, `push`, `list`…), gates de
  calidad (`validate`, `validate-package`, `lint-tool-no-process`) y
  utilidades de build (`build-binary`).
- **Lo específico por lenguaje no está separado de lo común.** Los 12
  scanners viven juntos en `services/scanners/`, pero comparten helpers
  que están en `helpers/`. No se ve qué es agnóstico y qué no.
- **No hay sitio para la UI.** El asistente interactivo acabó en
  `scripts/interactive.script.ts` por no haber un hueco mejor.

## non-goals

- Renombrar las APIs públicas del paquete. Los `exports` del
  `package.json` se mantienen (con alias si hace falta).
- Cambiar el comportamiento. Es un movimiento de ficheros y de imports;
  `bun run validate` debe seguir dando exactamente lo mismo.
- Convertir esto en un monorepo con workspaces por paquete. Sigue siendo
  un paquete; solo se ordena por dentro.

## la estructura propuesta

> **Corregido 2026-08-06.** El boceto original metía `scanners/` y
> `parsers/` DENTRO de `core/`. Eso vuelve a mezclar lo agnóstico con lo
> concreto, que es justo lo que se arregló al separar las capas: el
> núcleo no puede tener una arista hacia un framework, y hay un
> `lint:boundaries` que lo exige. `frameworks/` va al lado de `core/`,
> no dentro.

```
projects/
  core/                    Lo agnóstico. No nombra ni un framework.
    contracts/             interfaces y constantes compartidas
    domain/                collection-builder, auth-flow, param-inferrer,
                           environment-builder, endpoint-merge
    discovery/             generation.pipeline, discovery.orchestrator,
                           project-loader, project-context, project-name,
                           summary
    adapters/              parsed-route-to-spec
    helpers/               uri, fs-walk, source-scan, postman, identity…
  frameworks/              Lo concreto. Depende de core; core NO de él.
    laravel/               scanner + su parser de FormRequests + legacy
    scanners/              los otros 11
    parsers/               zod, joi, pydantic, marshmallow
    framework.registry.ts  el catálogo
  cli/                     Dispatcher + un fichero por comando
    commands/
  ui/                      Asistente interactivo
  plugin/                  Plugin MCP (hoy plugins/postman-exporter)

apps/                      Ejecutables por lenguaje (ver p00022)
bin/                       Puntos de entrada por runtime (ver p00022)

scripts/                   Tooling DEL REPO, no del producto
  gates/                   typecheck, los 4 lints, validate, changed
  build/                   build-binary

examples/                  Un proyecto por framework + README
tests/                     Espejo de projects/
docs/                      Documentación de usuario y de agentes
```

`scripts/tools/` del boceto original desaparece: `diff`, `stats`,
`list-endpoints`, `scan`, `init` y `summary` **son comandos del CLI** (se
invocan por `cli.script.ts`), así que su sitio es `projects/cli/commands/`.
En `scripts/` solo queda lo que sirve al repo y no al producto.

Lo que gana: `projects/core` se puede leer sin saber que existe un CLI, y
un scanner nuevo tiene un sitio evidente.

## slices

### S1 — `projects/core`
- **Files**: mover `contracts/`, `services/`, `helpers/` bajo
  `projects/core/` con la separación de arriba.
- **Gate**: `bun run validate`.

- Los imports se reescriben mecánicamente.
- `package.json` mantiene los `exports` actuales apuntando a las rutas
  nuevas, para no romper a nadie.
- **Acceptance**: `bun run validate` y `bun run validate:package` en
  verde; el tarball sigue trayendo lo mismo.

### S2 — `projects/cli` y `projects/ui`
- **Files**: `scripts/cli.script.ts` + los comandos → `projects/cli/`;
  `scripts/interactive.script.ts` → `projects/ui/`.
- **Gate**: `bun test tests/e2e/cli-external-project.test.ts` y
  `tests/e2e/compiled-binary.test.ts`.

- Ojo: los `import()` del CLI deben seguir siendo literales estáticos o
  el binario compilado se queda sin esos módulos.
- **Acceptance**: el binario sigue funcionando sin bun ni node.

### S3 — `scripts/` por familias
- **Files**: `scripts/{gates,build,tools}/`.
- **Gate**: todos los `bun run <script>` del `package.json`.

- **Acceptance**: ningún script del `package.json` cambia de nombre;
  solo su ruta.

### S4 — `projects/plugin`
- **Files**: `plugins/postman-exporter/` → `projects/plugin/`.
- **Gate**: `bun test plugins/…/plugin-boot.spec.ts` y el `path` de
  `mcp-vertex.config.json`.

- **Acceptance**: el host MCP sigue arrancando el plugin.

### S5 — `tests/` como espejo
- **Files**: reorganizar `tests/` con la misma forma que `projects/`.
- **Gate**: `bun test`.

- **Acceptance**: 1030+ tests en verde, ningún fichero perdido.

## acceptance

- `bun run validate`, `bun run validate:package` y
  `bun run build:binary --all` en verde tras cada slice.
- `.github/agents.md` y `CONTRIBUTING.md` actualizados con la estructura
  nueva.
- Ningún cambio de comportamiento observable: mismos artefactos byte a
  byte para los 11 ejemplos.
