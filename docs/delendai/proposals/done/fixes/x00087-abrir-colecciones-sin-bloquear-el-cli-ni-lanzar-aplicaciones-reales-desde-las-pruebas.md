---
id: x00087
title: "Abrir colecciones sin bloquear el CLI ni lanzar aplicaciones reales desde las pruebas"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 0d4512f5-c09b-45f6-ad34-6c11615651ea
last-correlation-id: 0d4512f5-c09b-45f6-ad34-6c11615651ea
last-transition-from: review
last-transition-at: 2026-11-11T00:43:45.602Z
shipped-in:
  - "bcf04e22c26af4f82af4a6191d59f29243a9a98e"
---

# x00087 — Abrir colecciones sin bloquear el CLI ni lanzar aplicaciones reales desde las pruebas

## goal

La apertura solicita el launcher del sistema sin esperar la vida de la aplicación; generación abre el archivo realmente generado con contexto inyectado.

## why

La validación completa queda esperando a Chrome: open-postman usa spawnSync y las pruebas intentan forzar una variable de entorno que ya no se lee.

## non-goals

- No cambiar aplicaciones predeterminadas ni gestionar keyrings del usuario.
- No abrir navegadores o aplicaciones reales desde las pruebas.

## slices

- global_gate: e2e

### S1 — Apertura asíncrona y pruebas aisladas
- **Status**: done
- **Files**: `packages/cli/commands/open-postman.script.ts`, `packages/cli/commands/generate.script.ts`, `packages/contracts/interfaces/cli/open-postman.interface.ts`, `tests/cli/open-postman-command.test.ts`, `tests/cli/writing-commands.test.ts`
- **Gate**: e2e
- acceptance:
  - "El CLI no espera a que se cierre la aplicación de destino."
  - "Fallos al iniciar el launcher prueban fallback sin matar aplicaciones del usuario."
  - "Las pruebas no lanzan navegador ni aplicaciones de escritorio reales."
  - "generate --open utiliza el archivo y el contexto generados, incluso con opciones inyectadas."
- shipped-in: `b43938a8f163`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at bcf04e22c26a, validate exit 0 and tests 20/20 claimed, no recorded run cited; acceptance 4/4: (1) Reviewed current launchDetached: it spawns detached with ignored stdio, resolves on launch grace, unrefs child, and handles immediate error/exit. Focused opene… (2) open-postman-command.test.ts covers immediate nonzero exit, asynchronous spawn error, launcher fallback and final failure; it stubs child processes and asserts… (3) The opener tests mock node:child_process.spawn; writing-commands.test.ts mocks the opener module. Focused command bunx vitest run tests/cli/open-postman-comman… (4) Reviewed generate.script.ts: it calls the imported opener with --file OUTPUT_PATH and the resolved injected context. Regression verifies custom generated outpu… — Independent review of landed source at bcf04e22; both requested isolated CLI specs passed 20/20. No browser or desktop launcher was run.

## acceptance

- El CLI no espera a que se cierre la aplicación de destino.
- Fallos al iniciar el launcher prueban fallback sin matar aplicaciones del usuario.
- Las pruebas no lanzan navegador ni aplicaciones de escritorio reales.
- generate --open utiliza el archivo y el contexto generados, incluso con opciones inyectadas.

## Validation evidence

- 23 focused CLI tests pass, including detached launcher lifetime, immediate exit failure fallback, custom generated output and atomic init.
- CLI typecheck passes; no real browser/application is launched by these tests.
- Full project certification runs with the canonical identity delivery.
