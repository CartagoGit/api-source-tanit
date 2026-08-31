---
id: x00010
title: "Evitar bloqueos y escrituras inseguras en desktop y init MCP"
kind: fix
status: done
type: proposal
track: general
date: 2026-08-30
shipped-in: ["47785ab", "09fd7a5"]
last-transition-id: 1e6a1a1d-297c-45bc-992f-b53ba4895d88
last-correlation-id: 1e6a1a1d-297c-45bc-992f-b53ba4895d88
last-transition-from: ready
---

# x00010 — Evitar bloqueos y escrituras inseguras en desktop y init MCP

## Goal

TODO: describe the goal.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## Slices

- global_gate: none

### S1 — Timeout del sidecar
- **Status**: done
- **Files**: `packages/desktop/src/main.rs`, `packages/desktop/tests`
- **Gate**: none
- review-state: done
- review-implementer: orchestrator-cartago
- review-reviewer: proposal_guardian
- review-log: approved by proposal_guardian
### S2 — Contención de init
- **Status**: done
- **Files**: `packages/plugins/mcp-vertex_expostman/src/lib/tools/init.tool.ts`, `packages/plugins/mcp-vertex_expostman/src/lib/helpers/runner.helper.ts`, `packages/cli/commands/init.script.ts`, `tests/cli/output-containment.spec.ts`
- **Gate**: none
- review-state: done
- review-implementer: orchestrator-cartago
- review-reviewer: proposal_guardian
- review-log: approved by proposal_guardian
## acceptance

- TODO: observable acceptance criteria.
