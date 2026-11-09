---
id: v00002
title: "Scope-aware proof uses one conservative plan in local work and CI"
kind: perf
status: ready
type: proposal
track: api-source-tanit
date: 2026-11-09
---

# v00002 — Scope-aware proof uses one conservative plan in local work and CI

## goal

Validate changed source and its consumers with one auditable plan while retaining full integration and promotion validation on pinned DelendAI 0.3.0.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Plan and execute scoped proof
- **Status**: pending
- **Files**: `package.json`, `delendai.config.json`, `scripts/helpers/proof-plan.helper.ts`, `scripts/gates/prove.script.ts`, `packages/contracts/interfaces/quality/proof-plan.interface.ts`, `packages/contracts/constants/quality/proof-rules.constant.ts`, `tests/scripts-gates/proof-plan.spec.ts`, `.github/workflows/validate.yml`, `scripts/build/ci-summary.script.ts`
- **Gate**: e2e
- acceptance:
  - "Local and CI consume the same conservative plan"
  - "Unknown paths and failed analysis widen validation"
  - "Scope-aware skips cannot produce a false green"

## acceptance

- Local and CI consume the same conservative plan
- Unknown paths and failed analysis widen validation
- Scope-aware skips cannot produce a false green
