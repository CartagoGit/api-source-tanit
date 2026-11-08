---
id: x00084
title: "Configuración de sesión efectiva, parcial y atómica"
kind: fix
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-08
---

# x00084 — Configuración de sesión efectiva, parcial y atómica

## goal

CLI y app consultan y modifican una única configuración efectiva de sesión sin perder opciones ni la sesión válida ante fallos.

## why

settings.handlers.ts cierra la sesión antes del reemplazo, reconstruye sólo el parche y no devuelve la nueva identidad. El GET no expone opciones efectivas.

## non-goals

- No añadir preferencias de presentación al núcleo.

## slices

- global_gate: e2e

### S1 — Preservar configuración y sesión al aplicar parches
- **Status**: pending
- **Files**: `packages/core/application-api/settings.handlers.ts`, `packages/core/session/project-session.service.ts`, `packages/contracts/interfaces/core/session.interface.ts`, `tests/application-api/settings.handlers.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Cambiar una opción conserva todas las demás."
  - "GET devuelve configuración efectiva compartida."
  - "Un reemplazo fallido conserva la sesión anterior utilizable."
  - "La respuesta permite al cliente seguir usando la sesión vigente."

## acceptance

- Cambiar una opción conserva todas las demás.
- GET devuelve configuración efectiva compartida.
- Un reemplazo fallido conserva la sesión anterior utilizable.
- La respuesta permite al cliente seguir usando la sesión vigente.
