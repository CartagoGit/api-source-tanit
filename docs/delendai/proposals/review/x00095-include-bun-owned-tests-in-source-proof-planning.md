---
id: x00095
title: "Include Bun-owned tests in source proof planning"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: ad392f51-98f5-452c-a447-d9d7bc777862
last-correlation-id: ad392f51-98f5-452c-a447-d9d7bc777862
last-transition-from: in-progress
last-transition-at: 2026-11-09T14:57:41.309Z
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
- **Status**: review
- **Files**: `scripts/helpers/proof-plan.helper.ts`, `tests/scripts-gates/proof-plan.spec.ts`
- **Gate**: test
- shipped-in: `685723db4a80`
- review-state: in_review
- review-implementer: openai-gpt-6-luna

## acceptance

- A changed transport or SQLite source reached by a Bun spec selects the full proof plan, including aggregate coverage and both Bun suite commands.
- Missing or incomplete changed-file coverage remains a failure for affected Vitest-only runs.
