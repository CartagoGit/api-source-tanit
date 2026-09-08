/**
 * `dry-run.handler.ts` — re-run the pipeline without writing.
 *
 * Calls `generateCollections()` with the session's stored options
 * (or the caller-supplied override) and returns the result. This
 * is the cheapest way to validate that a scan still works after a
 * config change, before committing to a real export.
 */

import type { IHandler } from "./dispatcher.js";
import {
  DryRunInputSchema,
  type DryRunInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { generateCollections } from "../discovery/generation.pipeline.js";
import { apiError } from "./error.js";
import type { IGenerationOptions } from "../../contracts/interfaces/core/discovery.interface.js";

/** Resultado de ejecutar la generación sin escribir una colección. */
export interface DryRunOutput {
  /** Endpoint count the dry run produced. */
  readonly endpointCount: number;
  /** Frameworks that recognised the project. */
  readonly frameworks: ReadonlyArray<string>;
  /** Warnings emitted by the pipeline during the dry run. */
  readonly warnings: ReadonlyArray<string>;
  /** Wall-clock duration of the dry run, in ms. */
  readonly durationMs: number;
}

/** Crea el handler que ejecuta la generación sin escribir una colección. */
export function createDryRunHandler(): IHandler<DryRunInput, DryRunOutput> {
  return {
    name: "dry-run",
    input: DryRunInputSchema,
    async handle(input, ctx) {
      const session = getSession(input.projectRoot);
      if (!session) {
        throw apiError(
          "SESSION_NOT_FOUND",
          `No open session for projectRoot "${input.projectRoot}"`,
        );
      }
      if (!ctx.orchestrator) {
        throw apiError(
          "EXECUTION_FAILED",
          "dry-run requires ctx.orchestrator",
        );
      }

      // The session stores the options it was opened with; the
      // handler reads them off the most-recent snapshot to honour
      // any settings.patch the caller applied between open and
      // dry-run. That keeps a single source of truth.
      const snap = session.current();
      const firstResult = snap.results[0];
      if (!firstResult) {
        throw apiError(
          "EXECUTION_FAILED",
          "Snapshot has no results — re-open the session",
        );
      }
      const generationOptions: IGenerationOptions = {
        orchestrator: ctx.orchestrator as IGenerationOptions["orchestrator"],
        ...(input.collectionName !== undefined
          ? { collectionName: input.collectionName }
          : {}),
      };

      const started = Date.now();
      let results;
      try {
        results = await generateCollections(input.projectRoot, generationOptions);
      } catch (err) {
        throw apiError("EXECUTION_FAILED", (err as Error).message);
      }
      const allFrameworks = new Set<string>();
      const allWarnings: string[] = [];
      let endpointCount = 0;
      for (const r of results) {
        for (const fw of r.frameworks) allFrameworks.add(fw);
        for (const w of r.warnings) allWarnings.push(w);
        endpointCount += r.specs.length;
      }
      return {
        endpointCount,
        frameworks: [...allFrameworks],
        warnings: allWarnings,
        durationMs: Date.now() - started,
      };
    },
  };
}