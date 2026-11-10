---
id: x00102
title: "Keep response coverage diagnostics off JSON stdout"
kind: fix
status: review
type: proposal
track: general
date: 2026-11-10
last-transition-id: 41f26281-53c0-4277-a521-6fa6e9b5cc8d
last-correlation-id: 41f26281-53c0-4277-a521-6fa6e9b5cc8d
last-transition-from: in-progress
last-transition-at: 2026-11-10T18:57:27.501Z
shipped-in:
  - "c502f7e0"
---

# x00102 — Keep response coverage diagnostics off JSON stdout

## goal

Keep response-inference coverage diagnostics off the CLI's JSON stdout while
preserving the structured generation report.

## why

The JSON mode reserves stdout for one machine-readable report. When coverage
meets its reference baseline, the coverage reporter currently uses
`console.log`, so an otherwise successful `generate --json` invocation emits
human text before the JSON document and consumers fail to parse it.

## non-goals

- Do not filter or rewrite diagnostic text in CLI consumers.
- Do not read `process.argv` from core, monkey-patch console methods, or add a
  parallel output abstraction.
- Do not change the response coverage report shape or baseline calculations.

## slices

- global_gate: none

### S1 — Send coverage diagnostics to stderr
- **Status**: done
- **Files**: `packages/core/responses/coverage-reporter.ts`, `tests/response-inference/coverage.spec.ts`, `tests/cli/generate-json-report.test.ts`, this proposal.
- **Gate**: focused response coverage and CLI JSON report specs.
- **Acceptance**: a high-coverage report uses the warning channel and returns the same structured report; an inline Express route with a 100% response-inference result still produces parseable JSON on stdout and reports coverage on stderr.
- shipped-in: `e82d1d1f8817`
- review-state: done
- review-implementer: openai-gpt-6-luna
- review-reviewer: openai-gpt-6.1-sol
- review-log: approved by openai-gpt-6.1-sol — verified at c502f7e0, validate exit 0 and tests 30/30 claimed, no recorded run cited; acceptance 3/3: (1) Independently inspected core diagnostic producer change and real CLI JSON regression. Focused response and CLI specs30/30 in this unit; full implementation pro… (2) Independently inspected core diagnostic producer change and real CLI JSON regression. Focused response and CLI specs30/30 in this unit; full implementation pro… (3) Independently inspected core diagnostic producer change and real CLI JSON regression. Focused response and CLI specs30/30 in this unit; full implementation pro… — Independently inspected core diagnostic producer change and real CLI JSON regression. Focused response and CLI specs30/30 in this unit; full implementation proof and PR151 CI passed. No consumer filtering or reportshape changes.

## acceptance

- Coverage diagnostics always use stderr through `console.warn`, including when the measured percentage meets or exceeds the reference baseline.
- The in-process reporter still returns the same structured `IResponseCoverageReport` and retains the existing explanatory text for below-baseline projects.
- The actual `generate --json` process emits one parseable JSON document on stdout for an inline Express response with high coverage; the human coverage diagnostic appears on stderr.
