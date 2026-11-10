---
id: x00021
title: "fix(gates): test-all.script.ts guard de import.meta.main + extender lint:command-coverage a scripts/"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-09-03
shippedIn:
  - fb8cfe5  # cierre administrativo (x00032 S1 regla 2): SHA de creación del registro
---

# x00021 — fix(gates): guard `import.meta.main` en `test-all.script.ts` + coverage de scripts

## Hallazgo origen

`a00009` / **BUG-002** [FATAL] + **BUG-010** [MEDIO].

`test-all.script.ts` ejecutaba `process.exit(await main())` sin guard `import.meta.main`; importarlo mataba el proceso. `lint:command-coverage` no cubría `scripts/`.

## Diseño del fix

- Guard `if (import.meta.main)` antes del `process.exit`.
- `lint:command-coverage` extendido a los scripts del repo (35 scripts importables verificados en cada validate).

## Definition of done

- [x] `test-all.script.ts` con guard (línea 173).
- [x] `lint:command-coverage` cubre `scripts/**` (35 scripts importables).
- [x] `bun run validate` verde.
- [x] Commit + push.

> **Cerrada 2026-09-03.** Guard presente en `scripts/gates/test-all.script.ts:173`
> y `lint:command-coverage — 12 comandos (todos ejercitados) + 35 scripts,
> todos importables`.
