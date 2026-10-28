/**
 * `package.json#imports` resolution (proposal `r00020` S1).
 *
 * The `imports` field is the mirror of `exports`: it maps the
 * **internal** aliases of a package to real files, and it is the
 * only way to import something that is not published.
 *
 *   "imports": {
 *     "#internal/db": "./src/db/index.js",
 *     "#internal/*": "./src/*"
 *   }
 *
 * Only keys that start with `#` are imports — everything else in the
 * field is invalid and ignored. A target that starts with `./` is
 * relative to the package directory; any other target is a bare
 * specifier and belongs to another package.
 */
import { isRecord } from "../helpers/parse-json.helper.js";

/**
 * Resolve a `#`-prefixed specifier against the `imports` field.
 *
 * @param importsField The raw `imports` value of the `package.json`.
 * @param specifier    The specifier, `#` included.
 * @param conditions   The active conditions.
 * @returns            The raw target, or `null` when the specifier is
 *                     not mapped.
 */
export function resolvePackageImports(
  importsField: unknown,
  specifier: string,
  conditions: ReadonlyArray<string>,
): string | null {
  if (!isRecord(importsField)) return null;
  if (!specifier.startsWith("#")) return null;

  const direct = importsField[specifier];
  if (direct !== undefined) {
    const target = resolveImportTarget(direct, conditions);
    return target;
  }

  let best: { key: string; capture: string } | null = null;
  let bestScore = -1;
  for (const key of Object.keys(importsField)) {
    if (!key.startsWith("#")) continue;
    const star = key.indexOf("*");
    if (star === -1) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!specifier.startsWith(prefix)) continue;
    if (!specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    const capture = specifier.slice(
      prefix.length,
      specifier.length - suffix.length,
    );
    const score = prefix.length * 1000 + suffix.length;
    if (score > bestScore) {
      bestScore = score;
      best = { key, capture };
    }
  }
  if (best === null) return null;

  const target = resolveImportTarget(importsField[best.key], conditions);
  if (target === null) return null;
  return best.capture.length > 0
    ? target.replaceAll("*", best.capture)
    : target;
}

/**
 * Resolve the value of an `imports` entry.
 *
 * The shapes are the same as the ones of `exports`: a string, a
 * fallback array, or a map of conditions.
 */
function resolveImportTarget(
  value: unknown,
  conditions: ReadonlyArray<string>,
): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = resolveImportTarget(entry, conditions);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key !== "default" && !conditions.includes(key)) continue;
      const resolved = resolveImportTarget(entry, conditions);
      if (resolved !== null) return resolved;
    }
    return null;
  }
  return null;
}
