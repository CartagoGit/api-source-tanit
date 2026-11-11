/**
 * `push.handler.ts` — upload the collection to Postman.
 *
 * ## What it used to be
 *
 * Nothing. The upload lived inside the CLI's `push.script.ts`, so the
 * app's push screen could only say "not available yet" — while the
 * CLI could do it exactly.
 *
 * ## What it is
 *
 * The same upload, now a service in the core and a handler on top of
 * it.
 *
 * ## Where the secret comes from
 *
 * From the environment, or from the request when the caller is the
 * app. The CLI reads `POSTMAN_API_KEY`; the app has its key in its
 * own secure storage, and the sidecar's environment is not something
 * a user can set from a window.
 *
 * What does **not** happen either way: the key comes back. The
 * answer says what happened, not what was used — and the Postman
 * response body, which can carry the request and with it the key,
 * never travels back to the caller.
 *
 * A dry run verifies the key and counts what would go up, and
 * uploads nothing.
 */
import type { IHandler } from "./dispatcher.js";
import {
  PushInputSchema,
  type PushInput,
} from "./zod-schemas.js";
import {
  requireResults,
  requireSession,
} from "./project-verbs.helper.js";
import {
  describePushFailure,
  pushProjectArtifacts,
} from "../domain/push-artifacts.service.js";
import { verifyApiKey } from "../domain/postman-api.service.js";
import type { PostmanItem } from "../../contracts/interfaces/core/postman.interface.js";
import type { PushOutput } from "../../contracts/interfaces/core/application-api.interface.js";
export type { PushOutput } from "../../contracts/interfaces/core/application-api.interface.js";

/** Where the key comes from. The same variable the CLI reads. */
const API_KEY_ENV = "POSTMAN_API_KEY";

/** Counts the requests a collection carries. */
function countRequests(items: ReadonlyArray<PostmanItem>): number {
  return items.reduce(
    (total, item) => total + (item.item ? countRequests(item.item) : 1),
    0,
  );
}

/** Crea el handler que sube la colección a Postman. */
export function createPushHandler(): IHandler<PushInput, PushOutput> {
  return {
    name: "push",
    input: PushInputSchema,
    async handle(input) {
      const session = requireSession(input.projectRoot);
      const snap = requireResults(session.current());

      const apiKey = input.apiKey ?? process.env[API_KEY_ENV] ?? "";
      if (!apiKey) {
        return {
          user: null,
          framework: snap.results[0]?.match?.framework ?? null,
          requests: 0,
          collection: null,
          environments: [],
          error: {
            reason: "No Postman API key was found.",
            nextAction:
              `Set the ${API_KEY_ENV} environment variable before pushing. ` +
              "Create one at https://postman.co/settings/me/api-keys",
          },
          dryRun: input.dryRun === true,
        };
      }

      const options = {
        apiKey,
        ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
      };

      const result = snap.results[0];
      if (!result) {
        throw new Error("The snapshot carries no generation result");
      }

      const requests = countRequests(result.collection.item ?? []);

      if (input.dryRun === true) {
        // A dry run checks that the key works and says how much would
        // go up. It uploads nothing.
        try {
          const account = await verifyApiKey(options);
          return {
            user: account.username,
            framework: result.match?.framework ?? null,
            requests,
            collection: null,
            environments: [],
            error: null,
            dryRun: true,
          };
        } catch (error) {
          return {
            user: null,
            framework: result.match?.framework ?? null,
            requests,
            collection: null,
            environments: [],
            error: describePushFailure(error),
            dryRun: true,
          };
        }
      }

      const pushed = await pushProjectArtifacts({
        collection: result.collection,
        specs: result.specs,
        config: result.config,
        options,
        withEnvironments: input.withEnvironments !== false,
      });

      return {
        user: pushed.user,
        framework: result.match?.framework ?? null,
        requests,
        collection: pushed.collection,
        environments: pushed.environments,
        error: pushed.error,
        dryRun: false,
      };
    },
  };
}
