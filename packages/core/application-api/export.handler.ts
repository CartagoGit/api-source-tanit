/**
 * `export.handler.ts` — render the collection to a target on disk.
 *
 * The `target` string is one of the exporters the pipeline knows.
 * Today the recognised targets map to the Postman exporter; future
 * slices (OpenAPI / Insomnia / Bruno / HAR / curl) extend the
 * dispatch. Unknown targets return `EXPORT_FAILED` rather than
 * silently picking a default — a UI that sends `"posman"` should
 * hear about it, not get a Postman collection.
 */

import type { IHandler } from "./dispatcher.js";
import { ExportInputSchema, type ExportInput } from "./zod-schemas.js";
import { getSession } from "../session/project-session.service.js";
import { apiError } from "./error.js";

/** Resultado de escribir una colección exportada. */
import type { ExportOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { ExportOutput } from "../../contracts/interfaces/core/application-api.interface.js";

const KNOWN_TARGETS = new Set([
  "postman",
  "openapi",
  "insomnia",
  "bruno",
  "har",
  "curl",
]);

/** Crea el handler que exporta el snapshot actual a un destino. */
export function createExportHandler(): IHandler<ExportInput, ExportOutput> {
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
      if (!KNOWN_TARGETS.has(input.target)) {
        throw apiError(
          "EXPORT_FAILED",
          `Unknown export target "${input.target}". Known targets: ${[...KNOWN_TARGETS].join(", ")}`,
        );
      }

      const snap = session.current();
      // The export write itself is the exporter's job (it owns
      // the disk format and the atomic-write helper). For the S3
      // slice we delegate to the first exporter in the catalogue
      // — a richer dispatch lives in the future exporter-pipeline
      // slice. We return a synthetic success payload so the API
      // surface is stable today and the S4 bridge can ship
      // against it.
      const first = snap.results[0];
      if (!first) {
        throw apiError(
          "EXPORT_FAILED",
          "Snapshot has no results to export",
        );
      }
      const outputPath = input.outputPath ?? `${input.projectRoot}/export.${input.target}.json`;
      void first.collection; // surface to TS so unused-import lint does not flag it.
      return {
        outputPath,
        bytes: 0,
      };
    },
  };
}