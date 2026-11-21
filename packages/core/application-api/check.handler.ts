/**
 * `check.handler.ts` — has the collection drifted from the code?
 *
 * ## What it used to be
 *
 * Nothing. The comparison lived inside the CLI's `diff.script.ts`, so
 * the app's check screen could only say "not available yet" — while
 * the CLI could answer the question exactly.
 *
 * ## What it is
 *
 * The same comparison, now a service in the core and a handler on top
 * of it. The routes come from the open session — the ones the scanner
 * really found — and the collection comes from disk, because **that is
 * what drifted**: the file the user generated last week against the
 * code as it is today.
 *
 * Comparing the snapshot with itself would always answer "in sync",
 * which is not an answer at all.
 */
import type { IHandler } from "./dispatcher.js";
import {
  CheckInputSchema,
  type CheckInput,
} from "./zod-schemas.js";
import {
  collectionPathOf,
  readProjectCollection,
  requireResults,
  requireSession,
} from "./project-verbs.helper.js";
import { compareRoutesWithCollection } from "../domain/drift-check.service.js";
import { postmanMethodFor } from "../domain/postman-method.helper.js";
import type {
  CheckOutput,
  IDriftedEndpoint,
} from "../../contracts/interfaces/core/application-api.interface.js";
export type { CheckOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Crea el handler que compara el código con la colección. */
export function createCheckHandler(): IHandler<CheckInput, CheckOutput> {
  return {
    name: "check",
    input: CheckInputSchema,
    async handle(input) {
      const session = requireSession(input.projectRoot);
      const snap = requireResults(session.current());

      // The routes the scanner found, in the shape the comparison
      // asks for. An SSE route is one physical endpoint with several
      // events, so it counts once.
      const sourceRoutes: IDriftedEndpoint[] = [];
      const seenSse = new Set<string>();
      for (const result of snap.results) {
        for (const route of result.routes) {
          const method = postmanMethodFor(route.method);
          if (route.transport === "sse") {
            const physical = `${method} ${route.uri}`;
            if (seenSse.has(physical)) continue;
            seenSse.add(physical);
          }
          sourceRoutes.push({
            method,
            uri: route.uri,
            ...(route.displayName !== undefined ? { name: route.displayName } : {}),
          });
        }
      }

      const path = collectionPathOf(snap, input.collectionPath);
      const collection = await readProjectCollection(path);

      return { report: compareRoutesWithCollection(sourceRoutes, collection, path) };
    },
  };
}
