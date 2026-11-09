---
id: x00096
title: "Lint canonical shipped-in proposal metadata"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 107d6a14-9e28-4939-a2e5-1ec677355f92
last-correlation-id: 107d6a14-9e28-4939-a2e5-1ec677355f92
last-transition-from: review
last-transition-at: 2026-11-09T21:18:22.192Z
shipped-in:
  - "bebadb7005b46141961d4924c96e8a97268ad2d5"
---

# x00096 — Lint canonical shipped-in proposal metadata

## goal

Keep archived proposal validation compatible with DelendAI 0.3 canonical shipped-in frontmatter while preserving SHA reachability checks.

## why

DelendAI 0.3 writes the canonical `shipped-in` field when it archives a proposal. The repository lint only read the legacy `shippedIn` spelling, so a valid archive was rejected before closure could be certified.

## non-goals

- Rewriting or moving archived proposal documents.

## slices

- global_gate: none

### S1 — Parse canonical and legacy shipped-in metadata without relaxing SHA validation
- **Status**: done
- **Files**: `scripts/gates/lint-proposals.script.ts`, `tests/scripts-gates/proposal-frontmatter.spec.ts`, `docs/delendai/proposals/INDEX.md`
- **Gate**: test
- shipped-in: `a6126caeaa0d`
- review-state: done
- review-implementer: openai-gpt-6-luna
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at bebadb7005b4, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 2/2: (1) Reviewed canonical/legacy shared parser and quoted block support;8 frontmatter tests and actual canonical archive lint passed. (2) Malformed tokens remain subject to unchanged SHA reachability validation; missing/invalid and real archive checks passed. — Independent Sol source review. Reused actual full validation /tmp/tanit-parent-final-validation.log timestamp2026-11-09T15:40:25.691Z:4973/4975,2skipped. Source/tests/config verified byte-identical to tested2d3 snapshot; no full rerun claimed in this fresh unit.

## acceptance

- The linter accepts canonical `shipped-in` block and inline lists as well as legacy `shippedIn` lists.
- Missing, malformed, or unreachable SHA values still fail proposal closure validation.
