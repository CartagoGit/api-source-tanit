import { describe, expect, test } from "vitest";

import {
  evaluateCoverage,
  type IBaseline,
  type ICoverageSummary,
} from "../../scripts/gates/coverage.script";

const baseline: IBaseline = {
  thresholds: {
    global: { lines: 80, statements: 80, functions: 80, branches: 80 },
    core: { lines: 90, statements: 90, functions: 90, branches: 90 },
    frameworks: { lines: 75, statements: 75, functions: 75, branches: 75 },
    cli: { lines: 70, statements: 70, functions: 70, branches: 70 },
  },
  baseline: {
    global: { lines: 80, statements: 80, functions: 80, branches: 80 },
    core: { lines: 90, statements: 90, functions: 90, branches: 90 },
    frameworks: { lines: 75, statements: 75, functions: 75, branches: 75 },
    cli: { lines: 70, statements: 70, functions: 70, branches: 70 },
  },
};

function metrics(pct: number): Record<string, { total: number; covered: number; pct: number }> {
  return Object.fromEntries(["lines", "statements", "functions", "branches"].map((metric) => [
    metric,
    { total: 100, covered: pct, pct },
  ]));
}

describe("coverage gate", () => {
  test("accepts all required profiles at threshold", () => {
    const summary: ICoverageSummary = {
      total: metrics(80),
      "/packages/core/example.ts": metrics(90),
      "/packages/frameworks/example.ts": metrics(75),
      "/packages/cli/example.ts": metrics(70),
    };

    expect(evaluateCoverage(summary, baseline)).toEqual([]);
  });

  test("rejects missing profiles and metrics below threshold", () => {
    const summary: ICoverageSummary = {
      total: metrics(80),
      "/packages/core/example.ts": metrics(89),
    };

    expect(evaluateCoverage(summary, baseline)).toEqual([
      "coverage — core.lines 89% < baseline 90% o threshold 90%",
      "coverage — core.statements 89% < baseline 90% o threshold 90%",
      "coverage — core.functions 89% < baseline 90% o threshold 90%",
      "coverage — core.branches 89% < baseline 90% o threshold 90%",
      "coverage — frameworks.lines no tiene métricas completas",
      "coverage — frameworks.statements no tiene métricas completas",
      "coverage — frameworks.functions no tiene métricas completas",
      "coverage — frameworks.branches no tiene métricas completas",
      "coverage — cli.lines no tiene métricas completas",
      "coverage — cli.statements no tiene métricas completas",
      "coverage — cli.functions no tiene métricas completas",
      "coverage — cli.branches no tiene métricas completas",
    ]);
  });
});