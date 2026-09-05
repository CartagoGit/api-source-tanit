/**
 * Compares the URIs declared in the Postman collection against the
 * actual URIs discovered in the source code. Prints the diff and exits
 * with a non-zero code if there are differences.
 *
 * Framework-agnostic: uses the `DiscoveryOrchestrator` to obtain the
 * right "source". If the orchestrator finds a non-Laravel match
 * (OpenAPI, Express, etc.), it compares against those routes instead
 * of `parseAllRoutes()` (Laravel).
 *
 * Usage:
 *   bun scripts/diff.script.ts
 *   bun run check
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseAllRoutes } from "../../frameworks/laravel/route-parser.service.js";
import { stripApiPrefix } from "../../core/helpers/uri.helper.js";
import {
  endpointKey,
  needsNameToDisambiguate,
} from "../../core/helpers/route-identity.helper.js";
import { walkCollection } from "../../core/helpers/postman.helper.js";
import { outputCollectionPath } from "../../core/discovery/output-paths.helper.js";
import { resolveProjectContext } from "../../core/discovery/project-context.service.js";
import { loadProject } from "../../core/discovery/project-loader.service.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import { defaultOrchestrator } from "../../frameworks/framework.registry.js";
import type { ICheckOutcome, ICheckReport } from "../../contracts/interfaces/cli/command-outcomes.interface.js";

/** Checks for drift and returns the report. `main` is the one that prints it. */
export async function runCheck(
  argv: string[] = process.argv.slice(2),
  context?: IProjectContext,
): Promise<ICheckOutcome> {
  const resolvedContext = context ?? resolveProjectContext({ argv });
  const { config } = await loadProject(argv, resolvedContext);
  const outputIdx = argv.indexOf("--output");
  const outputFlag = outputIdx !== -1 ? argv[outputIdx + 1] ?? null : null;
  const COLLECTION_PATH = outputFlag
    ? outputFlag
    : await outputCollectionPath(resolvedContext, config.name);

  const orch = defaultOrchestrator();
  const root = resolvedContext.projectRoot;
  const { match, scanner } = await orch.detectProject(root);

  /**
   * Exactly one leading slash.
   *
   * URIs arrive from two places —the scanner and the collection— and
   * only one of them already has a slash. Blindly prefixing produced
   * `//graphql` precisely in the list someone reads to fix the drift.
   */
  const withLeadingSlash = (uri: string): string =>
    uri.startsWith("/") ? uri : `/${uri}`;

  const sourceKeys = new Set<string>();
  const sourceMap = new Map<string, { method: string; uri: string; name?: string }>();

  /**
   * The key used to compare a route.
   *
   * Method and URI **are not always enough**. In REST the URL
   * identifies the operation, but in RPC over POST it does not:
   * GraphQL has a single endpoint and what distinguishes one query
   * from another is the name. Without it, a five-operation GraphQL
   * project was counted as **one**, and then `check` could not detect
   * any drift.
   *
   * But always including the name breaks the opposite case, which is
   * what was happening: in REST the scanner does not emit
   * `displayName`, while the collection does carry a request name —
   * "Get Orders", derived from the URI by the constructor. The two
   * keys came out different for the same endpoint, so `GET
   * /api/orders`, without a single parameter, appeared both as
   * "missing" and as "extra".
   *
   * It was measured: **13 of 22 examples** reported total drift on a
   * freshly generated collection.
   *
   * The decision is not per framework: it is a property of the routes
   * that arrive. `needsNameToDisambiguate` checks whether any two
   * share method and URI; if none do, the name is noise and is left
   * out of both sides. It is the same question the pipeline already
   * asked, made once here instead of being assumed.
   */
  const sourceRoutes: Array<{ method: string; uri: string; name?: string }> = [];

  if (match && scanner) {
    // The orchestrator's scanner, the same one used by `generate`.
    //
    // Previously there was a `match.framework !== "laravel"` branch that
    // sent Laravel down the legacy path, and that one found 7 routes
    // where the pipeline found 17: `check` did not compare the
    // collection against what `generate` sees, but against another
    // heuristic. That is the same divergence `summary` once had, and
    // `check` cannot have an exception for one of the twenty-one
    // frameworks.
    for (const r of (await scanner.scan(match)).routes) {
      sourceRoutes.push({
        method: r.method,
        uri: r.uri,
        ...(r.displayName ? { name: r.displayName } : {}),
      });
    }
    console.log(`(source: ${match.framework} via orchestrator)`);
  } else {
    // With no scanner recognizing the project, the Laravel heuristic
    // remains, which is the only thing that existed before the
    // scanners did.
    for (const r of await parseAllRoutes(config.filePrefixes, resolvedContext)) {
      sourceRoutes.push({ method: r.method, uri: stripApiPrefix(r.uri) });
    }
    console.log("(source: legacy heuristic — no scanner matched)");
  }

  if (!existsSync(COLLECTION_PATH)) {
    console.error(
      `✘ Collection not found at "${COLLECTION_PATH}". Run \`generate\` first.`,
    );
    return { code: 1, report: null };
  }

  const raw = await readFile(COLLECTION_PATH, "utf8");
  const collection = JSON.parse(raw) as PostmanCollection;
  const collRequests = [...walkCollection(collection)].map((r) => ({
    method: r.method,
    uri: r.uri,
    name: r.name,
  }));

  /**
   * Is the name needed to disambiguate?
   *
   * It is asked **only of the source**, and that asymmetry is
   * deliberate. The source is the code: if two routes share method
   * and URI there, the protocol is RPC over POST and the name is the
   * only thing separating them — GraphQL, tRPC.
   *
   * The collection cannot decide this because it has **variants**:
   * the enricher emits the same endpoint twice with different bodies
   * ("base" and "Minimum (required only)"), and that is not two
   * operations, it is one operation with two examples. Asking it
   * returned `true` for Laravel and put the name into the key on both
   * sides; since the REST source does not emit a name, the 17
   * endpoints came out as "missing" and the 18 as "extra".
   */
  const conNombre = needsNameToDisambiguate(sourceRoutes);

  const clave = (r: { method: string; uri: string; name?: string }): string =>
    endpointKey(conNombre ? r : { method: r.method, uri: r.uri });

  for (const r of sourceRoutes) {
    const key = clave(r);
    sourceKeys.add(key);
    sourceMap.set(key, r);
  }

  const collKeys = new Set<string>();
  const collMap = new Map<string, { method: string; uri: string; name?: string }>();
  for (const r of collRequests) {
    const key = clave(r);
    collKeys.add(key);
    collMap.set(key, r);
  }

  const onlyInSource = [...sourceKeys]
    .filter((k) => !collKeys.has(k) && !k.endsWith("GET auth-test"))
    .sort();
  const onlyInColl = [...collKeys].filter((k) => !sourceKeys.has(k)).sort();

  console.log(`Routes en source:        ${sourceKeys.size}`);
  console.log(`Requests in collection:  ${collKeys.size}`);
  console.log();

  const informe: ICheckReport = {
    inSync: onlyInSource.length === 0 && onlyInColl.length === 0,
    routesInSource: sourceKeys.size,
    requestsInCollection: collKeys.size,
    missingInCollection: onlyInSource.map((k) => sourceMap.get(k)!),
    missingInSource: onlyInColl.map((k) => collMap.get(k)!),
  };

  if (informe.inSync) {
    console.log("✔ Collection is in sync with the source code.");
    return { code: 0, report: informe };
  }

  if (onlyInSource.length > 0) {
    console.log(`✘ Missing from the collection (${onlyInSource.length}):`);
    for (const k of onlyInSource) {
      const ep = sourceMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} ${withLeadingSlash(ep.uri)}${ep.name ? `  (${ep.name})` : ""}`);
    }
    console.log();
  }
  if (onlyInColl.length > 0) {
    console.log(`✘ Not in the source code (${onlyInColl.length}):`);
    for (const k of onlyInColl) {
      const ep = collMap.get(k)!;
      console.log(`    ${ep.method.padEnd(6)} ${withLeadingSlash(ep.uri)}${ep.name ? `  (${ep.name})` : ""}`);
    }
  }
  return { code: 1, report: informe };
}

/** The wrapper used by the CLI: only the exit code. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  return (await runCheck(argv)).code;
}

if (import.meta.main) {
  process.exit(await main());
}
