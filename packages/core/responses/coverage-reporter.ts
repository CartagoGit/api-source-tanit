/**
 * Response-inference coverage reporter (proposal `r00020` S3).
 *
 * ## What it measures
 *
 * The percentage of **operations** (endpoints) for which the
 * framework's inferrer produced at least one response. Not the
 * percentage of lines of the inferrer that the tests touch — that is
 * the coverage gate's job, and it answers a different question
 * ("is `infer()` of the Laravel inferrer ever executed?").
 *
 * This one answers the question a user of the collection notices:
 * "a third of the Laravel endpoints still ship without a response
 * example".
 *
 * ## Why it is a diagnostic and not a gate
 *
 * Because a percentage is not a verdict. An endpoint can legitimately
 * have no inferrable response (a redirect, a stream, a `204`), and a
 * framework that ships a new version can change how many routes a
 * project has. Blocking a generation on a percentage would turn a
 * measurement into a build-breaker, and the first time a framework
 * added one route nobody modelled, the tool would stop working for
 * everybody on that framework.
 *
 * So the reporter **measures and says**. The frozen baseline lives in
 * `constants/core/response-inference.constant.ts` and the comparison
 * is a warning.
 */
import type {
  IResponseCoverageEntry,
  IResponseCoverageReport,
  IResponseFrameworkCoverage,
} from "../../contracts/interfaces/core/response-coverage.interface.js";
import {
  RESPONSE_INFERENCE_COVERAGE_BASELINE,
} from "../../contracts/constants/core/response-inference.constant.js";

/**
 * Turns the counters the dispatcher collected into the report.
 *
 * The rows come out sorted by framework slug, so two runs of the same
 * project print the same lines in the same order.
 */
export function buildCoverageReport(
  counters: ReadonlyArray<IResponseFrameworkCoverage>,
): IResponseCoverageReport {
  const rows: IResponseCoverageEntry[] = [];
  for (const counter of counters) {
    const baseline = baselineOf(counter);
    const percentage = percentageOf(counter.inferred, counter.total);
    rows.push({
      id: counter.id,
      framework: counter.framework,
      total: counter.total,
      inferred: counter.inferred,
      percentage,
      baseline,
      // An inferrer with no reference fixture has no baseline to fall
      // below: the reporter prints its number and stays quiet.
      belowBaseline: baseline !== null && percentage < baseline,
    });
  }
  rows.sort((a, b) => a.framework.localeCompare(b.framework));

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const inferred = rows.reduce((sum, row) => sum + row.inferred, 0);
  return {
    entries: rows,
    total,
    inferred,
    percentage: percentageOf(inferred, total),
    regressions: rows.filter((row) => row.belowBaseline),
  };
}

/**
 * Prints the report as a diagnostic.
 *
 * It never throws and never blocks: the caller decides what to do
 * with the return value, and this function only says what it found.
 */
export function logCoverageReport(report: IResponseCoverageReport): void {
  if (report.entries.length === 0) return;

  const lines = report.entries.map(
    (row) =>
      `  ${row.framework}: ${row.inferred}/${row.total} operations with an inferred ` +
      `response (${row.percentage}%, baseline ${
        row.baseline === null ? "not measured" : `${row.baseline}%`
      })`,
  );
  const header =
    `[responses] inference coverage — ${report.inferred}/${report.total} ` +
    `operations (${report.percentage}%)`;

  if (report.regressions.length > 0) {
    console.warn(
      `${header}\n${lines.join("\n")}\n` +
        `  ⚠ below baseline: ${report.regressions
          .map((row) => row.framework)
          .join(", ")}`,
    );
    return;
  }
  console.log(`${header}\n${lines.join("\n")}`);
}

/**
 * Measures and says — the call the pipeline makes at the end.
 *
 * It returns the report so a caller that wants to do something else
 * with it (a test, an MCP tool) can.
 */
export function reportResponseCoverage(
  counters: ReadonlyArray<IResponseFrameworkCoverage>,
): IResponseCoverageReport {
  const report = buildCoverageReport(counters);
  logCoverageReport(report);
  return report;
}

/**
 * The frozen reference of a framework.
 *
 * `null` when nobody measured it: a framework without an inferrer, or
 * an inferrer without a reference fixture.
 */
function baselineOf(counter: IResponseFrameworkCoverage): number | null {
  if (counter.id === null) return null;
  return RESPONSE_INFERENCE_COVERAGE_BASELINE[counter.id] ?? null;
}

/**
 * `inferred / total`, as a percentage with one decimal.
 *
 * A framework with no operations at all is `0`, not `NaN`.
 */
function percentageOf(inferred: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((inferred / total) * 1000) / 10;
}
