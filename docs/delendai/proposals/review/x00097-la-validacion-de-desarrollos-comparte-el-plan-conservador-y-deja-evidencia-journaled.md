---
id: x00097
title: "La validación de desarrollos comparte el plan conservador y deja evidencia journaled"
kind: fix
status: review
type: proposal
track: quality
date: 2026-11-09
last-transition-id: 011f325e-5a22-4072-add9-1481c350d19a
last-correlation-id: 011f325e-5a22-4072-add9-1481c350d19a
last-transition-from: in-progress
last-transition-at: 2026-11-09T21:30:25.318Z
---

# x00097 — La validación de desarrollos comparte el plan conservador y deja evidencia journaled

## goal

Hacer que delendai validate ejecute el mismo plan validado que work prove en unidades de desarrollo, escriba evidencia auténtica para auto-close y conserve validación completa en integración, promociones y full fallback.

## why

`work deliver` already runs the shared proof planner for a source unit,
but a subsequent `delendai validate` repeats the full repository suite.
That command is also the evidence source checked by native proposal
approval and auto-close, so omitting it leaves otherwise accepted work
without a journal entry for its workspace. The local quality command
must reuse the same conservative plan and produce that authentic evidence.

## non-goals

- Changing the proof planner or its fail-closed fallback rules.
- Skipping full validation on integration, release, detached candidate,
  or promotion runs.
- Changing the immutable DelendAI runtime or fabricating validation
  journal entries.

## slices

- global_gate: none

### S1 — Route local validation through the shared proof plan
- **Status**: done
- **Files**: `package.json`, `.github/workflows/release-binaries.yml`,
  `scripts/gates/validate.script.ts`,
  `scripts/gates/validate-examples.script.ts`,
  `tests/scripts-gates/validate-proof.spec.ts`,
  `docs/delendai/proposals/INDEX.md`,
  `docs/delendai/AGENT-BOOTSTRAP.md`,
  `docs/delendai/proposals/ready/fixes/x00097-la-validacion-de-desarrollos-comparte-el-plan-conservador-y-deja-evidencia-journaled.md`
- **Gate**: `bunx vitest run tests/scripts-gates/validate-proof.spec.ts tests/scripts-gates/proof-plan.spec.ts`, `bun run typecheck:cli`, and `bun run lint:proposals`
- shipped-in: `f7d7bf4a8b4a`
- review-state: in_review
- review-implementer: openai-gpt-6-luna

## acceptance

- `bun run validate` invokes the existing proof planner and executor;
  docs-only plans run lint without test/coverage jobs, while source plans
  run affected specs and changed-file coverage.
- The planner's existing uncertainty, unsupported-change, missing-graph,
  and Bun-owned-suite fallbacks remain full aggregate validation.
- Detached candidate checks, configured integration/release branches,
  GitHub push/release contexts, and promotions use the full gate through
  `bun run validate:full` or the wrapper's forced-full mode.
- `delendai validate` retains its normal, authentic validation journal
  entry with the scoped command and result; no runtime/journal behavior is
  changed.
