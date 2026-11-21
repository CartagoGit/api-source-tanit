---
id: x00126
title: "Shell view entry transitions"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-21
---

# x00126 — Shell view entry transitions

## goal

Add gentle reduced-motion-safe entry transitions to the shell view hosts as they mount.

## why

Main shell view changes currently swap abruptly despite the existing opacity-only motion utility.

## non-goals

- No route logic changes
- No exit animations
- No wrappers or dependencies

## slices

- global_gate: lint

### S1 — Animate mounted shell view hosts
- **Status**: pending
- **Files**: `packages/app/src/app/shell/app-shell.component.html`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: type
- acceptance:
  - "Home, settings, and switch branch hosts use motion-fade on mount."
  - "Existing route logic, alerts, semantics, and reduced-motion behavior remain unchanged."

## acceptance

- Home, settings, and switch branch hosts use motion-fade on mount.
- Existing route logic, alerts, semantics, and reduced-motion behavior remain unchanged.
