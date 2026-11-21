---
id: x00124
title: "Mobile navigation and command palette motion"
kind: fix
status: review
type: proposal
track: beta
date: 2026-11-21
last-transition-id: 6d3003d7-6359-4dae-aca8-05ee9641b8df
last-correlation-id: 6d3003d7-6359-4dae-aca8-05ee9641b8df
last-transition-from: in-progress
last-transition-at: 2026-11-21T04:46:40.156Z
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
- **Status**: review
- **Files**: `packages/app/src/app/shell/sidebar.component.scss`, `packages/app/src/app/shell/command-palette.component.scss`, `packages/app/src/styles/motion.scss`, `tests/app/reachable.spec.ts`
- **Gate**: type
- acceptance:
  - "Sidebar and command palette use existing motion timing tokens for entry only."
  - "prefers-reduced-motion renders immediately without animation."
  - "Existing keyboard navigation and semantics remain unchanged."
- review-state: in_review
- review-implementer: openai-gpt-5.6-luna
- shipped-in: `a496d89081cf`

## acceptance

- Sidebar and command palette use existing motion timing tokens for entry only.
- prefers-reduced-motion renders immediately without animation.
- Existing keyboard navigation and semantics remain unchanged.
