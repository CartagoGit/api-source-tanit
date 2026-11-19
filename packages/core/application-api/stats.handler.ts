/**
 * `stats.handler.ts` — how many requests, and where.
 *
 * ## What it used to be
 *
 * Nothing. The counts were computed inside the CLI's
 * `stats.script.ts`, so the app's statistics screen could only say
 * "not available yet" — while the CLI could answer the question
 * exactly.
 *
 * ## What it is
 *
 * The same counting, now a service in the core and a handler on top
 * of it. The numbers are the ones the CLI prints, because there is
 * only one function that counts.
 */
import type { IHandler } from "./dispatcher.js";
import {
  StatsInputSchema,
  type StatsInput,
} from "./zod-schemas.js";
import {
  collectionPathOf,
  readProjectCollection,
  requireResults,
  requireSession,
} from "./project-verbs.helper.js";
import { computeCollectionStats } from "../domain/collection-stats.service.js";
import type { StatsOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { StatsOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler que mide la colección. */
export function createStatsHandler(): IHandler<StatsInput, StatsOutput> {
  return {
    name: "stats",
    input: StatsInputSchema,
    async handle(input) {
      const session = requireSession(input.projectRoot);
      const snap = requireResults(session.current());

      const path = collectionPathOf(snap, input.collectionPath);
      const collection = await readProjectCollection(path);

      // The zones belong to the project's configuration, which the
      // snapshot carries: the same one the CLI loads from disk.
      const config = snap.results[0]?.config;
      if (!config) {
        throw new Error("The snapshot carries no project configuration");
      }

      return { stats: computeCollectionStats(collection, config, path) };
    },
  };
}
