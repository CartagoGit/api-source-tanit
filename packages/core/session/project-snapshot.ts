/**
 * Immutable snapshot produced by a ProjectSession scan.
 *
 * All fields are `readonly`. The object is created via `makeSnapshot()`
 * and then frozen — callers may not mutate it after construction.
 */

import type { IGenerationResult } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IDetectorDiagnostic } from "../../contracts/interfaces/core/scanner.interface.js";

/** Immutable snapshot of a single project scan. */
export interface IProjectSnapshot {
  readonly sessionId: string;
  readonly projectRoot: string;
  readonly capturedAt: Date;
  /** All generation results (one per service in multi-service projects). */
  readonly results: ReadonlyArray<IGenerationResult>;
  /** Detector-level diagnostics emitted during the scan. */
  readonly diagnostics: ReadonlyArray<IDetectorDiagnostic>;
  /** Frameworks that recognized the project. */
  readonly frameworks: ReadonlyArray<string>;
}

/** Creates an immutable snapshot from the scan output. */
export function makeSnapshot(opts: {
  sessionId: string;
  projectRoot: string;
  results: ReadonlyArray<IGenerationResult>;
  diagnostics: ReadonlyArray<IDetectorDiagnostic>;
}): IProjectSnapshot {
  const snap: IProjectSnapshot = Object.freeze({
    sessionId: opts.sessionId,
    projectRoot: opts.projectRoot,
    capturedAt: new Date(),
    results: Object.freeze([...opts.results]),
    diagnostics: Object.freeze([...opts.diagnostics]),
    frameworks: Object.freeze(
      [...new Set(opts.results.flatMap((r) => r.frameworks))],
    ),
  });
  return snap;
}
