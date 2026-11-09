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
shipped-in:
  - "bebadb7005b46141961d4924c96e8a97268ad2d5"
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
- **Status**: done
- **Files**: `scripts/helpers/proof-plan.helper.ts`, `tests/scripts-gates/proof-plan.spec.ts`
- **Gate**: test
- shipped-in: `685723db4a80`
- review-state: done
- review-implementer: openai-gpt-6-luna
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at bebadb7005b4, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 2/2: (1) Reviewed Bun-spec reachability fallback;17 planner tests plus15 SQLite and41 transport tests passed in actual full validation. (2) Coverage evaluator is unchanged; its missing-file and malformed-metric fail-closed regressions passed. — Independent Sol source review. Reused actual full validation /tmp/tanit-parent-final-validation.log timestamp2026-11-09T15:40:25.691Z:4973/4975,2skipped. Source/tests/config verified byte-identical to tested2d3 snapshot; no full rerun claimed in this fresh unit.

## acceptance

- A changed transport or SQLite source reached by a Bun spec selects the full proof plan, including aggregate coverage and both Bun suite commands.
- Missing or incomplete changed-file coverage remains a failure for affected Vitest-only runs.
