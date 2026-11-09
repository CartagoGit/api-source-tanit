---
id: x00090
title: "Preserve identical history appends as distinct occurrences"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: a00d3eaf-2c7c-415c-b5b2-ae24bf3f5091
last-correlation-id: a00d3eaf-2c7c-415c-b5b2-ae24bf3f5091
last-transition-from: review
last-transition-at: 2026-11-09T21:17:51.982Z
shipped-in:
  - "bebadb7005b46141961d4924c96e8a97268ad2d5"
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
- review-log: approved by openai-gpt-6.1-sol — verified at bebadb7005b4, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 3/3: (1) Actual full validation passed concurrent identical same-millisecond append regression; ordinary identities use UUIDs. (2) Actual full validation passed deterministic duplicate migration and unchanged legacy input checks. (3) Actual full validation passed metadata snapshotAvailable=false and HISTORY_SNAPSHOT_UNAVAILABLE re-export checks. — Independent Sol source review. Reused actual full validation /tmp/tanit-parent-final-validation.log timestamp2026-11-09T15:40:25.691Z:4973/4975,2skipped. Source/tests/config verified byte-identical to tested2d3 snapshot; no full rerun claimed in this fresh unit.

## acceptance

- Every append gets a unique run identity; migration continues to pass its stable identity explicitly.
- A concurrent same-millisecond duplicate pair is visible as two metadata entries with unavailable snapshots.
