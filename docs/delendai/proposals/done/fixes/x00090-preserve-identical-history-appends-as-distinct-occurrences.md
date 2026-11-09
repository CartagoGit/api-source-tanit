---
id: x00090
title: "Preserve identical history appends as distinct occurrences"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 7a9a640e-7726-4fcb-b605-898b4885bf07
last-correlation-id: 7a9a640e-7726-4fcb-b605-898b4885bf07
last-transition-from: review
last-transition-at: 2026-11-09T15:11:08.237Z
shipped-in:
  - "b8c3410b2ba0c91460537d8538c9b947f7f3bec6"
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
- **Status**: done
- **Files**: `packages/core/session/history-run.repository.ts`, `tests/e2e/history-authority.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Concurrent identical appends with the same timestamp produce distinct stored runs"
  - "Legacy duplicate migration remains stable across repeated reads"
  - "Run metadata remains marked as having no source snapshot"
- shipped-in: `5dd434bb2f74`
- review-state: done
- review-implementer: openai-gpt-6-luna
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at b8c3410b2ba0, validate exit 0 and tests 4970/4972 claimed, no recorded run cited; acceptance 3/3: (1) Full validation passed tests/e2e/history-authority.spec.ts: concurrent identical appends in the same millisecond remain separate occurrences; source uses UUID … (2) Full validation passed history-authority legacy migration test; migration identity stays deterministic and duplicates remain separate. (3) Full validation passed metadata snapshotAvailable=false assertions and HISTORY_SNAPSHOT_UNAVAILABLE re-export rejection. — Independent source review plus fresh full validation in this review unit: 4914 Vitest,15 SQLite,41 transport passed;2 skipped.

## acceptance

- Every append gets a unique run identity; migration continues to pass its stable identity explicitly.
- A concurrent same-millisecond duplicate pair is visible as two metadata entries with unavailable snapshots.
