/**
 * Response-inference coverage contracts (proposal `r00020` S3).
 *
 * ## What "coverage" means here
 *
 * Not the percentage of *lines* of an inferrer that the tests touch —
 * that is what the coverage gate measures. This is the percentage of
 * **operations** (endpoints) for which the inferrer produced at least
 * one response.
 *
 * The two are different questions and they answer different
 * complaints. Line coverage tells you "the `infer()` of the Laravel
 * inferrer is never executed". Operation coverage tells you "a third
 * of the Laravel endpoints still ship without a response example" —
 * which is the thing a user of the collection actually notices.
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
import type { ResponseInferrerId } from "../../constants/core/response-inference.constant.js";

/**
 * What one framework's operations looked like.
 *
 * The dispatcher counts them while it enriches the specs; the
 * reporter turns them into percentages.
 */
export interface IResponseFrameworkCoverage {
  /** The framework slug. */
  readonly framework: string;
  /**
   * The inferrer that serves it, or `null` when the framework has no
   * inferrer — in which case every one of its operations counts as
   * "not inferred", which is the truth.
   */
  readonly id: ResponseInferrerId | null;
  /** How many operations the framework declared. */
  readonly total: number;
  /** How many of them ended up with at least one response. */
  readonly inferred: number;
}

/**
 * One framework's row of the coverage report.
 */
export interface IResponseCoverageEntry {
  /** The inferrer's id, or `null` for a framework without one. */
  readonly id: ResponseInferrerId | null;
  /** The framework slug. */
  readonly framework: string;
  /** Operations declared by the framework. */
  readonly total: number;
  /** Operations that ended up with a response. */
  readonly inferred: number;
  /** `inferred / total`, as a percentage rounded to one decimal. */
  readonly percentage: number;
  /**
   * The frozen reference for this framework, or `null` when the
   * framework has **no reference fixture** yet.
   *
   * A `null` baseline means "nobody measured this one": the reporter
   * prints the number and says nothing about it, and the row is
   * never a regression. Inventing a number for an inferrer nobody
   * measured would be a baseline nobody could reproduce.
   */
  readonly baseline: number | null;
  /** Whether the measurement fell below the frozen reference. */
  readonly belowBaseline: boolean;
}

/**
 * The whole measurement.
 */
export interface IResponseCoverageReport {
  /** One row per framework, sorted by framework slug. */
  readonly entries: ReadonlyArray<IResponseCoverageEntry>;
  /** Operations measured, across every framework. */
  readonly total: number;
  /** Operations that ended up with a response. */
  readonly inferred: number;
  /** `inferred / total`, as a percentage rounded to one decimal. */
  readonly percentage: number;
  /** The rows that fell below their frozen reference. */
  readonly regressions: ReadonlyArray<IResponseCoverageEntry>;
}
