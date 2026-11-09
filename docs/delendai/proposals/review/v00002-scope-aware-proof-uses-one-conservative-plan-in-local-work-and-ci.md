---
id: v00002
title: "Scope-aware proof uses one conservative plan in local work and CI"
kind: perf
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 597680ba-12e1-4a3f-9c81-c040462706e5
last-correlation-id: 597680ba-12e1-4a3f-9c81-c040462706e5
last-transition-from: in-progress
last-transition-at: 2026-11-09T08:39:23.522Z
shipped-in:
  - "bebadb7005b46141961d4924c96e8a97268ad2d5"
---

# v00002 — Scope-aware proof uses one conservative plan in local work and CI

## goal

Validate changed source and its consumers with one auditable plan, using changed-file coverage for bounded source PRs while retaining full integration and promotion validation on pinned DelendAI 0.3.0.

## why

The parallel CI workflow currently repeats a fixed job list for local proof and
CI, so a fast scope check can silently drift from the jobs that protect the
branch. One deterministic plan makes uncertainty widen validation and gives
the required `ci-summary` enough information to reject a skipped planned job.
For bounded source pull requests, reachable tests and changed-file coverage
provide relevant evidence without paying for the complete suite. Missing or
incomplete coverage remains a failure. Integration pushes and promotions keep
the full aggregate baseline.

## non-goals

- Replacing the repository-wide coverage baseline on integration pushes or promotions.
- Skipping tests for product source changes based only on import reachability.
- Running Bun-only SQLite or transport suites for documentation and proposal
  edits that cannot affect those suites.

## slices

- global_gate: none

### S1 — Plan and execute scoped proof
- **Status**: done
- **Files**: `package.json`, `delendai.config.json`, `scripts/helpers/proof-plan.helper.ts`, `scripts/gates/prove.script.ts`, `packages/contracts/interfaces/quality/proof-plan.interface.ts`, `packages/contracts/constants/quality/proof-rules.constant.ts`, `tests/scripts-gates/proof-plan.spec.ts`, `.github/workflows/validate.yml`, `scripts/gates/ci-summary.script.ts`
- **Gate**: e2e
- acceptance:
  - "Local and CI consume the same conservative plan"
  - "Unknown paths and failed analysis widen validation"
  - "Scope-aware skips cannot produce a false green"
- shipped-in: `88fa0a127496`
- review-state: done
- review-implementer: openai-gpt-6.1-sol
- review-reviewer: openai-gpt-6-luna
- review-log: approved by openai-gpt-6-luna — verified at bebadb7005b4, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 3/3: (1) Reviewed scripts/helpers/proof-plan.helper.ts and prove.script.ts plus CI workflow coverage; local and CI use the same plan generation. (2) Reviewed proof planner fallback behavior and regression cases in tests/scripts-gates/proof-plan.spec.ts. (3) Reviewed ci-summary planned-job enforcement and workflow tests: an omitted planned job or failed scoped analysis cannot yield a successful overall CI result. — Independent review at landed develop snapshot bebadb7005b46141961d4924c96e8a97268ad2d5. Reused the actual governed validation from the previous review unit: exit 0, 4917 Vitest + 15 SQLite + 41 transport = 4973/4975, two platform skips; journal timestamp 2026-11-09T15:37:21.268Z at the prior unit path .cache/delendai/results/logs/validate.jsonl. It was not rerun in G4. Tracked source diff from validated 3e02acdb to this snapshot is empty outside proposal metadata. Fresh lint:docs and lint:proposals pass. Independent source review; no changes requested.

### S2 — Run changed-file coverage on bounded source pull requests
- **Status**: review
- **Files**: `scripts/helpers/proof-plan.helper.ts`, `scripts/gates/prove.script.ts`, `scripts/gates/changed-file-coverage.script.ts`, `packages/contracts/interfaces/quality/changed-file-coverage.interface.ts`, `tests/scripts-gates/proof-plan.spec.ts`, `tests/scripts-gates/changed-file-coverage.spec.ts`, `scripts/gates/branch-protection.script.ts`, `tests/scripts-gates/branch-protection.spec.ts`
- **Gate**: e2e
- acceptance:
  - "Known source modifications run the dependency-reached specs with coverage and enforce the existing coverage-policy thresholds on every changed measurable source file"
  - "Missing reports, missing changed-file entries, and malformed metrics fail the affected-test job"
  - "A complete changed-file floor shortfall runs the frozen aggregate coverage gate as a conservative fallback"
  - "Resource/import uncertainty, unsupported source paths, configuration changes, and structural source changes select full validation"
  - "Docs and proposal additions, removals, and moves remain eligible for the verified no-coverage path"
  - "Integration branch protection follows the integration profile; release and promotion branches keep strict status checks"
- shipped-in: `328c85ed167d`
- review-state: in_review
- review-implementer: openai-gpt-6.1-sol

## acceptance

- Local and CI consume the same conservative plan
- Unknown paths and failed analysis widen validation
- Scope-aware skips cannot produce a false green
