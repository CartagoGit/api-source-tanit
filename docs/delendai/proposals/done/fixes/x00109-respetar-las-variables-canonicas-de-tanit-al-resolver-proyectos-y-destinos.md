---
id: x00109
title: "Respetar las variables canónicas de Tanit al resolver proyectos y destinos"
kind: fix
status: done
type: proposal
track: beta
date: 2026-11-19
last-transition-id: dcf26324-2847-448f-add5-dae4c0d5fa44
last-correlation-id: dcf26324-2847-448f-add5-dae4c0d5fa44
last-transition-from: review
last-transition-at: 2026-11-19T15:10:01.707Z
shipped-in:
  - "17490bc78e6ef2d94f04d6a0cd8a50fcb967b1e9"
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
- **Status**: done
- **Files**: `packages/core/helpers/env-or-alias.helper.ts`, `packages/core/helpers/resolve-root.helper.ts`, `packages/core/discovery/project-context.service.ts`, `packages/cli/commands/watch.script.ts`, `packages/cli/cli.script.ts`, `tests/core/env-or-alias.helper.spec.ts`, `tests/core/resolve-root.helper.spec.ts`, `tests/core/project-context.spec.ts`, `tests/cli/cli-canonical-env.spec.ts`, `docs/API.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e
- acceptance:
  - "Las opciones explícitas prevalecen sobre las variables TANIT, que prevalecen sobre sus alias POSTMAN para raíz y destino."
  - "generate y watch resuelven la raíz y el destino con variables TANIT y conservan compatibilidad con los alias."
  - "La ayuda CLI documenta las variables canónicas y sus alias obsoletos."
- shipped-in: `3ffb695dcdca`
- review-state: done
- review-implementer: openai-gpt-6.2-sol
- review-reviewer: openai-gpt-6.1-terra
- review-log: approved by openai-gpt-6.1-terra — verified at 17490bc78e6e, validate exit 0 and tests 8/8 claimed, no recorded run cited; acceptance 3/3: (1) tests/core/project-context.spec.ts, resolve-root.helper.spec.ts y cli-canonical-env.spec.ts; CI PR 179 verde (2) tests/cli/cli-canonical-env.spec.ts y tests/core/env-or-alias.helper.spec.ts; CI PR 179 verde (3) packages/cli/cli.script.ts y docs/API.md revisados — CI PR 179 y Vitest focal verdes.

## acceptance

- Las opciones explícitas prevalecen sobre las variables TANIT, que prevalecen sobre sus alias POSTMAN para raíz y destino.
- generate y watch resuelven la raíz y el destino con variables TANIT y conservan compatibilidad con los alias.
- La ayuda CLI documenta las variables canónicas y sus alias obsoletos.
