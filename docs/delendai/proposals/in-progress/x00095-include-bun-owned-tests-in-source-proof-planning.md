---
id: x00095
title: "Include Bun-owned tests in source proof planning"
kind: fix
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 49d103ef-c857-4de5-8e97-58e520a05cd0
last-correlation-id: 49d103ef-c857-4de5-8e97-58e520a05cd0
last-transition-from: ready
last-transition-at: 2026-11-09T14:42:15.494Z
---

# x00095 — Include Bun-owned tests in source proof planning

## goal

Ensure changed transport and SQLite sources run their Bun-owned suites during source PR proof.

## why

Vitest intentionally excludes the Bun `tests/transport` and `tests/core/state/sqlite` suites. A scoped Vitest plan could therefore omit the test that reaches a changed transport or SQLite module, then fail coverage because Vitest never measured that file.

## non-goals

- Changing the changed-file coverage failure policy or reducing the full aggregate coverage gate.

## slices

- global_gate: none

### S1 — Route Bun-owned source changes through full proof
- **Status**: in-progress
- **Files**: `scripts/helpers/proof-plan.helper.ts`, `tests/scripts-gates/proof-plan.spec.ts`
- **Gate**: test

## acceptance

- A changed transport or SQLite source reached by a Bun spec selects the full proof plan, including aggregate coverage and both Bun suite commands.
- Missing or incomplete changed-file coverage remains a failure for affected Vitest-only runs.
