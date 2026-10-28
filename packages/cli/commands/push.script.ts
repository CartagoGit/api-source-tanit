#!/usr/bin/env bun
/**
 * `apisrc push` — uploads the collection directly to Postman.
 *
 * Skips the manual Import step: it generates and publishes to the
 * user's workspace via the public Postman API. Since `_postman_id` is
 * deterministic per project, running it twice **updates** the
 * collection instead of duplicating it.
 *
 * The API key is read from `--api-key` or `POSTMAN_API_KEY`, and is
 * never printed or written to disk.
 */
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { generateWithAllFrameworks } from "../../frameworks/index.js";
import { buildEnvironments, defaultEnvironments } from "../../core/domain/environment-builder.service.js";
import { PostmanApiError, pushCollection, pushEnvironment, verifyApiKey } from "../../core/domain/postman-api.service.js";
import { readFlag } from "../../core/helpers/argv.helper.js";
import type {
  IPushFailure,
  IPushOutcome,
  IPushedArtifact,
} from "../../contracts/interfaces/cli/push-outcome.interface.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";

/** What is returned when nothing has been uploaded yet. */
function sinSubir(code: number, error: IPushFailure | null): IPushOutcome {
  return {
    code,
    user: null,
    framework: null,
    requests: 0,
    collection: null,
    environments: [],
    error,
  };
}

/**
 * Uploads the collection and returns **what happened**, printing it
 * along the way.
 *
 * `main` is the wrapper that only returns the exit code, as in
 * `generate`, `check`, and `list`. They are split apart because the
 * plugin tool needs the data: parsing these lines with regular
 * expressions breaks at the first translation — it has already
 * happened, and the `generate` tool returned `ok: true` with
 * `collectionPath: "<not detected>"`.
 */
