---
id: x00126
title: "Shell view entry transitions"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-21
last-transition-id: 3b678da8-ab29-4fcb-9436-4cd18a259d5f
last-correlation-id: 3b678da8-ab29-4fcb-9436-4cd18a259d5f
last-transition-from: in-progress
last-transition-at: 2026-11-21T04:59:28.700Z
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
- **Status**: review
- **Files**: `packages/app/src/app/shell/app-shell.component.html`, `docs/delendai/AGENT-BOOTSTRAP.md`
- **Gate**: type
- acceptance:
  - "Home, settings, and switch branch hosts use motion-fade on mount."
  - "Existing route logic, alerts, semantics, and reduced-motion behavior remain unchanged."
- review-state: in_review
- review-implementer: openai-gpt-5.6-luna
- shipped-in: `153084e16c91`

## acceptance

- Home, settings, and switch branch hosts use motion-fade on mount.
- Existing route logic, alerts, semantics, and reduced-motion behavior remain unchanged.
