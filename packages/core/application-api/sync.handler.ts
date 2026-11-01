/**
 * `sync.handler.ts` — generate and write, in one verb.
 *
 * ## What it used to be
 *
 * Nothing. The CLI's `sync` was a wrapper around `generate`, and the
 * app had no way to ask for it: its screen could only say "not
 * available yet".
 *
 * ## What it is
 *
 * The composition the CLI's `sync` was, as a handler: the plan and
 * the write, from **one** build of the artifacts. A preview that
 * built them again could promise a file the write would not produce,
 * and building twice spends twice the time on the most expensive step
 * of the pipeline.
 *
 * A dry run builds and reports, and writes nothing.
 */
import { join } from "node:path";

import type { IHandler } from "./dispatcher.js";
import {
  SyncInputSchema,
  type SyncInput,
} from "./zod-schemas.js";
import {
  requireResults,
  requireSession,
} from "./project-verbs.helper.js";
import {
  planExport,
  writeExportWithPlan,
} from "./export-artifacts.helper.js";
import type { SyncOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { SyncOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler que genera y escribe. */
export function createSyncHandler(): IHandler<SyncInput, SyncOutput> {
  return {
    name: "sync",
    input: SyncInputSchema,
    async handle(input) {
      const session = requireSession(input.projectRoot);
      const snap = requireResults(session.current());

      const target = input.target ?? "postman";
      const directory = input.outputDirectory ?? join(snap.projectRoot, "tanit");

      const frameworks = new Set<string>();
      let endpointCount = 0;
      for (const result of snap.results) {
        for (const framework of result.frameworks) frameworks.add(framework);
        endpointCount += result.specs.length;
      }

      if (input.dryRun === true) {
        const plan = await planExport(snap, target, directory);
        return {
          files: [],
          bytes: 0,
          plannedFiles: plan.files,
          endpointCount,
          frameworks: [...frameworks],
          dryRun: true,
          diagnostics: plan.diagnostics,
        };
      }

      const written = await writeExportWithPlan(snap, target, directory);
      return {
        files: written.files,
        bytes: written.bytes,
        plannedFiles: written.plan.files,
        endpointCount,
        frameworks: [...frameworks],
        dryRun: false,
        diagnostics: written.plan.diagnostics,
      };
    },
  };
}
