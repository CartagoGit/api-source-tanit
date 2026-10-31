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
import { PostmanApiError, verifyApiKey } from "../../core/domain/postman-api.service.js";
import { describePushFailure, pushProjectArtifacts } from "../../core/domain/push-artifacts.service.js";
import { readFlag } from "../../core/helpers/argv.helper.js";
import type {
  IPushFailure,
  IPushOutcome,
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

  /**
   * The key is checked **before** the project is read.
   *
   * A key that does not work should fail while nothing has been
   * scanned and no file has been written: the answer "your key is
   * wrong" is worth more than "here are nine routes, now go get a
   * key". The upload itself happens further down, in the core.
   */
  let usuario: string;
  try {
    const account = await verifyApiKey(options);
    usuario = account.username;
    console.log(`→ Signed in to Postman as ${usuario}`);
  } catch (err) {
    const failure = describePushFailure(err);
    console.error(`✗ ${failure.reason}`);
    // The detail goes to the person who ran the command, and only to
    // them: it can carry the request, and with it the key.
    if (err instanceof PostmanApiError && err.detail) console.error(`  ${err.detail}`);
    return { ...sinSubir(1, failure), user: null, framework: null };
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
      user: null,
      framework: result.match?.framework ?? null,
    };
  }
  console.log(
    `  · ${result.match?.framework ?? "unknown"} · ${requestCount} requests`,
  );

  /**
   * The upload itself lives in the core
   * (`push-artifacts.service.ts`), so the CLI and the Application API
   * upload the same way, with the same redaction of the API error.
   */
  const pushed = await pushProjectArtifacts({
    collection: result.collection,
    specs: result.specs,
    config: result.config,
    options,
    withEnvironments,
    verifiedUser: usuario,
    onApiError: (err) => {
      if (err instanceof PostmanApiError && err.detail) console.error(`  ${err.detail}`);
    },
  });

  if (pushed.error) {
    console.error(`✗ ${pushed.error.reason}`);
    return {
      code: 1,
      user: pushed.user,
      framework: result.match?.framework ?? null,
      requests: requestCount,
      collection: pushed.collection,
      environments: pushed.environments,
      error: pushed.error,
    };
  }

  const uploaded = pushed.collection;
  console.log(
    `✔ Collection ${uploaded?.action ?? "uploaded"}: "${uploaded?.name ?? ""}"` +
      (uploaded?.uid ? ` (${uploaded.uid})` : ""),
  );
  for (const environment of pushed.environments) {
    console.log(`  · Environment ${environment.action}: "${environment.name}"`);
  }

  console.log("\nOpen Postman — the collection is already there.");
  return {
    code: 0,
    user: pushed.user,
    framework: result.match?.framework ?? null,
    requests: requestCount,
    collection: pushed.collection,
    environments: pushed.environments,
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
 *
 * The redaction itself lives in the core
 * (`push-artifacts.service.ts`), so the Application API redacts the
 * same way the CLI does.
 */

if (import.meta.main) {
  process.exit(await main());
}
