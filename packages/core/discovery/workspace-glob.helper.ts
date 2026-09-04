/**
 * Workspace glob resolver — a00012 S1.a.
 *
 * A **pure** helper (no instance state, no `process.cwd()`) that takes the
 * globs produced by the `package.json`, `turbo.json`, `lerna.json`, or
 * `pnpm-workspace.yaml` parsers and resolves them to actual directories under
 * `projectRoot`.
 *
 * ## Why it is needed
 *
 * The previous version (`resolveWorkspaceDirs`, inside
 * `monorepo-detector.helper.ts`) split the glob at the first `*` and returned
 * only the prefix: `apps/*` → `apps`, not `apps/api` or `apps/web`. The
 * orchestrator therefore received the container and had to enumerate its
 * children again, losing precision when the wildcard prefix had many
 * children and `frameworkSearchRoot` could not be inferred reliably.
 *
 * ## Behavior
 *
 * - **No metacharacters** (`*`, `?`, `**`, `{...}`): treat the value as a
 *   literal. Call `statSync` and return the POSIX-relative path if it exists
 *   within `projectRoot`.
 * - **With `*` or `?` but no `**`**: enumerate the direct descendants of
 *   the prefix (`apps/*` → children of `apps`) and filter with a regex that
 *   converts `*` → `[^/]*`, `?` → `[^/]`, and `**` → `.*`. Directories only.
 * - **With `**`**: recursively enumerate descendants of the prefix.
 * - **Exclusions (`!apps/test`)**: remove these from the final result. If
 *   an inclusion and an exclusion match the same path, the exclusion wins.
 *   Exclusions use the same resolution path as inclusions and may also be
 *   globs.
 * - **Normalization**: reject absolute, empty, and escaping values outside
 *   `projectRoot` before touching the file system. Results are always
 *   POSIX-relative, without `./`, absolute components, or `..`.
 * - **Determinism**: sort paths lexicographically and deduplicate them. Two
 *   identical invocations produce the same output in the same order.
 * - **Quiet I/O**: silently ignore a prefix that is not a directory (it does
 *   not exist, is a file, or permissions are missing) and continue.
 *
 * ## No external dependencies
 *
 * The project needs no npm package for this resolver; `@types/node` is not
 * in `dependencies`, and `bun-types` provides no POSIX matchers. Traversal
 * uses synchronous `node:fs` I/O (boot-time, once per scan, not a hot path),
 * and matching uses a hand-built ASCII regex.
 */
import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

/**
 * Materializes a list of workspace globs into real directories.
 *
 * @param projectRoot Absolute project root (callers have already converted
 *   it to an absolute path outside this helper).
 * @param globs Relative POSIX globs, optionally prefixed with `!` to mark
 *   exclusions.
 * @returns Existing directories under `projectRoot` in POSIX-relative form,
 *   sorted lexicographically and deduplicated. An invalid root path returns
 *   `[]`.
 */
export async function resolveWorkspaceGlobs(
  projectRoot: string,
  globs: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  if (!projectRoot || !isAbsolute(projectRoot)) return [];

  const included = new Set<string>();
  const excluded = new Set<string>();

  for (const raw of globs) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;

    const isExclusion = trimmed.startsWith("!");
    const stripped = isExclusion ? trimmed.slice(1).trim() : trimmed;
    if (stripped.length === 0) continue;

    // Always normalize: the parser already normalizes, but this helper also
    // rejects absolute paths and escapes as part of its public contract.
    const normalized = normalizePosixRelative(stripped);
    if (!normalized) continue;

    const resolved = resolveSingleGlob(projectRoot, normalized);
    const bucket = isExclusion ? excluded : included;
    for (const dir of resolved) bucket.add(dir);
  }

  const merged: string[] = [];
  for (const dir of included) {
    if (!excluded.has(dir)) merged.push(dir);
  }
  merged.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return merged;
}

/**
 * Resolves one already-normalized glob to its real directories. This is the
 * branch between literals and patterns.
 */
function resolveSingleGlob(
  projectRoot: string,
  glob: string,
): ReadonlyArray<string> {
  if (!hasMeta(glob)) return resolveLiteral(projectRoot, glob);
  return resolvePattern(projectRoot, glob);
}

/** Literal: `existsSync` and POSIX-relative. */
function resolveLiteral(
  projectRoot: string,
  relPath: string,
): ReadonlyArray<string> {
  const absolute = join(projectRoot, relPath);
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  const rel = toPosixRelative(projectRoot, absolute);
  if (!isInsideProjectRoot(rel)) return [];
  return [rel];
}

