---
id: x00068
title: "CI: parallel jobs, always-on security audit, develop branch protection"
kind: chore
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - a00018
---

# x00068 — CI parallelization + branch protection + always-on security

## Goal

Today `.github/workflows/validate.yml` runs:

- `validate` (typecheck + lint + tests + drift guards)
- `audit dependencies` — **skipped if `validate` fails**
- `validate:package` — runs with `if: always()`
- `integration verifier` — runs with `if: always()`

The CI is structurally sound but has three holes the audit
identified:

1. **Security audit is skipped** when validate fails. A lint or
   typecheck error should not prevent a `npm audit` from running.
2. **Single sequential pipeline** — a naming error blocks every
   downstream gate. The audit explicitly recommends splitting into
   parallel jobs.
3. **`develop` is unprotected** — `required_status_checks: []`,
   `protected: false`. The CI is excellent; the policy enforcement
   is not.

## Why (audit 2026-09-06 §16 — P2)

- The CI has 20+ gates. Today they run in series; a failure in gate
  #1 blocks gates #2-20 even when those gates are orthogonal
  (e.g. secret-scan vs. naming).
- The audit recommends splitting into at least 8 parallel jobs.

## Approach

### S1 — Parallel jobs

**Files**:

- `.github/workflows/validate.yml` — split the existing `validate`
  job into:
  - `typecheck`
  - `lint-static`
  - `tests`
  - `coverage`
  - `examples`
  - `benchmark`
  - `security` (runs `npm audit`, the existing audit gate)
  - `package` (existing `validate:package`)
  - `integration-delendai` (existing, opt-in workflow unchanged)

  All with `if: ${{ always() }}` so they run regardless of the others'
  outcomes. The `required` status check on `develop` becomes the
  AND of all the new jobs.

**Gate**: `bun run validate` locally green; CI green on the test PR.

### S2 — Always-on security audit

The existing `audit dependencies` step moves into the new `security`
job (S1) which has `if: always()` — equivalent to "always on". A
typecheck failure no longer blocks it.

**Gate**: CI green; the new `security` job is in the required status
checks list.

### S3 — Branch protection on `develop`

This slice cannot apply branch protection on its own (it requires
admin on the repo). The proposal **documents** the recommended
configuration:

```yaml
required_status_checks:
  strict: true
  contexts:
    - typecheck
    - lint-static
    - tests
    - coverage
    - examples
    - benchmark
    - security
    - package
    - integration-verifier
enforce_admins: true
required_linear_history: true
```

The human operator applies this via the GitHub UI. The proposal is
"doD complete" once the workflow file lands; the branch-protection
change is the human-side counterpart.

**Gate**: the workflow file is green; the operator applies branch
protection.

## Acceptance

- A typecheck failure no longer prevents the `security` job from
  running.
- All 9 jobs are visible in the GitHub PR checks UI.
- `develop` branch protection references all 9 jobs.

## Risks

- The total CI time may go up slightly (each job has a cold-start).
  Mitigation: most jobs share a workspace cache; the parallel time
  is typically 2-3x faster than serial.
- A flaky test in one job no longer halts the whole pipeline — it
  reports red for that job only. The PR is still blocked, which is
  the right behaviour.

## Out of scope

- Self-hosted runners. The proposal assumes GitHub-hosted runners.
- A "soft fail" mode for non-critical jobs.