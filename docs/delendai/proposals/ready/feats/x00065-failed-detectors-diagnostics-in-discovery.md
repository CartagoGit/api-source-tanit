---
id: x00065
title: "`failedDetectors` diagnostics — broken detectors ≠ undetected framework"
kind: feat
status: ready
type: proposal
track: api-source-tanit
date: 2026-09-07
dependsOn:
  - a00018
---

# x00065 — Surface detector crashes via `IDiscovery.diagnostics.failedDetectors`

## Goal

Today a broken detector (e.g. a parser throws) is indistinguishable
from "the framework is not present": both produce `score: 0`. The audit
cites this as **P2 #8** for "agent-friendliness": an LLM reading the
result cannot tell whether the framework was absent or the detector
crashed, and acts on the wrong premise.

## Why

- The orchestrator already has a `try/catch` in `detect()` and
  `resolve()` (`discovery.orchestrator.ts:96`, `:128`). It already
  swallows the error with `void error;` and a comment that explicitly
  says `failedDetectors` is not implemented.
- The data exists; the wiring does not.

## Approach

### S1 — Diagnostic shape

**Files**:

- `packages/contracts/interfaces/core/scanner.interface.ts` — add:

```ts
export interface IDetectorDiagnostic {
  readonly component: string;       // detector.framework id
  readonly phase: "detect" | "resolve";
  readonly severity: "error" | "warning";
  readonly sourceFile: string | null;  // projectRoot if no file
  readonly reason: string;
  readonly recoverable: boolean;
  readonly durationMs: number;
  readonly timestamp: string;  // ISO 8601
}
```

- `IDiscoveryOrchestrator.detectAll()` returns
  `{ results: IDetectedFramework[], diagnostics: IDetectorDiagnostic[] }`.

### S2 — Wire the orchestrator

**Files**:

- `packages/core/discovery/discovery.orchestrator.ts` — keep the
  `try/catch`, but route errors to the new array:

```ts
catch (error) {
  diagnostics.push({
    component: detector.framework,
    phase: "detect",
    severity: "error",
    sourceFile: projectRoot,
    reason: error instanceof Error ? error.message : String(error),
    recoverable: true,
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
  result = { score: 0, evidence: [] };
}
```

- Same for `resolve()`.

- `IDiscovery` (in `discovery.interface.ts`) — add `diagnostics:
  ReadonlyArray<IDetectorDiagnostic>`. The pipeline propagates it up
  to `IGenerationResult.diagnostics` so the CLI / MCP / UI can read it.

### S3 — Surface in the CLI

**Files**:

- `packages/cli/commands/generate.script.ts` — when
  `result.diagnostics.length > 0`, print a yellow warning section:

```
⚠ 2 detector(s) failed:
  · django (detect) in 1243 ms — Cannot read property 'X' of undefined
  · phoenix (resolve) in 38 ms — No mix.exs found at projectRoot
```

No exit-code change (a crashed detector does not block the rest of
the analysis), but the message is visible.

- `packages/cli/commands/summary.script.ts` — same.

### S4 — MCP / UI consumers

The MCP `summary` tool returns the diagnostics in its output schema
(new optional `diagnostics` field). The web UI dashboard shows a
banner if any detector failed.

**Gate**: `bun run typecheck` green; `bun run test:core` green;
`bun run test:e2e` green; `bun run lint` green.

## Acceptance

- A simulated crashing detector produces a `failedDetectors` entry
  (in tests via a deliberately-throwing `IProjectScanner` fixture).
- The entry includes component, phase, reason, durationMs, timestamp.
- The CLI prints the warning section.
- `IDiscovery.diagnostics` is part of the public contract.

## Risks

- A noisy diagnostic stream in normal runs. Mitigation: only print
  when there is at least one entry; in tests, count entries explicitly
  rather than via `length > 0`.

## Out of scope

- Re-attempting the detector with a different strategy. A failed
  detector is a bug; it is surfaced for the user/agent to handle.