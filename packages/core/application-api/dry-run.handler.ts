/**
 * `dry-run.handler.ts` — what would be written, without writing it.
 *
 * It used to re-run the whole generation pipeline just to count the
 * endpoints and collect the warnings, and it said nothing about the
 * files. That was enough for a smoke test and not enough for a
 * preview: the Export Center needs to know **which files**, **where**,
 * and **whether anything would be overwritten** before the user
 * agrees to write.
 *
 * Now it builds the artifacts — the same ones the export would
 * write — and reports what would happen to each file. Nothing is
 * written.
 */
import { join } from "node:path";

import type { IHandler } from "./dispatcher.js";
import {
  DryRunInputSchema,
  type DryRunInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { planExport } from "./export-artifacts.helper.js";
import { describeFormats } from "../exporters/export-registry.service.js";
import { apiError } from "./error.js";

/** Resultado de ejecutar la generación sin escribir una colección. */
import type { DryRunOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { DryRunOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler que ejecuta la generación sin escribir una colección. */
export function createDryRunHandler(): IHandler<DryRunInput, DryRunOutput> {
  return {
    name: "dry-run",
    input: DryRunInputSchema,
    async handle(input) {
      const session = getSession(input.projectRoot);
      if (!session) {
        throw apiError(
          "SESSION_NOT_FOUND",
          `No open session for projectRoot "${input.projectRoot}"`,
        );
      }
      const snap = session.current();
      if (snap.results.length === 0) {
        throw apiError(
          "EXECUTION_FAILED",
          "Snapshot has no results — re-open the session",
        );
      }

      const started = Date.now();
      const target = input.target ?? "postman";
      const directory = input.outputDirectory ?? join(snap.projectRoot, "tanit");
      const plan = await planExport(snap, target, directory);

      const frameworks = new Set<string>();
      const warnings = new Set<string>();
      let endpointCount = 0;
      for (const result of snap.results) {
        for (const framework of result.frameworks) frameworks.add(framework);
        for (const warning of result.warnings) warnings.add(warning);
        endpointCount += result.specs.length;
      }

      return {
        endpointCount,
        frameworks: [...frameworks],
        warnings: [...warnings],
        durationMs: Date.now() - started,
        files: plan.files,
        formats: describeFormats().map((format) => ({
          id: format.format,
          summary: format.summary,
        })),
        // The exporters' own diagnostics, with their real codes. The
        // app used to turn a warning string into a diagnostic with a
        // code it made up and a suggestion nobody wrote.
        diagnostics: plan.diagnostics,
      };
    },
  };
}
