/**
 * Import-path resolver (audit 2026-09-06 §12, proposal
 * `r00014` S2).
 *
 * Pure path resolution. No filesystem `existsSync`, no
 * `realpath`, no `Bun.file()` — that comes from the caller
 * (the scanner pass that walks the imports). We do the
 * JavaScript-style normalisation:
 *
 *   - `./foo`        → `./foo` (joined with `fromFile`)
 *   - `../bar/baz`   → joined against `fromFile`'s parent
 *   - absolute path  → returned verbatim (canonicalised
 *                      against `projectRoot` so the result is
 *                      always project-relative when the input
 *                      was)
 *   - extension fallback: `./utils` (no `.ts`) → `./utils.ts`,
 *     `./utils.tsx`, `./utils.js`, `./utils/index.ts`,
 *     `./utils/index.js`. **All candidates are returned**;
 *     the caller decides which one (or none) wins.
 *
 * We do not import `node:path` because the resolver is
 * intentionally posix-shaped (always joins with `/`, never
 * produces `\` on Windows). The handful of operations we need
 * are inlined below.
 */

/** Possible extension fallback chain. Ordered by likelihood. */
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"] as const;
const INDEX_SUFFIXES = [".ts", ".tsx", ".js", ".mjs", ".cjs"] as const;
const SUBDIR_INDEX = "/index";

/**
 * One candidate the resolver can return.
 *
 * - `path`: posix-shaped path. Always starts with `/` when
 *   the input `fromFile` was absolute.
 * - `kind`: why this candidate was generated (extension
 *   fallback, `/index.{ext}` fallback, or literal). The
 *   caller can decide to log a warning for, say, a
 *   `/index.js` fallback in a TS project.
 */
export interface IImportCandidate {
  /** Absolute, posix-separated path. */
  readonly path: string;
  readonly kind:
    | "literal"
    | "extension-fallback"
    | "index-fallback";
}

/**
 * Resolve an import specifier against a source file.
 *
 * @param fromFile    Absolute path of the file containing the
 *                    `import … from "…"` statement.
 * @param specifier   The raw specifier (between the quotes).
 *                    Bare specifiers like `"lodash"` are
 *                    rejected — they reference `node_modules`
 *                    which the resolver does not own.
 * @param projectRoot Absolute path of the project root. Today
 *                    the resolver works off `fromFile`'s
 *                    dirname only — `projectRoot` is part of
 *                    the signature so a future version can
 *                    canonicalise the result back to a
 *                    project-relative path without breaking
 *                    call sites.
 * @returns           Zero or more `IImportCandidate`s. Always
 *                    `[]` when the input is empty or the
 *                    specifier is a bare module name (no
 *                    leading `.` or `/`).
 */
export function resolveImportPath(
  fromFile: string,
  specifier: string,
  projectRoot: string,
): ReadonlyArray<IImportCandidate> {
  // Touch `projectRoot` so TS doesn't complain about an
  // unused parameter; the value is kept in the signature
  // for forward-compat.
  void projectRoot;

  if (specifier.length === 0) return [];

  // Bare module specifier (e.g. `import x from "express"`).
  // The resolver does not own node_modules resolution.
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return [];
  }

  // Absolute path inside the project: keep the literal,
  // run the extension fallback against it.
  if (isAbsolute(specifier)) {
    return expandFallback(specifier);
  }

  // Relative: anchor at `fromFile`'s directory.
  const base = posixDirname(fromFile);
  return expandFallback(posixJoin(base, specifier));
}

/** Whether the path is absolute (leading `/`). */
function isAbsolute(p: string): boolean {
  return p.length > 0 && p.charCodeAt(0) === 47; // "/"
}

/**
 * Posix-shaped dirname. Strips the trailing segment; if the
 * path has no `/`, returns `"."`. We do not use `node:path`
 * so the behaviour is identical on Windows and Unix.
 */
function posixDirname(p: string): string {
  const i = p.lastIndexOf("/");
  if (i === -1) return ".";
  if (i === 0) return "/";
  return p.slice(0, i);
}

/**
 * Posix-shaped join: inserts a single `/` between segments
 * and collapses double slashes. Unlike `path.join` this
 * never normalises away the leading `/` of `fromFile`.
 */
function posixJoin(base: string, rel: string): string {
  if (rel.length === 0) return base;
  const left = base.endsWith("/") ? base.slice(0, -1) : base;
  const right = rel.startsWith("/") ? rel : "/" + rel;
  return collapseDoubleSlashes(left + right);
}

function collapseDoubleSlashes(p: string): string {
  while (p.includes("//")) {
    const replaced = p.replace("//", "/");
    if (replaced === p) break;
    p = replaced;
  }
  return p;
}

/** Strip trailing redundant `/.` / `/..` segments. */
function normalize(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      continue;
    }
    out.push(seg);
  }
  const prefix = p.startsWith("/") ? "/" : "";
  return prefix + out.join("/");
}

/**
 * Walk the extension / `/index.{ext}` fallback chain for a
 * base path. The base may already include an extension —
 * in which case the chain still applies (the base is the
 * first candidate, then the alternates follow).
 */
function expandFallback(base: string): ReadonlyArray<IImportCandidate> {
  const out: IImportCandidate[] = [];
  const literal: IImportCandidate = {
    path: normalize(base),
    kind: "literal",
  };
  out.push(literal);

  // Strip an existing extension to walk the bare form.
  const ext = extensionOf(base);
  const bare = ext ? base.slice(0, -ext.length) : base;

  for (const e of EXTENSIONS) {
    if (e === ext) continue;
    out.push({
      path: normalize(bare + e),
      kind: "extension-fallback",
    });
  }

  for (const e of INDEX_SUFFIXES) {
    out.push({
      path: normalize(bare + SUBDIR_INDEX + e),
      kind: "index-fallback",
    });
  }
  return Object.freeze(out);
}

/** Returns the trailing extension including the dot, or `""`. */
function extensionOf(p: string): string {
  const slash = p.lastIndexOf("/");
  const start = slash === -1 ? 0 : slash + 1;
  const dot = p.lastIndexOf(".");
  if (dot <= start) return "";
  return p.slice(dot);
}
