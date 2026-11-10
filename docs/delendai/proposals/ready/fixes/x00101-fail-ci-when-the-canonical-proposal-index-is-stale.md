---
id: x00101
title: "Fail CI when the canonical proposal index is stale"
kind: fix
status: ready
type: proposal
track: general
date: 2026-11-10
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
- **Status**: pending
- **Files**: `package.json`
- **Gate**: lint

## acceptance

- TODO: observable acceptance criteria.
