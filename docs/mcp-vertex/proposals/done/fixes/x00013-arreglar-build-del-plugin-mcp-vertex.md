---
id: x00013
title: "fix(plugin): arreglar build del plugin mcp-vertex (rootDir + validate:package cubre el plugin)"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-09-03
---

# x00013 — fix(plugin): arreglar build del plugin mcp-vertex

## Hallazgo origen

`a00009` / **BUG-004** [ALTO].

El plugin declaraba `"main": "./dist/index.js"` pero su build fallaba y `dist/` podía quedar vacío; un consumidor del tarball recibiría un plugin inútil. Además `validate:package` sólo probaba el paquete raíz.

## Diseño del fix

- Build del plugin vía `bun build` (el `tsc` del paquete queda en modo typecheck puro con `noEmit`, porque importa fuentes fuera de `src/`).
- `validate-package.script.ts` ahora compila el plugin y verifica `dist/index.js` antes de empaquetar.

## Definition of done

- [x] `bun run --cwd packages/plugins/mcp-vertex_expostman build` produce `dist/index.js`.
- [x] `validate:package` cubre el plugin.
- [x] `bun run validate` verde.
- [x] Commit + push.

> **Cerrada 2026-09-03.** El build del plugin produce `dist/index.js` (1.91 MB
> verificado en esta sesión) y `validate-package.script.ts` lo compila y
> comprueba antes de empaquetar.
