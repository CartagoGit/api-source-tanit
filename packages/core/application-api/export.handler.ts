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
import { join } from "node:path";

import type { IHandler } from "./dispatcher.js";
import {
  ExportInputSchema,
  type ExportInput,
} from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { ProjectHistoryService } from "../session/project-history.service.js";
import { writeExport } from "./export-artifacts.helper.js";
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

      // Where the files go, in order of specificity:
      //
      //   1. the directory the caller named;
      //   2. the folder of the file the caller named;
      //   3. the project's own `tanit` folder.
      //
      // The second rule used to be the only one, and the field
      // `outputDirectory` was in the schema but never read — so a
      // caller that said "write them in /tmp/out" got them in the
      // project's folder, and the dry run had answered about
      // /tmp/out.
      const directory =
        input.outputDirectory ??
        (input.outputPath ? dirnameOf(input.outputPath) : join(snap.projectRoot, "tanit"));

      const written = await writeExport(snap, input.target, directory);

      // The export is a point in time, and the history remembers it.
      // Without this the persisted history would only have the
      // revisions the CLI made, and the app would see an empty
      // history for a project it exports every day.
      const record = await history.record(input.projectRoot, snap, {
        formats: [input.target],
        output: directory,
        source: "export",
        configuration: { formats: [input.target], outputDirectory: directory },
      });

      return {
        outputPath: input.outputPath ?? written.outputPath,
        bytes: written.bytes,
        files: written.files,
        historyId: record.id,
      };
    },
  };
}

/** The directory of a path. */
function dirnameOf(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index <= 0 ? path : path.slice(0, index);
}
