---
id: x00101
title: "Fail CI when the canonical proposal index is stale"
kind: fix
status: review
type: proposal
track: general
date: 2026-11-10
last-transition-id: 46dbac9d-faa6-450f-85d8-5af59737ce29
last-correlation-id: 46dbac9d-faa6-450f-85d8-5af59737ce29
last-transition-from: in-progress
last-transition-at: 2026-11-10T18:49:02.179Z
shipped-in:
  - "94bacf8b"
---

# x00101 — Fail CI when the canonical proposal index is stale

## goal

Fail the proposal lint gate when docs/delendai/proposals/INDEX.md differs from canonical generated output. Reuse the existing index --check generator path so CI verifies the committed artifact.

## why

Recent delivery packs updated proposal states without adding their generated Done rows. The existing structural lint accepted that stale index, so contributors and agents could read inconsistent status information.

## non-goals

- Do not introduce a second proposal index renderer or change proposal state semantics.
- Do not alter frozen archived proposals.

## slices

- global_gate: none

### S1 — Wire canonical INDEX drift check into proposal lint
- **Status**: done
- **Files**: `package.json`
- **Gate**: lint
- shipped-in: `ae83443ddaab`
- review-state: done
- review-implementer: openai-gpt-6-luna
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at 94bacf8b, validate exit 0 and tests 2/2 claimed, no recorded run cited; acceptance 3/3: (1) Independently inspected package gate wiring. Deleted generated x00048 Done row made lint:proposals fail; exact original INDEX restored then lint passed. This r… (2) Independently inspected package gate wiring. Deleted generated x00048 Done row made lint:proposals fail; exact original INDEX restored then lint passed. This r… (3) Independently inspected package gate wiring. Deleted generated x00048 Done row made lint:proposals fail; exact original INDEX restored then lint passed. This r… — Independently inspected package gate wiring. Deleted generated x00048 Done row made lint:proposals fail; exact original INDEX restored then lint passed. This review replaces proposal TODO placeholders with explicit existing-scope criteria. Two manual assertions, not automated test cases.

## acceptance

- `bun run lint:proposals` invokes the existing canonical index generator in check mode.
- Removing a generated Done row causes proposal lint to fail with a nonzero exit code.
- Restoring the exact canonical index makes proposal lint pass; the check itself never rewrites INDEX.md.
