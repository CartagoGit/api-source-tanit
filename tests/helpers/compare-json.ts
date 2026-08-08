/**
 * Helpers para comparar JSONs de collections Postman ignorando
 * campos volátiles (paths absolutos, IDs generados, timestamps).
 */
import { createHash } from "node:crypto";
import {
  isRecord,
  readArray,
  readObject,
  readString,
} from "../../projects/core/helpers/parse-json.helper";
import type { PostmanItem } from "../../projects/core/contracts/postman.interface";

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
 * Compara dos collections de manera estructural ignorando volatile.
 * Devuelve una lista de diferencias (paths), vacía si son equivalentes.
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
 * Hash SHA-256 de un objeto (post-normalize).
 * Útil para snapshots "did the output change?".
 */
export function hashNormalized(obj: unknown): string {
  const normalized = normalizeCollection(obj);
  return createHash("sha256")
    .update(JSON.stringify(normalized, null, 2))
    .digest("hex");
}

/**
 * Cuenta items (requests + folders) en una collection.
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
 * Encuentra un endpoint por (method, uri) en la collection.
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
  // El predicado comprueba de verdad la forma antes de afirmarla, así
  // que esto no es un casting: es una comprobación con nombre. Devolver
  // `unknown` obligaría a cada uno de los treinta tests que lo usan a
  // volver a estrechar lo mismo.
  return isPostmanItem(encontrado) ? encontrado : null;
}

/**
 * ¿Esto tiene la forma de un item de Postman?
 *
 * Se comprueba, no se afirma: un `as PostmanItem` sobre lo que salga de
 * recorrer un JSON ajeno es exactamente lo que este repo prohíbe.
 */
function isPostmanItem(value: unknown): value is PostmanItem {
  if (!isRecord(value)) return false;
  if (typeof value["name"] !== "string") return false;
  return readObject(value, "request") !== undefined || readArray(value, "item") !== undefined;
}

/**
 * Comprueba invariantes de Postman v2.1.0.
 */
export function validatePostmanInvariants(collection: unknown): string[] {
  const issues: string[] = [];
  const info = readObject(collection, "info");
  if (!info) issues.push("missing .info");
  const schema = readString(info, "schema");
  if (!schema?.includes("2.1.0")) {
    issues.push(`.info.schema should be Postman v2.1.0 (got: ${schema ?? "nada"})`);
  }
  const raiz = readArray(collection, "item");
  if (!raiz) issues.push("missing .item array");

  const walk = (items: readonly unknown[], path: string): void => {
    for (const it of items) {
      const nombre = readString(it, "name");
      const hijos = readArray(it, "item");
      if (hijos) {
        if (!nombre) issues.push(`${path}: folder missing name`);
        walk(hijos, `${path}/${nombre ?? "(sin nombre)"}`);
        continue;
      }
      if (!nombre) issues.push(`${path}: request missing name`);
      const request = readObject(it, "request");
      if (!readString(request, "method")) {
        issues.push(`${path}/${nombre ?? "(sin nombre)"}: missing method`);
      }
      if (!readString(readObject(request, "url"), "raw")) {
        issues.push(`${path}/${nombre ?? "(sin nombre)"}: missing url.raw`);
      }
    }
  };
  walk(raiz ?? [], "$");
  return issues;
}

/**
 * Todos los endpoints que casan con `method + uri`.
 *
 * A diferencia de `findEndpoint`, que devuelve el primero, este los
 * devuelve todos — que es lo que hace falta para **detectar
 * duplicados**: en Symfony el mismo endpoint declarado en YAML y con
 * `#[Route]` salía dos veces, y con el primero no se veía.
 *
 * Estaba copiado en tres ficheros de test, cada uno con sus `any`.
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

/** Las claves `MÉTODO url` de todas las requests, para detectar duplicados. */
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

/** Los nombres de las carpetas de primer nivel. */
export function topFolderNames(collection: unknown): string[] {
  return (readArray(collection, "item") ?? [])
    .map((it) => readString(it, "name"))
    .filter((n): n is string => typeof n === "string");
}

/** Todas las requests de la colección, aplanadas. */
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
