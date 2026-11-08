---
id: x00087
title: "Abrir colecciones sin bloquear el CLI ni lanzar aplicaciones reales desde las pruebas"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-08
last-transition-id: 4aeb4732-8487-426e-b1d7-0ce248b3679d
last-correlation-id: 4aeb4732-8487-426e-b1d7-0ce248b3679d
last-transition-from: ready
last-transition-at: 2026-11-08T13:26:44.697Z
---

# x00087 — Abrir colecciones sin bloquear el CLI ni lanzar aplicaciones reales desde las pruebas

## goal

La apertura solicita el launcher del sistema sin esperar la vida de la aplicación; generación abre el archivo realmente generado con contexto inyectado.

## why

La validación completa queda esperando a Chrome: open-postman usa spawnSync y las pruebas intentan forzar una variable de entorno que ya no se lee.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: e2e

### S1 — Apertura asíncrona y pruebas aisladas
- **Status**: pending
- **Files**: `packages/cli/commands/open-postman.script.ts`, `packages/cli/commands/generate.script.ts`, `packages/contracts/interfaces/cli/open-postman.interface.ts`, `tests/cli/open-postman-command.test.ts`, `tests/cli/writing-commands.test.ts`
- **Gate**: e2e
- acceptance:
  - "El CLI no espera a que se cierre la aplicación de destino."
  - "Fallos al iniciar el launcher prueban fallback sin matar aplicaciones del usuario."
  - "Las pruebas no lanzan navegador ni aplicaciones de escritorio reales."
  - "generate --open utiliza el archivo y el contexto generados, incluso con opciones inyectadas."

## acceptance

- El CLI no espera a que se cierre la aplicación de destino.
- Fallos al iniciar el launcher prueban fallback sin matar aplicaciones del usuario.
- Las pruebas no lanzan navegador ni aplicaciones de escritorio reales.
- generate --open utiliza el archivo y el contexto generados, incluso con opciones inyectadas.
