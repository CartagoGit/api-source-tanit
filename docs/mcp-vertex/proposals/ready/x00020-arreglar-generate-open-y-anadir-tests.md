---
id: x00020
title: "fix(cli): generate --open invoca runOpenPostman directamente + test focalizado"
kind: fix
date: 2026-09-03
status: ready
type: proposal
track: export-to-postman
dependsOn:
  - a00009
---

# x00010 — fix(cli): `generate --open` invoca `runOpenPostman` directamente + test focalizado

## Hallazgo origen

`a00009` / **BUG-001** [FATAL] — `packages/cli/commands/generate.script.ts:407-417`
construye la ruta del script `open-postman` con
`(import.meta as { dir?: string }).dir ?? process.cwd()` y concatena
`/open-postman.script.ts`. Tres defectos a la vez:

1. `import.meta.dir` no existe como tipo estándar de TS — el cast
   silencia el error.
2. El fallback es `process.cwd()` — vetado por el gate
   `lint:tools` (universal §6).
3. La ruta esperada
   `<projectRoot>/packages/cli/commands/open-postman.script.ts` no
   existe relativa al `cwd` del proceso; el fichero vive en
   `packages/cli/commands/open-postman.script.ts` desde la reorg
   de `packages/`. Resultado: `MODULE_NOT_FOUND` silencioso.

No hay tests que cubran `--open` (`grep --open tests/cli/*.ts`
devuelve cero).

## Diseño del fix

- `generate.script.ts` ya importa `runOpenPostman` desde
  `open-postman.script.ts` en otros puntos — confirmar y, si no,
  añadir el import.
- Sustituir el bloque `await import("node:child_process")` +
  `spawnSync(...)` por una llamada directa a
  `runOpenPostman(["--file", OUTPUT_PATH])` y propagar su
  `IExitCode`.
- Eliminar el cast `(import.meta as { dir?: string }).dir` y el
  fallback a `process.cwd()`.
- Eliminar el `spawnSync` de `node:child_process` (ya no se
  necesita).

## Slices

- **S1**: aplicar el fix en `generate.script.ts`; verificar que
  `bun run typecheck:cli` y `bun run lint` siguen verdes.
- **S2**: añadir un caso en `tests/cli/writing-commands.test.ts`
  que ejecute `generate --open` con `runOpenPostman` mockeado y
  verifique (a) que se llama una vez, (b) con `--file` igual al
  `OUTPUT_PATH` del comando.

## Definition of done

- [ ] `generate --open` ejecuta `runOpenPostman` directamente
      (sin spawn, sin `cwd`, sin `import.meta.dir`).
- [ ] `tests/cli/writing-commands.test.ts` añade un test que
      verifica la invocación correcta.
- [ ] `bun run validate` verde.
- [ ] Commit Conventional Commits con `fix(cli):` y push a
      `develop`.