export async function runPush(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<IPushOutcome> {
  const apiKey = readFlag(argv, "--api-key") ?? process.env["POSTMAN_API_KEY"] ?? "";
  if (!apiKey) {
    console.error("Missing Postman API key.\n");
    console.error("  apisrc push --api-key <key>");
    console.error("  POSTMAN_API_KEY=<key> apisrc push\n");
    console.error("Create one at https://postman.co/settings/me/api-keys");
    return sinSubir(1, {
      reason: "No Postman API key was given.",
      nextAction:
        "Pass `--api-key <key>` or set POSTMAN_API_KEY. Create one at " +
        "https://postman.co/settings/me/api-keys",
    });
  }

  const workspaceId = readFlag(argv, "--workspace") ?? undefined;
  const withEnvironments = !argv.includes("--no-environments");
  const options = { apiKey, workspaceId };

  // `push` **did not read `--project-root`**: it only used the singleton,
  // so passing the flag did nothing. It now resolves like the rest.
  const root = (context ?? resolveProjectContext({ argv })).projectRoot;

  let usuario: string;
  try {
    const user = await verifyApiKey(options);
    usuario = user.username;
    console.log(`→ Signed in to Postman as ${usuario}`);
  } catch (err) {
    return sinSubir(reportApiError(err), falloDeApi(err));
  }

  console.log("→ Scanning the project…");
  const basename = readFlag(argv, "--basename");
  // `--framework <id>` skips detection, same as in `generate`. Without
  // this, anyone who needs to force it could generate the files but
  // not upload them: the same project worked with one command and not
  // the other, for no explainable reason.
  const forceFramework = readFlag(argv, "--framework");
  // `--framework-search-root` is passed as-is to the pipeline. Path
  // validation (no leading `/`, no `..`) lives in
  // `generation.pipeline.ts`; here it is only read.
  const frameworkSearchRoot = readFlag(argv, "--framework-search-root");
  const result = await generateWithAllFrameworks(root, {
    ...(basename ? { collectionName: basename } : {}),
    ...(forceFramework ? { forceFramework } : {}),
    ...(frameworkSearchRoot ? { frameworkSearchRoot } : {}),
  });

  const requestCount = countRequests(result.collection.item as IItem[]);
  if (requestCount === 0) {
    console.error("No endpoints were found, nothing to push.");
    console.error("Run `apisrc generate --inspect` to see what was detected.");
    return {
      ...sinSubir(1, {
        reason: "No endpoints were found, there is nothing to push.",
        nextAction:
          "Run `scan` on the same project to see what discovery finds, " +
          "or force the framework with `--framework <id>`.",
      }),
      user: usuario,
      framework: result.match?.framework ?? null,
    };
  }
  console.log(
    `  · ${result.match?.framework ?? "unknown"} · ${requestCount} requests`,
  );

  const subidos: IPushedArtifact[] = [];
  let coleccionSubida: IPushedArtifact | null = null;
  try {
    const pushed = await pushCollection(result.collection, options);
    coleccionSubida = { action: pushed.action, uid: pushed.uid, name: pushed.name };
    console.log(
      `✔ Collection ${pushed.action}: "${pushed.name}"` +
        (pushed.uid ? ` (${pushed.uid})` : ""),
    );

    if (withEnvironments) {
      const environments = buildEnvironments(
        [...result.specs],
        result.config.variables,
        [...(result.config.environments ?? defaultEnvironments(result.config.baseUrl))],
        result.collection.info._postman_id ?? "",
      );
      for (const environment of environments) {
        const pushedEnv = await pushEnvironment(environment, options);
        subidos.push({
          action: pushedEnv.action,
          uid: pushedEnv.uid,
          name: pushedEnv.name,
        });
        console.log(`  · Environment ${pushedEnv.action}: "${pushedEnv.name}"`);
      }
    }
  } catch (err) {
    return {
      ...sinSubir(reportApiError(err), falloDeApi(err)),
      user: usuario,
      framework: result.match?.framework ?? null,
      requests: requestCount,
      collection: coleccionSubida,
      environments: subidos,
    };
  }

  console.log("\nOpen Postman — the collection is already there.");
  return {
    code: 0,
    user: usuario,
    framework: result.match?.framework ?? null,
    requests: requestCount,
    collection: coleccionSubida,
    environments: subidos,
    error: null,
  };
}

/** The wrapper used by the CLI: only the exit code. */
export async function main(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<number> {
  return (await runPush(argv, context)).code;
}

interface IItem {
  item?: IItem[];
}

function countRequests(items: ReadonlyArray<IItem>): number {
  return items.reduce((total, i) => total + (i.item ? countRequests(i.item) : 1), 0);
}

/**
 * Translates an API failure into something that can be returned to an
 * agent.
 *
 * **This is where it is decided what does NOT go out.** `PostmanApiError.detail`
 * is the body returned by Postman, which is third-party text: it can
 * carry the request that caused it, and with it the `X-Api-Key`
 * header. `push` is the only command that handles a secret and the
 * one an agent will invoke on its own, so whatever it returns ends up
 * in a conversation history or in a host log.
 *
 * That is why `detail` **does not travel**: it stays in the trace the
 * human sees, and the agent receives a reason redacted to fit its
 * output. A secret leaked through an error message cannot be
 * retrieved.
 */
function falloDeApi(err: unknown): IPushFailure {
  if (err instanceof PostmanApiError) {
    return {
      reason: err.message,
      nextAction:
        "Check that the key is still valid and has access to the workspace. " +
        "The full detail goes to the CLI trace; it is not returned here " +
        "because it can include the request, and with it the key." +
        "",
    };
  }
  return {
    reason: err instanceof Error ? err.message : String(err),
    nextAction: "Retry; if it persists, run `push` by hand to see the trace.",
  };
}

function reportApiError(err: unknown): number {
  if (err instanceof PostmanApiError) {
    console.error(`✗ ${err.message}`);
    if (err.detail) console.error(`  ${err.detail}`);
    return 1;
  }
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  return 1;
}

if (import.meta.main) {
  process.exit(await main());
}
