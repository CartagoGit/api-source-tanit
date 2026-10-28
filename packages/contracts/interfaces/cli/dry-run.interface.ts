/**
 * The dry-run: what would happen if we generated.
 *
 * The shape of this response is built for a screen, not for a log.
 * That is why `overwrites` is a separate number and not something
 * the consumer must derive by counting: it **is** the dry-run's
 * data — the first time everything is new, and from the second on
 * the interesting thing is what would be lost — and letting each
 * screen count on its own is how two end up reporting different
 * numbers for the same thing.
 */

import type { IGenerationResult } from "../core/discovery.interface.js";

/** A file that would be written. */
export interface IPlannedFile {
  /** Absolute path, exactly as it would be written. */
  readonly path: string;
  /**
   * What it is.
   *
   * `collection` is the Postman one; `export` is the same API in
   * another format; `environment` are the per-env variables. They
   * are distinguished because they are not lost equally:
   * overwriting an environment edited by hand wipes credentials
   * someone typed in.
   */
  readonly kind: "collection" | "export" | "environment";
  /** The format it comes out as. */
  readonly format: string;
  /** Whether there is already a file there that would be lost. */
  readonly overwrites: boolean;
}

/** What is needed to plan without writing. */
export interface IDryRunInput {
  readonly projectRoot: string;
  /** Where output would go. Defaults to the conventional folder. */
  readonly outputDir?: string | undefined;
  /** Requested formats. Defaults to Postman only. */
  readonly formats?: ReadonlyArray<string> | undefined;
  /**
   * The pipeline result, **already built in memory**.
   *
   * It is passed in built rather than computed here because the
   * dry-run cannot have its own way of discovering endpoints: it
   * would be a second implementation that would end up saying one
   * thing while `generate` does another — which is the very bug a
   * dry-run comes to prevent.
   */
  readonly result: IGenerationResult;
}

/** The full plan, without touching disk. */
export interface IDryRunPlan {
  readonly ok: boolean;
  /** Where everything would go. */
  readonly outputDir: string;
  /** The name files would be derived from. */
  readonly projectName: string;
  readonly framework: string | null;
  /** How many requests the collection would have. */
  readonly requests: number;
  readonly files: ReadonlyArray<IPlannedFile>;
  /** How many of those files already exist. That's the data point. */
  readonly overwrites: number;
  /** What the pipeline would warn about when actually generating. */
  readonly warnings: ReadonlyArray<string>;
  /** Why the plan is not valid. `undefined` when it is. */
  readonly reason?: string;
}
