/**
 * Helpers to compare Postman collection JSONs ignoring volatile
 * fields (absolute paths, generated IDs, timestamps).
 */
import { createHash } from "node:crypto";
import { isRecord, readArray, readObject, readString } from "../../packages/core/helpers/parse-json.helper";
import type { PostmanItem } from "../../packages/contracts/interfaces/core/postman.interface";

const VOLATILE_KEYS = new Set([
  "_postman_id",
  "_postman_revision",
  "_postman_expected_state",
  "_postman_isSubFolder",
]);

/**
 * Walks an object and replaces volatile fields with a placeholder.
 * Returns a deep copy without mutating the original.
 */
export function normalizeCollection(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(normalizeCollection);
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (VOLATILE_KEYS.has(k)) {
        out[k] = "<NORMALIZED>";
      } else {
        out[k] = normalizeCollection(v);
      }
    }
    return out;
  }
  return obj;
}

/**
 * Compares two collections structurally ignoring volatile.
 * Returns a list of differences (paths), empty if they are
 * equivalent.
 */
export function diffCollections(a: unknown, b: unknown, path = "$"): string[] {
  const diffs: string[] = [];
  if (a === b) return diffs;
  if (typeof a !== typeof b) {
    diffs.push(`${path}: type diff (${typeof a} vs ${typeof b})`);
    return diffs;
  }
  if (a === null || b === null) {
    if (a !== b) diffs.push(`${path}: null vs ${b}`);
    return diffs;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path}: array length ${a.length} vs ${b.length}`);
    }
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      diffs.push(...diffCollections(a[i], b[i], `${path}[${i}]`));
    }
    return diffs;
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = new Set(Object.keys(a));
    const keysB = new Set(Object.keys(b));
    for (const k of keysA) {
      if (!keysB.has(k)) {
        diffs.push(`${path}.${k}: missing in B`);
      } else {
        diffs.push(...diffCollections(a[k], b[k], `${path}.${k}`));
      }
    }
    for (const k of keysB) {
      if (!keysA.has(k)) {
        diffs.push(`${path}.${k}: extra in B`);
      }
    }
    return diffs;
  }
  if (a !== b) {
    diffs.push(`${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  return diffs;
}

/**
 * SHA-256 hash of an object (post-normalize).
 * Useful for "did the output change?" snapshots.
 */
export function hashNormalized(obj: unknown): string {
  const normalized = normalizeCollection(obj);
  return createHash("sha256")
    .update(JSON.stringify(normalized, null, 2))
    .digest("hex");
}

/**
 * Counts items (requests + folders) in a collection.
 */
export function countItems(items: readonly unknown[]): { requests: number; folders: number } {
  let requests = 0;
  let folders = 0;
  for (const it of items) {
    const hijos = readArray(it, "item");
    if (hijos) {
      folders++;
      const sub = countItems(hijos);
      requests += sub.requests;
      folders += sub.folders;
    } else {
      requests++;
    }
  }
  return { requests, folders };
}

/**
 * Finds an endpoint by (method, uri) in the collection.
 */
export function findEndpoint(
  collection: unknown,
  method: string,
  uri: string,
): PostmanItem | null {
  const walk = (items: readonly unknown[]): unknown => {
    for (const it of items) {
      const hijos = readArray(it, "item");
      if (hijos) {
        const found = walk(hijos);
        if (found) return found;
        continue;
      }
      const request = readObject(it, "request");
      if (!request) continue;
      const rawUri = readString(readObject(request, "url"), "raw") ?? "";
      if (readString(request, "method") === method && rawUri.endsWith(uri)) return it;
    }
    return null;
  };
  const encontrado = walk(readArray(collection, "item") ?? []);
  // The predicate really checks the shape before asserting it, so
  // this is not a cast: it is a check with a label. Returning
  // `unknown` would force each of the thirty tests that use this
  // to narrow the same thing again.
  return isPostmanItem(encontrado) ? encontrado : null;
}

/**
 * Does this have the shape of a Postman item?
 *
 * We check, we do not assert: an `as PostmanItem` over whatever
 * comes out of walking a foreign JSON is exactly what this repo
 * forbids.
 */
function isPostmanItem(value: unknown): value is PostmanItem {
  if (!isRecord(value)) return false;
  if (typeof value["name"] !== "string") return false;
  return readObject(value, "request") !== undefined || readArray(value, "item") !== undefined;
}

/**
 * Checks Postman v2.1.0 invariants.
 */
export function validatePostmanInvariants(collection: unknown): string[] {
  const issues: string[] = [];
  const info = readObject(collection, "info");
  if (!info) issues.push("missing .info");
  const schema = readString(info, "schema");
  if (!schema?.includes("2.1.0")) {
    issues.push(`.info.schema should be Postman v2.1.0 (got: ${schema ?? "nothing"})`);
  }
  const raiz = readArray(collection, "item");
  if (!raiz) issues.push("missing .item array");

  const walk = (items: readonly unknown[], path: string): void => {
    for (const it of items) {
      const nombre = readString(it, "name");
      const hijos = readArray(it, "item");
      if (hijos) {
        if (!nombre) issues.push(`${path}: folder missing name`);
        walk(hijos, `${path}/${nombre ?? "(unnamed)"}`);
        continue;
      }
      if (!nombre) issues.push(`${path}: request missing name`);
      const request = readObject(it, "request");
      if (!readString(request, "method")) {
        issues.push(`${path}/${nombre ?? "(unnamed)"}: missing method`);
      }
      if (!readString(readObject(request, "url"), "raw")) {
        issues.push(`${path}/${nombre ?? "(unnamed)"}: missing url.raw`);
      }
    }
  };
  walk(raiz ?? [], "$");
  return issues;
}

/**
 * All endpoints matching `method + uri`.
 *
 * Unlike `findEndpoint`, which returns the first, this one returns
 * all of them — which is what is needed to **detect duplicates**:
 * in Symfony the same endpoint declared in YAML and with
 * `#[Route]` came out twice, and with the first one it was not
 * visible.
 *
 * It was copied across three test files, each with its own `any`.
 */
export function findAllEndpoints(
  collection: unknown,
  method: string,
  uri: string,
): PostmanItem[] {
  const out: PostmanItem[] = [];
  const walk = (items: readonly unknown[]): void => {
    for (const it of items) {
      const hijos = readArray(it, "item");
      if (hijos) {
        walk(hijos);
        continue;
      }
      const request = readObject(it, "request");
      if (!request) continue;
      const rawUri = readString(readObject(request, "url"), "raw") ?? "";
      if (readString(request, "method") === method && rawUri.endsWith(uri)) {
        if (isPostmanItem(it)) out.push(it);
      }
    }
  };
  walk(readArray(collection, "item") ?? []);
  return out;
}

/** The `METHOD url` keys of every request, to detect duplicates. */
export function collectRequestKeys(collection: unknown): string[] {
  const out: string[] = [];
  const walk = (items: readonly unknown[]): void => {
    for (const it of items) {
      const hijos = readArray(it, "item");
      if (hijos) {
        walk(hijos);
        continue;
      }
      const request = readObject(it, "request");
      if (!request) continue;
      const raw = readString(readObject(request, "url"), "raw") ?? "";
      out.push(`${readString(request, "method") ?? ""} ${raw}`);
    }
  };
  walk(readArray(collection, "item") ?? []);
  return out;
}

/** The names of the first-level folders. */
export function topFolderNames(collection: unknown): string[] {
  return (readArray(collection, "item") ?? [])
    .map((it) => readString(it, "name"))
    .filter((n): n is string => typeof n === "string");
}

/** All requests in the collection, flattened. */
export function allRequests(collection: unknown): PostmanItem[] {
  const out: PostmanItem[] = [];
  const walk = (items: readonly unknown[]): void => {
    for (const it of items) {
      const hijos = readArray(it, "item");
      if (hijos) {
        walk(hijos);
        continue;
      }
      if (readObject(it, "request") && isPostmanItem(it)) out.push(it);
    }
  };
  walk(readArray(collection, "item") ?? []);
  return out;
}
