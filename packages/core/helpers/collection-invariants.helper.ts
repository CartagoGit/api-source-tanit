/**
 * Invariants a collection must satisfy for Postman to import it and
 * be usable.
 *
 * They used to live only in `tests/helpers/compare-json.ts`, so the
 * project's gate could not check them on a real generated collection.
 * Being here they are used equally by the tests and
 * `scripts/validate.script.ts`.
 *
 * The list distinguishes two levels:
 *   - `error`   — Postman fails to import, or the request cannot be
 *                 sent (missing method, url, schema…).
 *   - `warning` — it imports but the user finds something broken
 *                 (a `{{variable}}` nobody defines, an empty folder,
 *                 two identical requests).
 */
import type { PostmanCollection, PostmanItem } from "../../contracts/interfaces/core/postman.interface.js";
import type { ICollectionIssue } from "../../contracts/interfaces/core/helpers.interface.js";

/** Variables Postman resolves on its own; we do not require them declared. */
const POSTMAN_BUILTIN_VARIABLES = new Set([
  "$guid",
  "$timestamp",
  "$isoTimestamp",
  "$randomInt",
  "$randomUUID",
]);

/**
 * Checks all invariants and returns the violations. Empty list = the
 * collection is correct.
 */
export function checkCollectionInvariants(
  collection: PostmanCollection,
): ICollectionIssue[] {
  const issues: ICollectionIssue[] = [];
  checkInfo(collection, issues);
  checkItems(collection, issues);
  checkDuplicates(collection, issues);
  checkVariables(collection, issues);
  return issues;
}

/** Only the `error`s. Useful to decide the exit code of a gate. */
export function collectionErrors(collection: PostmanCollection): ICollectionIssue[] {
  return checkCollectionInvariants(collection).filter((i) => i.severity === "error");
}

// ---------------------------------------------------------------------------
// Check blocks
// ---------------------------------------------------------------------------

function checkInfo(collection: PostmanCollection, issues: ICollectionIssue[]): void {
  const info = collection.info;
  if (!info) {
    issues.push({ severity: "error", path: "$", message: "missing .info" });
    return;
  }
  if (!info.schema?.includes("2.1.0")) {
    issues.push({
      severity: "error",
      path: "$.info.schema",
      message: `must be Postman v2.1.0 (arrives: ${info.schema ?? "undefined"})`,
    });
  }
  if (!info.name?.trim()) {
    issues.push({ severity: "error", path: "$.info.name", message: "empty" });
  }
  // Without `_postman_id` Postman invents a new one on every import,
  // so re-importing duplicates the collection instead of updating it.
  if (!info._postman_id?.trim()) {
    issues.push({
      severity: "error",
      path: "$.info._postman_id",
      message: "missing: each import would create a new collection",
    });
  }
  if (!Array.isArray(collection.item)) {
    issues.push({ severity: "error", path: "$.item", message: "not an array" });
  } else if (collection.item.length === 0) {
    issues.push({ severity: "warning", path: "$.item", message: "empty collection" });
  }
}

function checkItems(collection: PostmanCollection, issues: ICollectionIssue[]): void {
  const walk = (items: ReadonlyArray<PostmanItem>, path: string): void => {
    for (const item of items) {
      const here = `${path}/${item.name ?? "(unnamed)"}`;
      if (!item.name?.trim()) {
        issues.push({ severity: "error", path: here, message: "item without name" });
      }
      if (item.item) {
        if (item.item.length === 0) {
          issues.push({ severity: "warning", path: here, message: "empty folder" });
        }
        walk(item.item, here);
        continue;
      }
      if (!item.request) {
        issues.push({ severity: "error", path: here, message: "neither folder nor request" });
        continue;
      }
      if (!item.request.method) {
        issues.push({ severity: "error", path: here, message: "request without method" });
      }
      const raw = item.request.url?.raw;
      if (!raw) {
        issues.push({ severity: "error", path: here, message: "request without url.raw" });
      } else if (/\/\/(?!.*:)/.test(raw.replace(/^[a-z]+:\/\//, ""))) {
        issues.push({ severity: "warning", path: here, message: `url with double slash: ${raw}` });
      }
      if (!Array.isArray(item.request.header)) {
        issues.push({ severity: "error", path: here, message: "request without headers array" });
      }
    }
  };
  walk(collection.item ?? [], "$");
}

/**
 * Two requests with the same method and the same URL.
 *
 * In REST that is an oversight: the URL identifies the operation, so
 * two equal ones are the same request sent twice.
 *
 * In **RPC over POST** it is not. GraphQL has a single endpoint —
 * `/graphql` — and what distinguishes one operation from another is the
 * body: a schema with twenty queries produces twenty requests to the
 * same URL, and all twenty are correct. Warning about that would be
 * flagging as suspicious exactly what the protocol requires.
 *
 * Bodies are also compared: if method, URL **and** body match, then it
 * really is the same request repeated.
 */
function checkDuplicates(collection: PostmanCollection, issues: ICollectionIssue[]): void {
  const seen = new Map<string, string>();
  for (const { key: baseKey, path, body } of eachRequest(collection)) {
    const key = body ? `${baseKey} ${body}` : baseKey;
    const previous = seen.get(key);
    if (previous) {
      issues.push({
        severity: "warning",
        path,
        message: `duplica '${key}', ya presente en ${previous}`,
      });
    } else {
      seen.set(key, path);
    }
  }
}

function checkVariables(collection: PostmanCollection, issues: ICollectionIssue[]): void {
  const declared = new Set(
    (collection.variable ?? []).map((v) => v.key).filter((k): k is string => Boolean(k)),
  );
  const undeclared = new Map<string, string>();

  for (const { path, raw } of eachRequest(collection)) {
    for (const m of raw.matchAll(/\{\{([^}]+)\}\}/g)) {
      const name = (m[1] ?? "").trim();
      if (!name || declared.has(name) || POSTMAN_BUILTIN_VARIABLES.has(name)) continue;
      if (!undeclared.has(name)) undeclared.set(name, path);
    }
  }

  for (const [name, path] of undeclared) {
    issues.push({
      severity: "warning",
      path,
      message: `{{${name}}} is not declared in the collection's variables`,
    });
  }
}

// ---------------------------------------------------------------------------
// Walking
// ---------------------------------------------------------------------------

interface IFlatRequest {
  readonly path: string;
  readonly key: string;
  readonly raw: string;
  /**
   * The body, to distinguish two requests to the same URL.
   *
   * `undefined` when there is none: in REST the URL suffices.
   */
  readonly body?: string | undefined;
}

/** Flattens the collection into the list of its requests. */
function* eachRequest(collection: PostmanCollection): Generator<IFlatRequest> {
  function* walk(
    items: ReadonlyArray<PostmanItem>,
    path: string,
  ): Generator<IFlatRequest> {
    for (const item of items) {
      const here = `${path}/${item.name ?? "(unnamed)"}`;
      if (item.item) {
        yield* walk(item.item, here);
        continue;
      }
      if (!item.request?.method) continue;
      const raw = item.request.url?.raw ?? "";
      yield {
        path: here,
        key: `${item.request.method} ${raw}`,
        raw,
        ...(item.request.body?.raw ? { body: item.request.body.raw } : {}),
      };
    }
  }
  yield* walk(collection.item ?? [], "$");
}
