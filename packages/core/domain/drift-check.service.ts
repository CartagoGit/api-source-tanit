/**
 * Drift between the routes in the code and the collection on disk.
 *
 * ## Why this lives here and not in the CLI
 *
 * The comparison was written inside `packages/cli/commands/diff.script.ts`,
 * which made it reachable from exactly one place: the command line.
 * The app had a screen for it — and the screen could only ever say
 * "not available yet", because the thing it needed was in the wrong
 * layer.
 *
 * So the comparison moved to the core, and **both** faces call it:
 * the CLI still prints the report, and the Application API answers it
 * as a handler. Two front doors, one implementation — the CLI and the
 * app cannot disagree about what "in sync" means, because there is
 * only one thing that decides it.
 *
 * ## The question it answers
 *
 * *Are the routes declared in the code the same ones the collection
 * carries?* Not "does the collection look right" — that is the
 * validator's question — and not "does the collection parse" — that is
 * the reader's. This one is about **the two sides disagreeing**.
 */
import { endpointKey, needsNameToDisambiguate } from "../helpers/route-identity.helper.js";
import { walkCollection } from "../helpers/postman.helper.js";
import { normalizeForComparison } from "../helpers/uri.helper.js";
import { postmanMethodFor } from "./postman-method.helper.js";
import type { PostmanCollection } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  ICheckReport,
  IDriftedEndpoint,
} from "../../contracts/interfaces/core/application-api.interface.js";

/**
 * The request the collection adds on its own.
 *
 * The auth probe is not a route in the code: it is a request the
 * exporter adds to prove the collection authenticates. Counting it as
 * drift would make every project report "one extra request, always",
 * and a warning that is always true is a warning nobody reads.
 */
const AUTH_PROBE_URI = "auth-test";

/**
 * A URI, in the shape a person reads.
 *
 * The two sides spell the same route differently: the scanner says
 * `/api/users` and the collection says `api/users`. The report is
 * read by someone fixing a file, so both sides are spelled the same
 * way — with the slash, and with the parameter names the code
 * declared.
 */
function readableUri(uri: string): string {
  return uri.startsWith("/") ? uri : `/${uri}`;
}

/**
 * Compares the routes in the code with the requests in a collection.
 *
 * @param sourceRoutes The routes the scanner found in the code.
 * @param collection The collection to compare against.
 * @param collectionPath Where the collection came from, for the report.
 * @returns The drift, in both directions.
 */
export function compareRoutesWithCollection(
  sourceRoutes: ReadonlyArray<IDriftedEndpoint>,
  collection: PostmanCollection,
  collectionPath: string,
): ICheckReport {
  const withName = needsNameToDisambiguate(
    sourceRoutes.map((route) => ({
      method: route.method,
      uri: route.uri,
      ...(route.name !== undefined ? { name: route.name } : {}),
    })),
  );

  const keyOf = (route: IDriftedEndpoint): string =>
    endpointKey(
      withName
        ? {
            method: route.method,
            uri: route.uri,
            ...(route.name !== undefined ? { name: route.name } : {}),
          }
        : { method: route.method, uri: route.uri },
    );

  const sourceKeys = new Set<string>();
  for (const route of sourceRoutes) {
    sourceKeys.add(keyOf(route));
  }

  const collectionRoutes: ReadonlyArray<IDriftedEndpoint> = walkCollection(collection).map(
    (request) => ({
      method: postmanMethodFor(request.method),
      uri: readableUri(request.uri),
      name: request.name,
    }),
  );

  const collectionKeys = new Set(collectionRoutes.map((route) => keyOf(route)));

  const missingInCollection = sourceRoutes
    .filter((route) => !collectionKeys.has(keyOf(route)))
    .sort(byMethodAndUri);

  const missingInSource = collectionRoutes
    .filter((route) => !sourceKeys.has(keyOf(route)))
    .filter((route) => normalizeForComparison(route.uri) !== AUTH_PROBE_URI)
    .sort(byMethodAndUri);

  return {
    inSync: missingInCollection.length === 0 && missingInSource.length === 0,
    routesInSource: sourceKeys.size,
    requestsInCollection: collectionRoutes.length,
    missingInCollection,
    missingInSource,
    collectionPath,
  };
}

/** Sorts routes so the report reads in a stable order. */
function byMethodAndUri(a: IDriftedEndpoint, b: IDriftedEndpoint): number {
  if (a.method !== b.method) return a.method.localeCompare(b.method);
  return a.uri.localeCompare(b.uri);
}
