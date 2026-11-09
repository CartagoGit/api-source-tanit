---
id: x00090
title: "Preserve identical history appends as distinct occurrences"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: cb7b4266-54a9-4575-9b20-e25b6cdd96fc
last-correlation-id: cb7b4266-54a9-4575-9b20-e25b6cdd96fc
last-transition-from: ready
last-transition-at: 2026-11-09T08:57:21.147Z
---

# x00090 — Preserve identical history appends as distinct occurrences

## goal

Prevent exact same-millisecond run appends from overwriting one another while keeping legacy migration stable.

## why

Run metadata uses a deterministic digest of its entry as the filename. Two
identical runs recorded within one millisecond therefore target one file, and
the later atomic write replaces the earlier occurrence. Run history must
preserve both events while legacy import remains deterministic and idempotent.

## non-goals

- Changing revision record identifiers or snapshot history semantics.

## slices

- global_gate: none

### S1 — Preserve every run append
- **Status**: in-progress
- **Files**: `packages/core/session/history-run.repository.ts`, `tests/e2e/history-authority.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Concurrent identical appends with the same timestamp produce distinct stored runs"
  - "Legacy duplicate migration remains stable across repeated reads"
  - "Run metadata remains marked as having no source snapshot"

## acceptance

- Every append gets a unique run identity; migration continues to pass its stable identity explicitly.
- A concurrent same-millisecond duplicate pair is visible as two metadata entries with unavailable snapshots.
