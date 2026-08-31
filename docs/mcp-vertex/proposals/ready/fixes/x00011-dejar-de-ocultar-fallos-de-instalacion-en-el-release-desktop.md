---
id: x00011
title: "Dejar de ocultar fallos de instalación en el release desktop"
kind: fix
status: ready
type: proposal
track: general
date: 2026-08-30
shipped-in: ["109bd1f", "7e95e27"]
---

# x00011 — Dejar de ocultar fallos de instalación en el release desktop

## Goal

TODO: describe the goal.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## Slices

- global_gate: none

### S1 — Instalación estricta
- **Status**: done
- **Files**: `.github/workflows/release-desktop.yml`
- **Gate**: none
- review-state: done
- review-implementer: orchestrator-cartago
- review-reviewer: proposal_guardian
- review-log: approved by proposal_guardian
### S2 — Build desktop verificable
- **Status**: pending
- **Files**: `packages/desktop`, `scripts`, `docs/DESKTOP-PUBLISH.md`
- **Gate**: none
- review-state: in_review
- review-implementer: orchestrator-cartago
## acceptance

- TODO: observable acceptance criteria.
