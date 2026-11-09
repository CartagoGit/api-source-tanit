---
id: x00096
title: "Lint canonical shipped-in proposal metadata"
kind: fix
status: done
type: proposal
track: api-source-tanit
date: 2026-11-09
last-transition-id: 2b8a7bd5-f3c2-47da-93c5-074a54876d4e
last-correlation-id: 2b8a7bd5-f3c2-47da-93c5-074a54876d4e
last-transition-from: review
last-transition-at: 2026-11-09T15:52:14.005Z
shipped-in:
  - "8d1a1cf7a3b963ecee9417b5d44554f7d811919f"
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
- review-log: approved by openai-gpt-6.1-sol — verified at 8d1a1cf7a3b9, validate exit 0 and tests 4973/4975 claimed, no recorded run cited; acceptance 2/2: (1) Reviewed shared parser and quoted canonical block handling. Actual full validation passed all8 frontmatter tests and the real canonical x90 archive without edi… (2) Malformed entries are retained for existing SHA reachability validation; missing/invalid regressions and all archived provenance checks passed in the full gate. — Independent source review. Actual full validation journal .cache/delendai/results/logs/validate.jsonl at2026-11-09T15:40:25.691Z exit0:4917Vitest+15SQLite+41transport passed,2skipped. Verified landed8d1 source/tests/config byte-identical to tested review snapshot; only proposal metadata differs.

## acceptance

- The linter accepts canonical `shipped-in` block and inline lists as well as legacy `shippedIn` lists.
- Missing, malformed, or unreachable SHA values still fail proposal closure validation.
