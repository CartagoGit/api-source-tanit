/**
 * Uploading a project's collection to Postman.
 *
 * ## Why this lives here and not in the CLI
 *
 * The upload was written inside `packages/cli/commands/push.script.ts`,
 * so only the command line could do it. The app had a screen for it
 * and could never reach it.
 *
 * Now the upload is a service. The CLI and the Application API call
 * it, and the secret handling stays where it was: the key is read
 * from the environment, never from the request, and the Postman
 * response body — which can carry the request, and with it the key —
 * never travels back to the caller.
 */
import {
  buildEnvironments,
  defaultEnvironments,
} from "./environment-builder.service.js";
import {
  PostmanApiError,
  pushCollection,
  pushEnvironment,
  verifyApiKey,
} from "./postman-api.service.js";
import type {
  IPushArtifactsRequest,
  IPushArtifactsResult,
  IPushedArtifact,
  IPushFailure,
} from "../../contracts/interfaces/cli/push-outcome.interface.js";

/**
 * Translates an API failure into something a caller can act on.
 *
 * `PostmanApiError.detail` is the body Postman returned: third-party
 * text that can carry the request that caused it, and with it the
 * `X-Api-Key` header. The detail stays in the trace the human sees.
 * A secret that leaks through an error message cannot be taken back.
 */
export function describePushFailure(error: unknown): IPushFailure {
  if (error instanceof PostmanApiError) {
    return {
      reason: error.message,
      nextAction:
        "Check that the key is still valid and has access to the workspace. " +
        "The full detail goes to the CLI trace; it is not returned here " +
        "because it can include the request, and with it the key.",
    };
  }
  return {
    reason: error instanceof Error ? error.message : String(error),
    nextAction: "Retry; if it persists, run `push` by hand to see the trace.",
  };
}

/**
 * Uploads the collection and, optionally, its environments.
 *
 * @param request The collection, the specs, the configuration, the key
 *   and the workspace — plus, when the caller already signed in, who
 *   that was.
 * @returns What reached Postman, and what did not.
 */
export async function pushProjectArtifacts(
  request: IPushArtifactsRequest,
): Promise<IPushArtifactsResult> {
  const { collection, specs, config, options, withEnvironments } = request;

  let user = request.verifiedUser ?? null;
  if (user === null) {
    try {
      const account = await verifyApiKey(options);
      user = account.username;
    } catch (error) {
      request.onApiError?.(error);
      return { user: null, collection: null, environments: [], error: describePushFailure(error) };
    }
  }

  const environments: IPushedArtifact[] = [];
  let uploaded: IPushedArtifact | null = null;
  try {
    const pushed = await pushCollection(collection, options);
    uploaded = { action: pushed.action, uid: pushed.uid, name: pushed.name };

    if (withEnvironments) {
      const built = buildEnvironments(
        [...specs],
        config.variables,
        [...(config.environments ?? defaultEnvironments(config.baseUrl))],
        collection.info._postman_id ?? "",
      );
      for (const environment of built) {
        const pushedEnvironment = await pushEnvironment(environment, options);
        environments.push({
          action: pushedEnvironment.action,
          uid: pushedEnvironment.uid,
          name: pushedEnvironment.name,
        });
      }
    }
  } catch (error) {
    request.onApiError?.(error);
    return { user, collection: uploaded, environments, error: describePushFailure(error) };
  }

  return { user, collection: uploaded, environments, error: null };
}