/**
 * Pattern: enumerate the prefix and filter with a regex.
 *
 * The "prefix" is everything before the first metacharacter
 * (`*`, `?`, `{`). If the prefix does not exist or is not a directory,
 * return `[]` without an error. `**` controls depth: when present, enumerate
 * all descendants; otherwise enumerate only direct children.
 */
function resolvePattern(
  projectRoot: string,
  glob: string,
): ReadonlyArray<string> {
  const prefix = globPrefix(glob);
  const absolutePrefix = join(projectRoot, prefix);

  let stat;
  try {
    stat = statSync(absolutePrefix);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  const recursive = glob.indexOf("**") !== -1;
  const candidates = recursive
    ? enumerateRecursive(absolutePrefix)
    : enumerateOneLevel(absolutePrefix);

  const regex = globToRegExp(glob);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const rel = toPosixRelative(projectRoot, candidate);
    if (!isInsideProjectRoot(rel)) continue;
    if (!regex.test(rel)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push(rel);
  }
  return out;
}

/** Glob prefix (everything before the first metacharacter). */
function globPrefix(glob: string): string {
  const match = /^([^*?{]*)/.exec(glob);
  const prefix = match?.[1] ?? "";
  // Remove a trailing `/` so `join` does not introduce an empty separator
  // when the prefix is exactly the parent directory.
  return prefix.replace(/\/$/, "");
}

/** Does this glob have metacharacters that require expansion? */
function hasMeta(glob: string): boolean {
  return /[*?{]/.test(glob);
}

/** Hijos directos del directorio que sean directorios. */
function enumerateOneLevel(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) out.push(join(dir, entry.name));
  }
  return out;
}

/** Descendientes recursivos del directorio (excluye el propio directorio). */
function enumerateRecursive(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      out.push(join(current, entry.name));
      stack.push(join(current, entry.name));
    }
  }
  return out;
}

/**
 * Converts a POSIX-relative glob into an anchored regex.
 *
 * Rules (all ASCII):
 *  - `**` → `.*` (also matches `/`)
 *  - `*` → `[^/]*` (does not match `/`)
 *  - `?` → `[^/]` (one character, not `/`)
 *  - Other regex characters (`.+(){}|^$[]\`) are escaped.
 *
 * We do not support `{a,b}` brace expansion beyond escaping the braces: real
 * workspace configs do not use braces within the dynamic part.
 */
function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i]!;
    if (ch === "*" && glob[i + 1] === "*") {
      // `**` puede ir seguido o no de `/`.
      pattern += ".*";
      i += 2;
      if (glob[i] === "/") i++;
      continue;
    }
    if (ch === "*") {
      pattern += "[^/]*";
      i++;
      continue;
    }
    if (ch === "?") {
      pattern += "[^/]";
      i++;
      continue;
    }
    if (/[.+(){}|^$\[\]\\]/.test(ch)) {
      pattern += "\\" + ch;
      i++;
      continue;
    }
    pattern += ch;
    i++;
  }
  pattern += "$";
  return new RegExp(pattern);
}

/**
 * Normalizes a glob or path to POSIX-relative form, rejecting escapes and
 * absolute paths. If the input collapses to a value that escapes the root
 * (a leading `..`) or to an empty value, return `null`.
 *
 * Accepts:
 *  - `apps/api`
 *  - `./apps/api` (removes `./`)
 *  - `apps/../api` → `api`
 *
 * Rejects:
 *  - `` (empty) and `.`
 *  - `/abs/path`
 *  - `apps/../../etc` (escapes)
 */
function normalizePosixRelative(value: string): string | null {
  let cleaned = value.trim().replace(/\\/g, "/");
  if (cleaned.startsWith("./")) cleaned = cleaned.slice(2);
  if (cleaned.length === 0 || cleaned === ".") return null;
  if (cleaned.startsWith("/")) return null;

  const segments = cleaned.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else {
        out.push("..");
      }
      continue;
    }
    out.push(segment);
  }

  if (out.length === 0) return null;
  if (out[0] === "..") return null;
  return out.join("/");
}

/** Converts an absolute path to its POSIX-relative form from `projectRoot`. */
function toPosixRelative(projectRoot: string, absolute: string): string {
  const rel = relative(projectRoot, absolute);
  return rel.split(sep).join("/");
}

/**
 * Does this relative path fall within `projectRoot` without escaping?
 *
 * A path is considered "inside" when it is non-empty, not absolute, has no
 * `..`, and is not `.`. Normalization has already collapsed prior `..`; if a
 * `..` appears in the result, the path escaped.
 */
function isInsideProjectRoot(relPath: string): boolean {
  if (relPath.length === 0 || relPath === ".") return false;
  if (isAbsolute(relPath)) return false;
  if (relPath.includes("..")) return false;
  return true;
}
