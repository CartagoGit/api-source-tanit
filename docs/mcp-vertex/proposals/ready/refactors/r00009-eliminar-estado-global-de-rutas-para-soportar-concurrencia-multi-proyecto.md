---
id: r00009
title: "Eliminar estado global de rutas para soportar concurrencia multi-proyecto"
kind: refactor
status: ready
type: proposal
track: general
date: 2026-08-30
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
- **Status**: pending
- **Files**: `packages/core/**/*.ts`, `packages/cli/**/*.ts`, `packages/plugins/mcp-vertex_expostman/**/*.ts`
- **Gate**: none

## acceptance

- TODO: observable acceptance criteria.
