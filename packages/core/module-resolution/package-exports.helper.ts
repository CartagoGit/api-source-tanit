/**
 * `package.json#exports` resolution (proposal `r00020` S1).
 *
 * The `exports` field is the modern entry point of a package: it
 * says what the package is willing to expose, and under which
 * conditions.
 *
 *   "exports": "./index.js"
 *   "exports": { "import": "./esm.js", "require": "./cjs.js" }
 *   "exports": { ".": "./index.js", "./feature": "./feature.js" }
 *
 * The conditions are not decoration: the same package exposes
 * different files to an ESM importer (`import`), to a CommonJS one
 * (`require`), to Node (`node`) and to a bundler (`browser`). A
 * resolver that ignores them picks the wrong file and the wrong file
 * is the one the code actually runs.
 *
 * The rules implemented here are Node's:
 *
 *   - a string `exports` only serves the root subpath;
 *   - an object whose keys all start with `.` is a **subpath map**;
 *   - an object whose keys are conditions is a **condition map**;
 *   - inside a condition map the **key order decides**, and `default`
 *     always matches;
 *   - an array target is a fallback list: the first entry that
 *     resolves wins.
 */
import { isRecord } from "../helpers/parse-json.helper.js";

/**
 * Split a bare specifier into package name and subpath.
 *
 * `lodash` → `{ packageName: "lodash", subpath: "." }`
 * `lodash/fp` → `{ packageName: "lodash", subpath: "./fp" }`
 * `@nestjs/core` → `{ packageName: "@nestjs/core", subpath: "." }`
 * `@nestjs/core/testing` → `{ packageName: "@nestjs/core", subpath: "./testing" }`
 */
export function splitBareSpecifier(specifier: string): {
  readonly packageName: string;
  readonly subpath: string;
} {
  const segments = specifier.split("/");
  const scoped = specifier.startsWith("@");
  const packageParts = scoped ? segments.slice(0, 2) : segments.slice(0, 1);
  const packageName = packageParts.join("/");
  const rest = segments.slice(packageParts.length).join("/");
  return {
    packageName,
    subpath: rest.length > 0 ? `./${rest}` : ".",
  };
}

/**
 * Resolve a target value against the active conditions.
 *
 * Returns the raw target (it may still contain a `*`), or `null`
 * when nothing matched.
 */
function resolveTarget(
  value: unknown,
  conditions: ReadonlyArray<string>,
): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = resolveTarget(entry, conditions);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key !== "default" && !conditions.includes(key)) continue;
      const resolved = resolveTarget(entry, conditions);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  return null;
}

/** Whether every key of the object is a subpath (starts with a dot). */
function isSubpathMap(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.every((key) => key.startsWith("."));
}

/**
 * Match a subpath against the keys of a subpath map.
 *
 * Exact match first; then the wildcard patterns, longest prefix
 * first, exactly like Node.
 */
function matchSubpath(
  map: Record<string, unknown>,
  subpath: string,
): { readonly key: string; readonly capture: string } | null {
  if (Object.prototype.hasOwnProperty.call(map, subpath)) {
    return { key: subpath, capture: "" };
  }
  let best: { key: string; capture: string } | null = null;
  let bestScore = -1;
  for (const key of Object.keys(map)) {
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix)) continue;
    if (!subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    const capture = subpath.slice(prefix.length, subpath.length - suffix.length);
    const score = prefix.length * 1000 + suffix.length;
    if (score > bestScore) {
      bestScore = score;
      best = { key, capture };
    }
  }
  return best;
}

/**
 * Resolve a subpath against the `exports` field of a package.
 *
 * @param exportsField The raw `exports` value of the `package.json`.
 * @param subpath      `"."` for the package root, `"./feature"` for a
 *                     subpath.
 * @param conditions   The active conditions.
 * @returns            The raw target, or `null` when the subpath is
 *                     not exported.
 */
export function resolvePackageExports(
  exportsField: unknown,
  subpath: string,
  conditions: ReadonlyArray<string>,
): string | null {
  if (exportsField === undefined || exportsField === null) return null;
  if (typeof exportsField === "string") {
    return subpath === "." ? exportsField : null;
  }
  if (Array.isArray(exportsField)) {
    return subpath === "." ? resolveTarget(exportsField, conditions) : null;
  }
  if (!isRecord(exportsField)) return null;

  if (isSubpathMap(exportsField)) {
    const matched = matchSubpath(exportsField, subpath);
    if (matched === null) return null;
    const target = resolveTarget(exportsField[matched.key], conditions);
    if (target === null) return null;
    return matched.capture.length > 0
      ? target.replaceAll("*", matched.capture)
      : target;
  }

  if (subpath !== ".") return null;
  return resolveTarget(exportsField, conditions);
}

/**
 * The entry points a package declares besides `exports`.
 *
 * `main` is the CommonJS entry, `module` the ESM one, `types` (or
 * `typings`) the declaration file. A `.d.ts` is what a TypeScript
 * consumer actually binds to, so it is looked up separately.
 */
export function readPackageEntryPoints(
  manifest: unknown,
): {
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
} {
  if (!isRecord(manifest)) return {};
  const main = manifest["main"];
  const moduleEntry = manifest["module"];
  const types = manifest["types"] ?? manifest["typings"];
  return {
    main: typeof main === "string" && main.length > 0 ? main : undefined,
    module:
      typeof moduleEntry === "string" && moduleEntry.length > 0
        ? moduleEntry
        : undefined,
    types: typeof types === "string" && types.length > 0 ? types : undefined,
  };
}
