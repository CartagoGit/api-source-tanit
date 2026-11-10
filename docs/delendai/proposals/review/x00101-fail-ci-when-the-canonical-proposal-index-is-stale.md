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
---

# x00101 — Fail CI when the canonical proposal index is stale

## goal

Fail the proposal lint gate when docs/delendai/proposals/INDEX.md differs from canonical generated output. Reuse the existing index --check generator path so CI verifies the committed artifact.

## why

TODO: why this work matters now.

## non-goals

- TODO: what this proposal deliberately skips.

## slices

- global_gate: none

### S1 — Wire canonical INDEX drift check into proposal lint
- **Status**: review
- **Files**: `package.json`
- **Gate**: lint
- shipped-in: `ae83443ddaab`
- review-state: in_review
- review-implementer: openai-gpt-6-luna

## acceptance

- TODO: observable acceptance criteria.
