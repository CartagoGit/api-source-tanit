/**
 * `export.handler.ts` — write the artifacts, for real.
 *
 * ## What it used to do
 *
 * It answered `{ outputPath, bytes: 0 }`. The path was computed and
 * **nothing was written**: the handler said so in a comment — "we
 * return a synthetic success payload so the API surface is stable
 * today". The surface was stable, and so was the lie: an app that
 * exported through this handler would tell the user it had written a
 * file that did not exist.
 *
 * Now it writes. The artifacts are built from the session's snapshot
 * — the same ones the CLI writes, through the same exporters — and
 * the write is atomic, so a failure never leaves half a file.
 */
import type { IHandler } from "./dispatcher.js";
import {
  ExportInputSchema,
  type ExportInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { ProjectHistoryService } from "../session/project-history.service.js";
import { resolveExportDestination, writeExport } from "./export-artifacts.helper.js";
import { apiError } from "./error.js";

/** Resultado de escribir los artefactos de un formato. */
import type { ExportOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { ExportOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler que escribe los artefactos del formato pedido. */
export function createExportHandler(): IHandler<ExportInput, ExportOutput> {
  const history = new ProjectHistoryService();
  return {
    name: "export",
    input: ExportInputSchema,
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
          "EXPORT_FAILED",
          "Snapshot has no results — re-open the session",
        );
      }

      const destination = resolveExportDestination(snap, input.outputDirectory, input.outputPath);
      const written = await writeExport(
        snap, input.target, input.outputDirectory, input.outputPath,
      );

      // The export is a point in time, and the history remembers it.
      // Without this the persisted history would only have the
      // revisions the CLI made, and the app would see an empty
      // history for a project it exports every day.
      //
      // A history that could not be written does **not** undo the
      // export: the files are on disk, and telling the user that the
      // export failed when it did not would be a worse lie than the
      // revision that is missing. So the failure is reported, and
      // the export stands.
      let historyId: string | undefined;
      let warning: string | undefined;
      try {
        const record = await history.record(input.projectRoot, snap, {
          formats: [input.target],
          output: destination.directory,
          source: "export",
          configuration: {
            formats: [input.target],
            outputDirectory: destination.directory,
            ...(destination.outputPath !== undefined ? { outputPath: destination.outputPath } : {}),
          },
        });
        historyId = record.id;
      } catch (error) {
        warning = `The export was written, but the revision could not be remembered: ${error instanceof Error ? error.message : String(error)}`;
      }

      return {
        outputPath: written.outputPath,
        bytes: written.bytes,
        files: written.files,
        historyId,
        warning,
      };
    },
  };
}
