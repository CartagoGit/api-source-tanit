---
id: x00020
title: "fix(cli): generate --open invoca runOpenPostman directamente + test focalizado"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-09-03
---

# x00020 — fix(cli): `generate --open` invoca `runOpenPostman` directamente

## Hallazgo origen

`a00009` / **BUG-001** [FATAL].

`generate.script.ts` construía la ruta de `open-postman.script.ts` con `(import.meta as { dir?: string }).dir ?? process.cwd()` y `spawnSync`, produciendo `MODULE_NOT_FOUND` silencioso.

## Diseño del fix

- Import directo de `runOpenPostman` y llamada en proceso, sin `spawnSync`, sin `import.meta.dir`, sin `process.cwd()`.
- Test focalizado en `tests/cli/writing-commands.test.ts` (rama web con `POSTMAN_FORCE_OPEN=web`).

## Definition of done

- [x] `generate --open` ejecuta `runOpenPostman` en proceso.
- [x] Test focalizado verifica la invocación.
- [x] `bun run validate` verde.
- [x] Commit + push.

> **Cerrada 2026-09-03.** `generate.script.ts` importa `runOpenPostman` y lo
> llama en proceso (línea 419); el test `generate --open` existe en
> `writing-commands.test.ts`.
