/**
 * `tsconfig` path aliases (proposal `r00020` S1).
 *
 * A TypeScript project redirects imports with two knobs:
 *
 *   - `compilerOptions.baseUrl` — "resolve this bare specifier as if
 *     it were relative to this directory".
 *   - `compilerOptions.paths` — "this pattern means that directory",
 *     the `@/*` aliases everybody uses.
 *
 * Both live in the `tsconfig.json` next to the code, and both are
 * invisible to a resolver that only understands relative paths: an
 * `import { users } from "@/users"` resolves to nothing, and the
 * symbol it names is silently lost.
 *
 * The tsconfig is **JSONC**: it allows comments and trailing commas.
 * A plain `JSON.parse` rejects both, and a tsconfig with a comment
 * is not an unusual thing to find.
 */
import { isRecord, parseJson } from "../helpers/parse-json.helper.js";
import type { ITsconfigPaths } from "../../contracts/interfaces/core/module-resolution.interface.js";

/**
 * Strip the comments and the trailing commas a tsconfig may carry.
 *
 * The strings are preserved: a `"https://example.com"` inside a value
 * is not a comment.
 */
export function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i] ?? "";
    const next = raw[i + 1] ?? "";
    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        out += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next;
        i++;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += char;
  }
  return out;
}

/** Remove the trailing commas that JSONC allows and JSON does not. */
export function stripTrailingCommas(raw: string): string {
  return raw.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Parse a tsconfig into the two knobs the resolver needs.
 *
 * A tsconfig that cannot be parsed yields an empty result — a broken
 * tsconfig must not take the whole scan down.
 *
 * @param raw        The text of the tsconfig.
 * @param tsconfigDir Absolute directory of the tsconfig; `baseUrl`
 *                    is relative to it.
 */
export function parseTsconfigPaths(
  raw: string,
  tsconfigDir: string,
): ITsconfigPaths {
  const parsed = parseJson(stripTrailingCommas(stripJsonComments(raw)));
  if (!parsed.ok || !isRecord(parsed.value)) return { paths: {} };
  const compilerOptions = parsed.value["compilerOptions"];
  if (!isRecord(compilerOptions)) return { paths: {} };

  const rawBaseUrl = compilerOptions["baseUrl"];
  const baseUrl =
    typeof rawBaseUrl === "string" && rawBaseUrl.length > 0
      ? resolveAgainst(rawBaseUrl, tsconfigDir)
      : undefined;

  const rawPaths = compilerOptions["paths"];
  const paths: Record<string, string[]> = {};
  if (isRecord(rawPaths)) {
    for (const [pattern, targets] of Object.entries(rawPaths)) {
      if (!Array.isArray(targets)) continue;
      const list = targets.filter(
        (target): target is string => typeof target === "string",
      );
      if (list.length > 0) paths[pattern] = list;
    }
  }

  return baseUrl === undefined ? { paths } : { baseUrl, paths };
}

/**
 * Resolve a relative path against a directory.
 *
 * The tsconfig is allowed to use forward slashes on every platform,
 * so the join is done with `/` and normalised afterwards.
 */
function resolveAgainst(relative: string, dir: string): string {
  if (relative.startsWith("/")) return relative;
  const base = dir.replace(/[/\\]+$/, "");
  const cleaned = relative.replace(/^\.\//, "");
  if (cleaned === "." || cleaned.length === 0) return base;
  return `${base}/${cleaned}`;
}

/**
 * Match a specifier against a `paths` pattern.
 *
 * Returns the text the `*` captured — `""` for a pattern without a
 * wildcard — or `null` when the pattern does not apply.
 *
 * A pattern may hold at most one `*`, exactly like TypeScript's.
 */
export function matchPathPattern(
  pattern: string,
  specifier: string,
): string | null {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === specifier ? "" : null;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (!specifier.startsWith(prefix)) return null;
  if (!specifier.endsWith(suffix)) return null;
  if (specifier.length < prefix.length + suffix.length) return null;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
}

/**
 * The `paths` entry that wins for a specifier.
 *
 * TypeScript picks the pattern with the longest prefix; when two
 * share it, the longest suffix wins. The result is deterministic, and
 * it is the same rule the compiler applies — a resolver that picked a
 * different alias would resolve to a different file than `tsc` does.
 */
export function matchTsconfigPaths(
  paths: Readonly<Record<string, ReadonlyArray<string>>>,
  specifier: string,
): { readonly pattern: string; readonly capture: string } | null {
  let best: { pattern: string; capture: string } | null = null;
  let bestScore = -1;
  for (const pattern of Object.keys(paths)) {
    const capture = matchPathPattern(pattern, specifier);
    if (capture === null) continue;
    const star = pattern.indexOf("*");
    const prefixLength = star === -1 ? pattern.length : star;
    const suffixLength = pattern.length - prefixLength - (star === -1 ? 0 : 1);
    const score = prefixLength * 1000 + suffixLength;
    if (score > bestScore) {
      bestScore = score;
      best = { pattern, capture };
    }
  }
  return best;
}

/**
 * Expand the targets of a matched `paths` entry.
 *
 * The `*` of the pattern is replaced by the captured text, and a
 * target that starts with `/` is absolute while the rest are
 * relative to the `baseUrl` (or to the tsconfig directory when there
 * is no `baseUrl`).
 */
export function expandPathTargets(
  targets: ReadonlyArray<string>,
  capture: string,
  baseDir: string,
): string[] {
  return targets.map((target) => {
    const expanded = target.replaceAll("*", capture);
    if (expanded.startsWith("/")) return expanded;
    return resolveAgainst(expanded, baseDir);
  });
}
