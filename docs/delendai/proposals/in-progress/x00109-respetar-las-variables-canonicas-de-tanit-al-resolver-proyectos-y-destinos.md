---
id: x00109
title: "Respetar las variables canónicas de Tanit al resolver proyectos y destinos"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-19
last-transition-id: e1c55781-b7f5-4306-8036-e46eb8ec07e7
last-correlation-id: e1c55781-b7f5-4306-8036-e46eb8ec07e7
last-transition-from: ready
last-transition-at: 2026-11-19T07:19:35.598Z
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
- **Status**: pending
- **Files**: `packages/core/helpers/env-or-alias.helper.ts`, `packages/core/helpers/resolve-root.helper.ts`, `packages/core/discovery/project-context.service.ts`, `packages/cli/commands/watch.script.ts`, `packages/cli/cli.script.ts`, `tests/core/env-or-alias.helper.spec.ts`, `tests/core/resolve-root.helper.spec.ts`, `tests/core/project-context.spec.ts`, `tests/cli/cli-canonical-env.spec.ts`, `docs/API.md`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: e2e

## acceptance

- TODO: observable acceptance criteria.
