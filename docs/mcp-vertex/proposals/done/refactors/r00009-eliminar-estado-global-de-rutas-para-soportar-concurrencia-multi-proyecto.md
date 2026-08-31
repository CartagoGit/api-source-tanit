---
id: r00009
title: "Eliminar estado global de rutas para soportar concurrencia multi-proyecto"
kind: refactor
status: done
type: proposal
track: general
date: 2026-08-30
shipped-in: ["50f248c", "97b8625"]
last-transition-id: d53e004c-6e27-43f0-b272-10d1649fbaf2
last-correlation-id: d53e004c-6e27-43f0-b272-10d1649fbaf2
last-transition-from: ready
---

# r00009 — Eliminar estado global de rutas para soportar concurrencia multi-proyecto

## Goal

TODO: describe the goal.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## Slices

- global_gate: none

### S1 — Contexto explícito
- **Status**: done
- **Files**: `packages/core/discovery/paths.service.ts`, `packages/contracts/interfaces/core/project-context.interface.ts`
- **Gate**: none
- review-state: done
- review-implementer: orchestrator-cartago
- review-reviewer: proposal_guardian
- review-log: approved by proposal_guardian
### S2 — Concurrencia y callers
- **Status**: done
- **Files**: `packages/cli/commands/generate.script.ts`, `packages/cli/commands/watch.script.ts`
- **Gate**: none
- review-state: done
- review-implementer: orchestrator-cartago
- review-reviewer: proposal_guardian
- review-log: approved by proposal_guardian
## acceptance

- TODO: observable acceptance criteria.
