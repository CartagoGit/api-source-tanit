---
id: p00020
title: "p00020 — reorganizar la arquitectura de carpetas por responsabilidad"
kind: refactor
status: ready
type: proposal
track: postman-exporter
date: 2026-08-06
related:
    - p00021 # runtime/ se retira como parte de esta reorganización
    - p00022 # el bin multi-lenguaje depende de esta estructura
---

# p00020 — reorganizar la arquitectura de carpetas por responsabilidad

## Goal

Que la estructura de carpetas diga qué hace cada cosa. Hoy hay que abrir
los ficheros para saberlo.

## why

El repositorio creció desde "generador para Laravel" hasta "generador
agnóstico con CLI, binario, plugin MCP y 12 scanners", y la estructura se
quedó en la de la primera versión. Los síntomas concretos:

- **No hay un centro.** Lo que el proyecto *hace* está repartido entre
  `service/`, `helper/` y `contract/` en la raíz, al mismo nivel que
  `scripts/`, `examples/` y `docs/`. Nada dice cuál es el núcleo.
- **`service/` mezcla tres cosas distintas**: servicios de dominio
  (`collection-builder`, `auth-flow`), adaptadores (`adapters/`) y el
  registro de scanners (`scanner-registry.ts`), todos al mismo nivel.
- **`scripts/` tiene 13 ficheros planos** que son tres familias
  distintas: comandos del CLI (`generate`, `push`, `list`…), gates de
  calidad (`validate`, `validate-package`, `lint-tool-no-process`) y
  utilidades de build (`build-binary`).
- **Lo específico por lenguaje no está separado de lo común.** Los 12
  scanners viven juntos en `service/scanners/`, pero comparten helpers
  que están en `helper/`. No se ve qué es agnóstico y qué no.
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

```
projects/
  core/                    Lo que el proyecto HACE. Agnóstico de entrada/salida.
    contract/              Interfaces y tipos
    domain/                collection-builder, auth-flow, param-inferrer…
    discovery/             orchestrator, registry, adapters
    scanners/              uno por framework
    parsers/               zod, joi, pydantic, marshmallow (compartidos)
    helper/                utilidades puras (uri, fs-walk, source-scan)
  cli/                     Comandos, parseo de flags, salida por consola
  ui/                      Asistente interactivo (y lo que venga después)
  plugin/                  Plugin MCP (hoy plugins/postman-exporter)

apps/                      Ejecutables por lenguaje (ver p00022)
bin/                       Puntos de entrada por runtime (ver p00022)

scripts/                   Utilidades del repo, invocables desde package.json
  gates/                   validate, validate-package, lint-tool-no-process
  build/                   build-binary
  tools/                   summary, scan, diff, init, stats…

examples/                  Un proyecto por framework + README que los explica
tests/                     Espejo de projects/
docs/                      Documentación de usuario y de agentes
```

Lo que gana: `projects/core` se puede leer sin saber que existe un CLI, y
un scanner nuevo tiene un sitio evidente.

## slices

### S1 — `projects/core`
- **Files**: mover `contract/`, `service/`, `helper/` bajo
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
