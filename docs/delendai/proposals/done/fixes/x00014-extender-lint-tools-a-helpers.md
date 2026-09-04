---
id: x00014
title: "fix(plugin): extender lint:tools a src/lib/helpers/** (cierra el agujero process.cwd en el plugin)"
kind: fix
status: done
type: proposal
track: export-to-postman
date: 2026-09-03
---

# x00014 — fix(plugin): extender `lint:tools` a `src/lib/helpers/**`

## Hallazgo origen

`a00009` / **BUG-009** [MEDIO] + **LINT-001** [P1].

`lint-tool-no-process.script.ts` vigilaba sólo `src/lib/tools/`, pero `runner.helper.ts` leía estado de proceso sin gate.

## Diseño del fix

- Gate extendido a tools + helpers del plugin.
- `runner.helper.ts` refactorizado para consumir el snapshot inmutable del boot (`runner-snapshot.constant.ts`, excepción documentada en el propio gate) en vez de leer `process.*` en hot path.

## Definition of done

- [x] Gate extendido a `src/lib/{tools,helpers}/**`.
- [x] `runner.helper.ts` sin lecturas de proceso en hot path.
- [x] `bun run lint:tools` verde con la excepción documentada.
- [x] `bun run validate` verde.
- [x] Commit + push.

> **Cerrada 2026-09-03.** `lint:tools — 14 tools/helpers (1 excepción con
> motivo), sin infracciones`.
