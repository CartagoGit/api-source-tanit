import { describe, expect, test } from "vitest";
import { evaluateChangedFileCoverage, executeAggregateFallback, runChangedFileCoverage } from "../../scripts/gates/changed-file-coverage.script.js";

const metrics = (pct: number) => Object.fromEntries(
  ["lines", "statements", "functions", "branches"].map(metric => [metric, { total: 100, covered: pct, pct }]),
);

describe("changed-file coverage", () => {
  test("accepts complete metrics at the existing scope floors", () => {
    const result = evaluateChangedFileCoverage(["packages/core/example.service.ts"], {
      "packages/core/example.service.ts": metrics(90),
    });
    expect(result).toEqual({ status: "PASS", failures: [] });
  });

  test("applies the existing section thresholds to every changed file metric", () => {
    const result = evaluateChangedFileCoverage(["packages/core/example.service.ts"], {
      "packages/core/example.service.ts": { ...metrics(95), branches: { total: 100, covered: 89, pct: 89 } },
    });
    expect(result.status).toBe("BELOW_FLOOR");
    expect(result.failures).toContain("changed coverage — packages/core/example.service.ts.branches 89% < core floor 90%");
  });

  test("uses frozen aggregate coverage only for complete below-floor results", async () => {
    const belowFloor = evaluateChangedFileCoverage(["packages/core/example.service.ts"], {
      "packages/core/example.service.ts": metrics(85),
    });
    expect(belowFloor.status).toBe("BELOW_FLOOR");
    let aggregateRuns = 0;
    expect(await executeAggregateFallback(belowFloor, async () => { aggregateRuns += 1; return 0; })).toBe(0);
    expect(aggregateRuns).toBe(1);
    const malformed = evaluateChangedFileCoverage(["packages/core/example.service.ts"], undefined);
    expect(await executeAggregateFallback(malformed, async () => { aggregateRuns += 1; return 0; })).toBe(1);
    expect(aggregateRuns).toBe(1);
  });

  test("fails closed on a missing report, missing changed file, and malformed metrics", () => {
    expect(evaluateChangedFileCoverage(["packages/core/example.service.ts"], undefined).status).toBe("FAIL");
    expect(runChangedFileCoverage(["packages/core/example.service.ts"], "/not/a/report.json").status).toBe("FAIL");
    expect(evaluateChangedFileCoverage(["packages/core/example.service.ts"], {}).failures[0]).toContain("missing changed production file");
    const malformed = evaluateChangedFileCoverage(["packages/core/example.service.ts"], {
      "packages/core/example.service.ts": { ...metrics(95), branches: { total: 4, covered: 8, pct: 95 } },
    });
    expect(malformed.failures[0]).toContain("branches has incomplete metrics");
  });

  test("treats test-only diffs as not applicable", () => {
    expect(evaluateChangedFileCoverage(["tests/core/example.spec.ts"], {}).status).toBe("NOT_APPLICABLE");
  });
});
