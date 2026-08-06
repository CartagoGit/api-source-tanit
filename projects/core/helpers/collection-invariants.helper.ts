/**
 * Invariantes que debe cumplir una colección para que Postman la importe
 * y sea usable.
 *
 * Vivían solo en `tests/helpers/compare-json.ts`, así que el gate del
 * proyecto no podía comprobarlas sobre una colección generada de verdad.
 * Al estar aquí las usan por igual los tests y `scripts/validate.script.ts`.
 *
 * La lista distingue dos niveles:
 *   - `error`   — Postman falla al importar, o la request no se puede
 *                 lanzar (falta el método, la url, el schema…).
 *   - `warning` — se importa pero el usuario se encuentra algo roto
 *                 (una `{{variable}}` que nadie define, una carpeta
 *                 vacía, dos requests idénticas).
 */
import type { PostmanCollection, PostmanItem } from "../contracts/postman.interface.js";

/** Un incumplimiento concreto, con su ruta dentro de la colección. */
export interface ICollectionIssue {
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

/** Variables que Postman resuelve por su cuenta; no exigimos declararlas. */
const POSTMAN_BUILTIN_VARIABLES = new Set([
  "$guid",
  "$timestamp",
  "$isoTimestamp",
  "$randomInt",
  "$randomUUID",
]);

/**
 * Comprueba todas las invariantes y devuelve los incumplimientos.
 * Lista vacía = la colección es correcta.
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

/** Solo los `error`. Útil para decidir el exit code de un gate. */
export function collectionErrors(collection: PostmanCollection): ICollectionIssue[] {
  return checkCollectionInvariants(collection).filter((i) => i.severity === "error");
}

// ---------------------------------------------------------------------------
// Bloques de comprobación
// ---------------------------------------------------------------------------

function checkInfo(collection: PostmanCollection, issues: ICollectionIssue[]): void {
  const info = collection.info;
  if (!info) {
    issues.push({ severity: "error", path: "$", message: "falta .info" });
    return;
  }
  if (!info.schema?.includes("2.1.0")) {
    issues.push({
      severity: "error",
      path: "$.info.schema",
      message: `debe ser Postman v2.1.0 (llega: ${info.schema ?? "undefined"})`,
    });
  }
  if (!info.name?.trim()) {
    issues.push({ severity: "error", path: "$.info.name", message: "vacío" });
  }
  // Sin `_postman_id` Postman inventa uno nuevo en cada import, así que
  // re-importar duplica la colección en lugar de actualizarla.
  if (!info._postman_id?.trim()) {
    issues.push({
      severity: "error",
      path: "$.info._postman_id",
      message: "ausente: cada import crearía una colección nueva",
    });
  }
  if (!Array.isArray(collection.item)) {
    issues.push({ severity: "error", path: "$.item", message: "no es un array" });
  } else if (collection.item.length === 0) {
    issues.push({ severity: "warning", path: "$.item", message: "colección vacía" });
  }
}

function checkItems(collection: PostmanCollection, issues: ICollectionIssue[]): void {
  const walk = (items: ReadonlyArray<PostmanItem>, path: string): void => {
    for (const item of items) {
      const here = `${path}/${item.name ?? "(sin nombre)"}`;
      if (!item.name?.trim()) {
        issues.push({ severity: "error", path: here, message: "item sin nombre" });
      }
      if (item.item) {
        if (item.item.length === 0) {
          issues.push({ severity: "warning", path: here, message: "carpeta vacía" });
        }
        walk(item.item, here);
        continue;
      }
      if (!item.request) {
        issues.push({ severity: "error", path: here, message: "no es carpeta ni request" });
        continue;
      }
      if (!item.request.method) {
        issues.push({ severity: "error", path: here, message: "request sin method" });
      }
      const raw = item.request.url?.raw;
      if (!raw) {
        issues.push({ severity: "error", path: here, message: "request sin url.raw" });
      } else if (/\/\/(?!.*:)/.test(raw.replace(/^[a-z]+:\/\//, ""))) {
        issues.push({ severity: "warning", path: here, message: `url con doble barra: ${raw}` });
      }
      if (!Array.isArray(item.request.header)) {
        issues.push({ severity: "error", path: here, message: "request sin array de headers" });
      }
    }
  };
  walk(collection.item ?? [], "$");
}

function checkDuplicates(collection: PostmanCollection, issues: ICollectionIssue[]): void {
  const seen = new Map<string, string>();
  for (const { key, path } of eachRequest(collection)) {
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
      message: `{{${name}}} no está declarada en las variables de la colección`,
    });
  }
}

// ---------------------------------------------------------------------------
// Recorrido
// ---------------------------------------------------------------------------

interface IFlatRequest {
  readonly path: string;
  readonly key: string;
  readonly raw: string;
}

/** Aplana la colección a la lista de sus requests. */
function* eachRequest(collection: PostmanCollection): Generator<IFlatRequest> {
  function* walk(
    items: ReadonlyArray<PostmanItem>,
    path: string,
  ): Generator<IFlatRequest> {
    for (const item of items) {
      const here = `${path}/${item.name ?? "(sin nombre)"}`;
      if (item.item) {
        yield* walk(item.item, here);
        continue;
      }
      if (!item.request?.method) continue;
      const raw = item.request.url?.raw ?? "";
      yield { path: here, key: `${item.request.method} ${raw}`, raw };
    }
  }
  yield* walk(collection.item ?? [], "$");
}
