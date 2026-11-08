/**
 * `history-persisted.handlers.ts` — the past of a project.
 *
 * ## What they answer
 *
 * The revisions the project has been through: when each one was made,
 * what it held, how it was configured — and, from there, what changed
 * between two of them, how they were built, how to export one again
 * and how to put one back.
 *
 * ## What they used to be
 *
 * Five calls the app made that the Application API did not have. The
 * app asked for them as **pending**: the request went out with a
 * name the dispatcher did not know, and the answer was
 * `UNKNOWN_HANDLER`. The screens that would have drawn the answer
 * were not mounted, and the section said so in a sentence instead of
 * showing a table that would have been full.
 *
 * The reason they did not exist was not that the comparison was hard.
 * It was that **there was no history to compare**: the diff was
 * written and tested against a shape nobody produced, and the
 * recorder that should have produced it kept its records in memory,
 * in a process that ended when the command did.
 *
 * Now the history is on disk (`project-history.service.ts`) and these
 * are the five ways to ask it questions.
 */
import { join } from "node:path";

import type { IHandler } from "./dispatcher.js";
import {
  HistoryCompareConfigInputSchema,
  type HistoryCompareConfigInput,
  HistoryDiffInputSchema,
  type HistoryDiffInput,
  HistoryListInputSchema,
  type HistoryListInput,
  HistoryReExportInputSchema,
  type HistoryReExportInput,
  HistoryRestoreInputSchema,
  type HistoryRestoreInput,
} from "./zod-schemas.js";
import { writeExport } from "./export-artifacts.helper.js";
import { collectionPathOf } from "./project-verbs.helper.js";
import { writeJsonAtomic } from "../helpers/atomic-write.helper.js";
import { ProjectHistoryService } from "../session/project-history.service.js";
import { apiError } from "./error.js";
import type {
  HistoryCompareConfigOutput,
  HistoryDiffOutput,
  HistoryListOutput,
  HistoryReExportOutput,
  HistoryRestoreOutput,
} from "../../contracts/interfaces/core/application-api.interface.js";
export type {
  HistoryCompareConfigOutput,
  HistoryDiffOutput,
  HistoryListOutput,
  HistoryReExportOutput,
  HistoryRestoreOutput,
} from "../../contracts/interfaces/core/application-api.interface.js";

/** The format a re-export writes when nobody names one. */
const DEFAULT_FORMAT = "postman";

/** How many revisions a list answers with when nobody says. */
const DEFAULT_LIMIT = 50;

/**
 * The history, shared by the five handlers.
 *
 * One store for the process: it holds no state of its own (the
 * records are on disk), so two handlers always see the same history.
 */
const history = new ProjectHistoryService();

/**
 * The record, or the reason there is not one.
 *
 * A missing revision is not an empty revision: the answer would be a
 * diff with nothing in it, and a person would read that as "nothing
 * changed".
 */
async function requireRecord(
  projectRoot: string,
  id: string,
): Promise<NonNullable<Awaited<ReturnType<ProjectHistoryService["get"]>>>> {
  const record = await history.get(projectRoot, id);
  if (record === undefined) {
    throw apiError(
      "OPERATION_NOT_FOUND",
      `No history revision "${id}" for projectRoot "${projectRoot}"`,
    );
  }
  return record;
}

/** Crea los handlers del historial persistido. */
export function createPersistedHistoryHandlers(): {
  list: IHandler<HistoryListInput, HistoryListOutput>;
  diff: IHandler<HistoryDiffInput, HistoryDiffOutput>;
  compareConfig: IHandler<HistoryCompareConfigInput, HistoryCompareConfigOutput>;
  reExport: IHandler<HistoryReExportInput, HistoryReExportOutput>;
  restore: IHandler<HistoryRestoreInput, HistoryRestoreOutput>;
} {
  return {
    list: {
      name: "history-list",
      input: HistoryListInputSchema,
      async handle(input) {
        const entries = await history.summaries(input.projectRoot);
        const limit = input.limit ?? DEFAULT_LIMIT;
        return { entries: entries.slice(0, limit), total: entries.length };
      },
    },
    diff: {
      name: "history-diff",
      input: HistoryDiffInputSchema,
      async handle(input) {
        await requireRecord(input.projectRoot, input.leftId);
        await requireRecord(input.projectRoot, input.rightId);
        return history.compare(input.projectRoot, input.leftId, input.rightId);
      },
    },
    compareConfig: {
      name: "history-compare-config",
      input: HistoryCompareConfigInputSchema,
      async handle(input) {
        await requireRecord(input.projectRoot, input.leftId);
        await requireRecord(input.projectRoot, input.rightId);
        return history.compareConfiguration(input.projectRoot, input.leftId, input.rightId);
      },
    },
    reExport: {
      name: "history-re-export",
      input: HistoryReExportInputSchema,
      async handle(input) {
        await requireRecord(input.projectRoot, input.historyId);
        const snapshot = await history.snapshotOf(input.projectRoot, input.historyId);
        if (snapshot === undefined) {
          throw apiError(
            "OPERATION_NOT_FOUND",
            `History revision "${input.historyId}" has no snapshot to export`,
          );
        }
        const target = input.target ?? DEFAULT_FORMAT;
        const directory = input.outputDirectory ?? join(snapshot.projectRoot, "tanit");
        const written = await writeExport(snapshot, target, directory);
        return {
          outputPath: written.outputPath,
          bytes: written.bytes,
          files: written.files,
        };
      },
    },
    restore: {
      name: "history-restore",
      input: HistoryRestoreInputSchema,
      async handle(input) {
        const record = await requireRecord(input.projectRoot, input.historyId);
        const snapshot = await history.snapshotOf(input.projectRoot, input.historyId);
        if (snapshot === undefined || snapshot.results.length === 0) {
          throw apiError(
            "OPERATION_NOT_FOUND",
            `History revision "${input.historyId}" has no snapshot to restore`,
          );
        }
        const collection = snapshot.results[0]?.collection;
        if (collection === undefined) {
          throw apiError(
            "OPERATION_NOT_FOUND",
            `History revision "${input.historyId}" holds no collection`,
          );
        }
        // Where the collection goes: what the caller named, or the
        // place the project would write it. The same rule the export
        // uses, so a restored collection and an exported one live in
        // the same folder and the reader finds both.
        const path = collectionPathOf(snapshot, input.collectionPath);
        await writeJsonAtomic(path, collection);
        return { restored: true, historyId: record.id, outputPath: path };
      },
    },
  };
}
