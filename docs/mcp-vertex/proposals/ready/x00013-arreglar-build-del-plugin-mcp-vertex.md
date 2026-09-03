---
id: x00013
title: "fix(plugin): arreglar build del plugin mcp-vertex (rootDir + validate:package cubre el plugin)"
kind: fix
date: 2026-09-03
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00009
---

# x00013 — fix(plugin): arreglar build del plugin mcp-vertex (`rootDir` + `validate:package` cubre el plugin)

## Hallazgo origen

`a00009` / **BUG-004** [ALTO].

`packages/plugins/mcp-vertex_expostman/package.json:22` declara
`"main": "./dist/index.js"` y `files: ["dist", "README.md",
"LICENSE"]`. Pero `bun run build` (definido en `scripts.build`
del plugin) falla con
`TS5011: The common source directory of 'tsconfig.json' is '../..'.
The 'rootDir' setting must be explicitly set`.

El paquete raíz publica vía `files: ["packages/"]` y arrastra
los fuentes del plugin; `npm pack` lo confirma. Pero el plugin
NO se publica por sí solo en condiciones — su `dist/` está
vacío, así que un consumidor que instale `@expostman/mcp-vertex-plugin`
recibirá un tarball inútil.

`validate:package` (en el raíz) sólo prueba el paquete raíz, no
el plugin.

## Diseño del fix

- Añadir `"rootDir": "src"` (o equivalente) en
  `packages/plugins/mcp-vertex_expostman/tsconfig.json` para
  que `tsc` no tenga que adivinar.
- Extender `scripts/gates/validate-package.script.ts` para que
  también haga `npm pack` + `tar tzf` sobre el plugin y
  verifique que `dist/index.js` existe.
- Opcionalmente: mover el `main` a `./src/index.ts` (como el
  paquete raíz hace con `cli.script.ts`) y eliminar la
  dependencia de un build previo. Decidir por simplicidad
  operativa: Bun resuelve `.ts` directamente; el `dist/` se
  mantiene opcional y se documenta.

## Slices

- **S1**: fijar `rootDir` en `tsconfig.json` del plugin;
  verificar que `bun run build` produce `dist/index.js` +
  `dist/index.d.ts`.
- **S2**: extender `validate:package` para que pruebe el plugin
  (al menos `npm pack --dry-run` + verificación de
  `dist/index.js`).
- **S3**: smoke-runner del plugin (`bun --cwd
  packages/plugins/mcp-vertex_expostman run build && bun run
  validate:package`) verde.

## Definition of done

- [ ] `bun --cwd packages/plugins/mcp-vertex_expostman build`
      produce `dist/index.js`.
- [ ] `validate:package` cubre el plugin.
- [ ] `bun run validate` verde.
- [ ] Commit + push.
