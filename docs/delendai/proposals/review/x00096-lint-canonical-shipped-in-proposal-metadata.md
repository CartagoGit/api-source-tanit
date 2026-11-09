---
id: x00096
title: "Lint canonical shipped-in proposal metadata"
kind: fix
status: review
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: b4a49cc5-b455-4815-a669-0f6ba6fd166e
last-correlation-id: b4a49cc5-b455-4815-a669-0f6ba6fd166e
last-transition-from: in-progress
last-transition-at: 2026-11-09T15:44:34.100Z
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
- **Status**: review
- **Files**: `scripts/gates/lint-proposals.script.ts`, `tests/scripts-gates/proposal-frontmatter.spec.ts`, `docs/delendai/proposals/INDEX.md`
- **Gate**: test
- shipped-in: `a6126caeaa0d`
- review-state: in_review
- review-implementer: openai-gpt-6-luna

## acceptance

- The linter accepts canonical `shipped-in` block and inline lists as well as legacy `shippedIn` lists.
- Missing, malformed, or unreachable SHA values still fail proposal closure validation.
