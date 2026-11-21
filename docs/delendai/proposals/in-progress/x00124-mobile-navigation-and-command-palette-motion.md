---
id: x00124
title: "Mobile navigation and command palette motion"
kind: fix
status: in-progress
type: proposal
track: beta
date: 2026-11-21
---

# x00124 — Mobile navigation and command palette motion

## goal

Add restrained entry motion to mobile navigation and command palette while preserving keyboard semantics and reduced-motion behavior.

## why

The shell has a motion token and reveal utility but sidebar and palette appear abruptly, reducing continuity during navigation.

## non-goals

- No navigation model changes
- No new dependencies

## slices

- global_gate: lint

### S1 — Mobile sidebar and command palette entry motion
- **Status**: pending
- **Files**: `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/shell/command-palette.component.scss`, `packages/app/src/styles/motion.scss`, `tests/app/reachable.spec.ts`
- **Gate**: type
- acceptance:
  - "Sidebar and command palette use existing motion timing tokens for entry only."
  - "prefers-reduced-motion renders immediately without animation."
  - "Existing keyboard navigation and semantics remain unchanged."

## acceptance

- Sidebar and command palette use existing motion timing tokens for entry only.
- prefers-reduced-motion renders immediately without animation.
- Existing keyboard navigation and semantics remain unchanged.
