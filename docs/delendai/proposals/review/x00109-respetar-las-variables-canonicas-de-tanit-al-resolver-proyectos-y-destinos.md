---
id: x00109
title: "Respetar las variables canónicas de Tanit al resolver proyectos y destinos"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-19
last-transition-id: 39744b02-2312-452b-b0d2-cf29a1e3c4a7
last-correlation-id: 39744b02-2312-452b-b0d2-cf29a1e3c4a7
last-transition-from: in-progress
last-transition-at: 2026-11-19T07:24:07.845Z
---

# x00109 — Respetar las variables canónicas de Tanit al resolver proyectos y destinos

## goal

Los comandos de la CLI resuelven la raíz y el destino con las variables TANIT documentadas.

## why

Una ejecución real de generate --inspect falló usando solo TANIT_PROJECT_ROOT y detectó el mismo fixture al usar POSTMAN_PROJECT_ROOT. El contexto estricto y watch leían directamente el alias, a diferencia de otros consumidores del resolver común.

## non-goals

- Cambiar el contrato de POSTMAN_API_KEY o eliminar compatibilidad con los alias.

## slices

- global_gate: none

### S1 — Resolver raíz y salida con el helper común y probar la CLI
- **Status**: review
- **Files**: `packages/core/helpers/env-or-alias.helper.ts`, `packages/core/helpers/resolve-root.helper.ts`, `packages/core/discovery/project-context.service.ts`, `packages/cli/commands/watch.script.ts`, `packages/cli/cli.script.ts`, `tests/core/env-or-alias.helper.spec.ts`, `tests/core/resolve-root.helper.spec.ts`, `tests/core/project-context.spec.ts`, `tests/cli/cli-canonical-env.spec.ts`, `docs/API.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Las opciones explícitas prevalecen sobre las variables TANIT, que prevalecen sobre sus alias POSTMAN para raíz y destino."
  - "generate y watch resuelven la raíz y el destino con variables TANIT y conservan compatibilidad con los alias."
  - "La ayuda CLI documenta las variables canónicas y sus alias obsoletos."
- shipped-in: `3ffb695dcdca`
- review-state: in_review
- review-implementer: openai-gpt-6.2-sol

## acceptance

- Las opciones explícitas prevalecen sobre las variables TANIT, que prevalecen sobre sus alias POSTMAN para raíz y destino.
- generate y watch resuelven la raíz y el destino con variables TANIT y conservan compatibilidad con los alias.
- La ayuda CLI documenta las variables canónicas y sus alias obsoletos.
