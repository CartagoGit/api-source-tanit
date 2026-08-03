/**
 * Helpers para comparar JSONs de collections Postman ignorando
 * campos volátiles (paths absolutos, IDs generados, timestamps).
 */
import { createHash } from "node:crypto";

const VOLATILE_KEYS = new Set([
  "_postman_id",
  "_postman_revision",
  "_postman_expected_state",
  "_postman_isSubFolder",
]);

/**
 * Recorre un objeto y reemplaza campos volátiles con un placeholder.
 * Devuelve una copia profunda sin mutar el original.
 */
export function normalizeCollection(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(normalizeCollection);
  if (typeof obj === "object") {
    const out: Record<string, any> = {};
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
 * Compara dos collections de manera estructural ignorando volatile.
 * Devuelve una lista de diferencias (paths), vacía si son equivalentes.
 */
export function diffCollections(a: any, b: any, path = "$"): string[] {
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
  if (typeof a === "object" && typeof b === "object") {
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
 * Hash SHA-256 de un objeto (post-normalize).
 * Útil para snapshots "did the output change?".
 */
export function hashNormalized(obj: any): string {
  const normalized = normalizeCollection(obj);
  return createHash("sha256")
    .update(JSON.stringify(normalized, null, 2))
    .digest("hex");
}

/**
 * Cuenta items (requests + folders) en una collection.
 */
export function countItems(items: any[]): { requests: number; folders: number } {
  let requests = 0;
  let folders = 0;
  for (const it of items) {
    if (it.item) {
      folders++;
      const sub = countItems(it.item);
      requests += sub.requests;
      folders += sub.folders;
    } else {
      requests++;
    }
  }
  return { requests, folders };
}

/**
 * Encuentra un endpoint por (method, uri) en la collection.
 */
export function findEndpoint(
  collection: any,
  method: string,
  uri: string,
): any | null {
  const walk = (items: any[]): any | null => {
    for (const it of items) {
      if (it.item) {
        const found = walk(it.item);
        if (found) return found;
      } else if (it.request) {
        const rawUri = it.request.url?.raw ?? "";
        if (it.request.method === method && rawUri.endsWith(uri)) {
          return it;
        }
      }
    }
    return null;
  };
  return walk(collection.item ?? []);
}

/**
 * Comprueba invariantes de Postman v2.1.0.
 */
export function validatePostmanInvariants(collection: any): string[] {
  const issues: string[] = [];
  if (!collection.info) issues.push("missing .info");
  if (!collection.info?.schema?.includes("2.1.0")) {
    issues.push(`.info.schema should be Postman v2.1.0 (got: ${collection.info?.schema})`);
  }
  if (!Array.isArray(collection.item)) issues.push("missing .item array");
  const walk = (items: any[], path: string) => {
    for (const it of items) {
      if (it.item) {
        if (!it.name) issues.push(`${path}: folder missing name`);
        walk(it.item, `${path}/${it.name}`);
      } else {
        if (!it.name) issues.push(`${path}: request missing name`);
        if (!it.request?.method) issues.push(`${path}/${it.name}: missing method`);
        if (!it.request?.url?.raw) issues.push(`${path}/${it.name}: missing url.raw`);
      }
    }
  };
  walk(collection.item ?? [], "$");
  return issues;
}
