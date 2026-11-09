---
id: v00002
title: "Scope-aware proof uses one conservative plan in local work and CI"
kind: perf
status: in-progress
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 8614e446-5c3a-4da7-8ec0-d691499b5bde
last-correlation-id: 8614e446-5c3a-4da7-8ec0-d691499b5bde
last-transition-from: review
last-transition-at: 2026-11-09T07:58:50.281Z
---

# v00002 — Scope-aware proof uses one conservative plan in local work and CI

## goal

Validate changed source and its consumers with one auditable plan while retaining full integration and promotion validation on pinned DelendAI 0.3.0.

## why

The parallel CI workflow currently repeats a fixed job list for local proof and
CI, so a fast scope check can silently drift from the jobs that protect the
branch. One deterministic plan makes uncertainty widen validation and gives
the required `ci-summary` enough information to reject a skipped planned job.
Source changes keep the frozen aggregate coverage baseline; the affected test
stage provides an earlier, narrower signal while changed-file coverage is
measured as a follow-up.

## non-goals

- Replacing the repository-wide coverage baseline with partial coverage.
- Skipping tests for product source changes based only on import reachability.
- Running Bun-only SQLite or transport suites for documentation and proposal
  edits that cannot affect those suites.

## slices

- global_gate: none

### S1 — Plan and execute scoped proof
- **Status**: review
- **Files**: `package.json`, `delendai.config.json`, `scripts/helpers/proof-plan.helper.ts`, `scripts/gates/prove.script.ts`, `packages/contracts/interfaces/quality/proof-plan.interface.ts`, `packages/contracts/constants/quality/proof-rules.constant.ts`, `tests/scripts-gates/proof-plan.spec.ts`, `.github/workflows/validate.yml`, `scripts/build/ci-summary.script.ts`
- **Gate**: e2e
- acceptance:
  - "Local and CI consume the same conservative plan"
  - "Unknown paths and failed analysis widen validation"
  - "Scope-aware skips cannot produce a false green"
- shipped-in: `88fa0a127496`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- Local and CI consume the same conservative plan
- Unknown paths and failed analysis widen validation
- Scope-aware skips cannot produce a false green
