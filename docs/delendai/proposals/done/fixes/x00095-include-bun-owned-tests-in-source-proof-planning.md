---
id: x00095
title: "Include Bun-owned tests in source proof planning"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 6af91ad7-c38f-4a93-a40c-71147520728e
last-correlation-id: 6af91ad7-c38f-4a93-a40c-71147520728e
last-transition-from: review
last-transition-at: 2026-11-09T15:52:02.275Z
shipped-in:
  - "8d1a1cf7a3b963ecee9417b5d44554f7d811919f"
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
- review-log: approved by openai-gpt-6.1-sol — verified at 8d1a1cf7a3b9, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 2/2: (1) Reviewed reachability fallback;17 planner tests and fresh full validation passed, including15 SQLite and41 transport tests. (2) Coverage evaluator remains unchanged; full validation passed fail-closed missing-file and malformed-metric regressions. — Independent source review. Actual full validation journal .cache/delendai/results/logs/validate.jsonl at2026-11-09T15:40:25.691Z exit0:4917Vitest+15SQLite+41transport passed,2skipped. Verified landed8d1 source/tests/config byte-identical to tested review snapshot; only proposal metadata differs.

## acceptance

- A changed transport or SQLite source reached by a Bun spec selects the full proof plan, including aggregate coverage and both Bun suite commands.
- Missing or incomplete changed-file coverage remains a failure for affected Vitest-only runs.
