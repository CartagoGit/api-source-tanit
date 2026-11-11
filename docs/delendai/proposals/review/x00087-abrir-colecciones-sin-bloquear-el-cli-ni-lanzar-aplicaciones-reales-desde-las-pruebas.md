---
id: x00087
title: "Abrir colecciones sin bloquear el CLI ni lanzar aplicaciones reales desde las pruebas"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: ccaba61e-186f-437a-8b77-61c86743c0d3
last-correlation-id: ccaba61e-186f-437a-8b77-61c86743c0d3
last-transition-from: in-progress
last-transition-at: 2026-11-11T00:28:51.117Z
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
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol
- shipped-in: `b43938a8f163`

## acceptance

- El CLI no espera a que se cierre la aplicación de destino.
- Fallos al iniciar el launcher prueban fallback sin matar aplicaciones del usuario.
- Las pruebas no lanzan navegador ni aplicaciones de escritorio reales.
- generate --open utiliza el archivo y el contexto generados, incluso con opciones inyectadas.

## Validation evidence

- 23 focused CLI tests pass, including detached launcher lifetime, immediate exit failure fallback, custom generated output and atomic init.
- CLI typecheck passes; no real browser/application is launched by these tests.
- Full project certification runs with the canonical identity delivery.
