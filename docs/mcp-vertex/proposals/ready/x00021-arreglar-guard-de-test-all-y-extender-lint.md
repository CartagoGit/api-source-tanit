---
id: x00021
title: "fix(gates): test-all.script.ts guard de import.meta.main + extender lint:command-coverage a scripts/"
kind: fix
date: 2026-09-03
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00009
---

# x00011 — fix(gates): `test-all.script.ts` guard de `import.meta.main` + extender `lint:command-coverage` a `scripts/`

## Hallazgo origen

`a00009` / **BUG-002** [FATAL] + **BUG-010** [MEDIO].

`scripts/gates/test-all.script.ts:176` ejecuta
`process.exit(await main())` en el cuerpo del módulo, sin
envolver con `if (import.meta.main)`. El resto de gates del
proyecto sí lo usan (verificado: 20/20 gates hermanos). Esto
rompe la regla "una gate se puede importar sin matar el proceso"
y hace que `lint:command-coverage` (que sólo escanea
`packages/cli/commands/`) no pueda cubrir este fichero.

## Diseño del fix

- Añadir `if (import.meta.main) {` antes de `process.exit(...)`
  y cerrar la llave, en `scripts/gates/test-all.script.ts`.
- Extender `lint:command-coverage` para que escanee también
  `scripts/**/*.script.ts` y `scripts/gates/**/*.script.ts`.
- Verificar que el gate detecta el problema antes del fix
  (`bun run lint:command-coverage` debe fallar en una copia
  controlada, y volver a verde tras el fix).

## Slices

- **S1**: añadir el guard `if (import.meta.main)` en
  `test-all.script.ts`; verificar typecheck + lint.
- **S2**: extender `lint:command-coverage` al patrón `scripts/`
  y al patrón `packages/`. Verificar que detecta el problema
  reintroduciendo el bug temporalmente y que vuelve a verde tras
  el fix.
- **S3**: añadir un test que ejecute
  `bun -e "import('./scripts/gates/test-all.script.ts')"` y
  verifique que NO mata el proceso (sale 0 y el módulo queda
  disponible).

## Definition of done

- [ ] `test-all.script.ts` envuelve `process.exit` con
      `if (import.meta.main)`.
- [ ] `lint:command-coverage` cubre `scripts/**` y `packages/`.
- [ ] Nuevo test pasa.
- [ ] `bun run validate` verde.
- [ ] Commit + push.
