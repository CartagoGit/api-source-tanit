---
id: x00096
title: "Lint canonical shipped-in proposal metadata"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 7a53c4b7-5d39-42f5-a9bb-97bc2d6918d4
last-correlation-id: 7a53c4b7-5d39-42f5-a9bb-97bc2d6918d4
last-transition-from: ready
last-transition-at: 2026-11-09T15:20:54.638Z
---

# x00096 — Lint canonical shipped-in proposal metadata

## goal

Keep archived proposal validation compatible with DelendAI 0.3 canonical shipped-in frontmatter while preserving SHA reachability checks.

## why

DelendAI 0.3 writes the canonical `shipped-in` field when it archives a proposal. The repository lint only read the legacy `shippedIn` spelling, so a valid archive was rejected before closure could be certified.

## non-goals

- Rewriting or moving archived proposal documents.

## slices

- global_gate: none

### S1 — TODO
- **Status**: pending
- **Files**: `TODO`
- **Gate**: none

## acceptance

- The linter accepts canonical `shipped-in` block and inline lists as well as legacy `shippedIn` lists.
- Missing, malformed, or unreachable SHA values still fail proposal closure validation.
