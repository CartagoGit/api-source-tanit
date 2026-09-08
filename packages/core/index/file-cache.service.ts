/**
 * File cache — single source of truth for "what files exist under
 * projectRoot" (f00016 S2).
 *
 * Two layers:
 *
 *   1. **Listing**: a single recursive directory walk produces the
 *      initial `Map<relPath, IIndexedFile>`. The walk skips
 *      `node_modules`, `.git`, `dist`, `build`, etc. — same set as
 *      `fs-walk.helper.ts` so the index sees the same files the
 *      scanners already see.
 *   2. **Hashing**: each file gets a SHA-256 of its content. The
 *      hash is the single byte that decides whether the AST / the
 *      parsed manifest is still valid; without it the cache cannot
 *      tell a "0 re-parses" from a "0 reparses" because something
 *      silently fell back.
 *
 * The cache is **lazy** by design: callers ask for `get(absPath)`
 * and the service decides whether to read the file. A scanner that
 * walks the project to read everything will pay the walk exactly
 * once; a scanner that asks per-file pays it per-file. The point is
 * that the walk is not duplicated across scanners.
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

import { collectFiles } from "../helpers/fs-walk.helper.js";
import type { IWorkspace } from "./workspace-resolver.service.js";
import { workspaceFor } from "./workspace-resolver.service.js";

/** Recognised languages. `unknown` is the safe default. */
export type IndexedLanguage =
  | "typescript"
  | "javascript"
  | "tsx"
  | "jsx"
  | "go"
  | "rust"
  | "php"
  | "python"
  | "ruby"
  | "elixir"
  | "kotlin"
  | "csharp"
  | "json"
  | "yaml"
  | "toml"
  | "lock"
  | "graphql"
  | "unknown";

/**
 * A file the index knows about. `absPath` is the on-disk path;
 * `relPath` is posix-separated and relative to `projectRoot` so the
 * rest of the index can build stable keys across platforms.
 *
 * Note: `mtimeMs` is intentionally absent. The runtime ambient
 * declarations (`packages/contracts/interfaces/runtime.d.ts`) do
 * not surface it, and the **SHA-256 hash** is the invalidation key
 * that matters — if the bytes change, the hash changes, and the
 * AST/manifest cache drops. Keeping the surface small keeps the
 * index free of `mtime`-flaky behaviour.
 */
export interface IIndexedFile {
  readonly relPath: string;
  readonly absPath: string;
  readonly size: number;
  /** Lowercase hex SHA-256 of the file content. */
  readonly hashSha256: string;
  readonly language: IndexedLanguage;
  /** Workspace this file belongs to (root workspace when none). */
  readonly workspace: IWorkspace;
}

const LANGUAGE_BY_EXT: Record<string, IndexedLanguage> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  tsx: "tsx",
  jsx: "jsx",
  go: "go",
  rs: "rust",
  php: "php",
  py: "python",
  rb: "ruby",
  ex: "elixir",
  exs: "elixir",
  kt: "kotlin",
  kts: "kotlin",
  cs: "csharp",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  lock: "lock",
  gql: "graphql",
  graphql: "graphql",
};

/**
 * Extension-less manifest filenames the slice explicitly recognises
 * (acceptance text: package.json, tsconfig.json, go.mod, Cargo.toml,
 * composer.json, pyproject.toml, Gemfile, mix.exs). The first six
 * carry their dialect in the suffix; the last two are bare names.
 */
const LANGUAGE_BY_BASENAME: Record<string, IndexedLanguage> = {
  Gemfile: "ruby",
  "mix.exs": "elixir",
};

/**
 * Identifies a file's language from its extension. Returns
 * `unknown` when nothing matches — the index never throws on a
 * weird file, it just tags it `unknown` and the consumer decides
 * what to do.
 */
export function detectLanguage(filename: string): IndexedLanguage {
  const byBase = LANGUAGE_BY_BASENAME[filename];
  if (byBase) return byBase;
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return "unknown";
  const ext = filename.slice(dot + 1).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? "unknown";
}

/**
 * Lazily read + hash a single file. Returns `null` when the file
 * cannot be read (permissions, broken symlink, disappeared between
 * listing and reading) — those failures are recorded silently in the
 * listing so the cache stays truthful.
 */
export async function readIndexedFile(
  absPath: string,
  projectRoot: string,
  workspaces: ReadonlyArray<IWorkspace>,
): Promise<IIndexedFile | null> {
  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(absPath);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;

  let content: string;
  try {
    content = await readFile(absPath, "utf8");
  } catch {
    return null;
  }
  const hash = createHash("sha256").update(content).digest("hex");
  const filename = absPath.slice(Math.max(absPath.lastIndexOf("/"), absPath.lastIndexOf("\\")) + 1);
  const relPath = toPosix(relative(projectRoot, absPath));
  const workspace = workspaceFor(workspaces, projectRoot, absPath) ?? {
    relPath: "",
    absPath: projectRoot,
    manager: "unknown" as const,
  };
  return {
    relPath,
    absPath,
    size: st.size,
    hashSha256: hash,
    language: detectLanguage(filename),
    workspace,
  };
}

/**
 * Walks `projectRoot` and returns the index for every file under it.
 * Files inside `skipVendorDirs` directories are excluded (same rule
 * as `collectFiles`). Returns a fresh map; the caller decides whether
 * to merge it into an existing index.
 */
export async function indexFiles(args: {
  readonly projectRoot: string;
  readonly workspaces: ReadonlyArray<IWorkspace>;
  readonly skipVendorDirs?: boolean;
}): Promise<Map<string, IIndexedFile>> {
  const { projectRoot, workspaces, skipVendorDirs = true } = args;
  const root = projectRoot.replace(/[\\/]+$/, "");
  const paths = await collectFiles(root, () => true, { skipVendorDirs });
  const out = new Map<string, IIndexedFile>();
  for (const absPath of paths) {
    const file = await readIndexedFile(absPath, root, workspaces);
    if (file) out.set(file.relPath, file);
  }
  return out;
}

/**
 * Re-hashes a single file in place, returning the new record (or
 * `null` if the file disappeared). The map is mutated by side-effect
 * so the AST / manifest caches can see the new hash without a
 * second walk.
 */
export async function refreshIndexedFile(
  cache: Map<string, IIndexedFile>,
  absPath: string,
  projectRoot: string,
  workspaces: ReadonlyArray<IWorkspace>,
): Promise<IIndexedFile | null> {
  const file = await readIndexedFile(absPath, projectRoot, workspaces);
  if (!file) {
    const relPath = toPosix(relative(projectRoot, absPath));
    cache.delete(relPath);
    return null;
  }
  cache.set(file.relPath, file);
  return file;
}

/**
 * Computes the SHA-256 of a string. Used by callers that already
 * have the content (e.g. the AST cache after parsing) and want to
 * match it against the file cache without going through the disk
 * again.
 */
export function sha256Of(text: string): string {
  // `Hash.update(text)` defaults to utf-8 — the project ambient
  // declarations expose a one-arg signature and that matches Node's
  // documented behaviour.
  return createHash("sha256").update(text).digest("hex");
}

/** Normalises a Windows-style path to posix. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Joins two posix-style paths without leading/trailing slashes collisions. */
export function joinPosix(...parts: ReadonlyArray<string>): string {
  return parts
    .filter((p) => p.length > 0)
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .join("/");
}

/** Re-export the helper used by callers that need the same skip list. */
export const SKIP_VENDOR_DIRS_DEFAULT = true;

/** Internal: build the absolute path of `relPath` under `root`. */
export function absPathOf(root: string, relPath: string): string {
  return join(root, ...relPath.split("/"));
}

/** Internal: produce a stable key for a file lookup. */
export function keyOf(relPath: string): string {
  return toPosix(relPath).replace(/^\/+/, "");
}

/** Internal: read-only snapshot of the file map for diagnostics. */
export function snapshotFiles(
  cache: Map<string, IIndexedFile>,
): ReadonlyArray<IIndexedFile> {
  return [...cache.values()];
}

/**
 * Counts how many files the cache holds by language. Used in
 * diagnostics; the bench reuses it to assert that the second pass
 * produced the same shape as the first.
 */
export function filesByLanguage(
  cache: ReadonlyMap<string, IIndexedFile>,
): ReadonlyMap<IndexedLanguage, number> {
  const out = new Map<IndexedLanguage, number>();
  for (const file of cache.values()) {
    out.set(file.language, (out.get(file.language) ?? 0) + 1);
  }
  return out;
}

// Quiet unused-arg warning when callers omit `workspaces` (tests do
// that — they pass a single-workspace fake).
export type _FileCacheWorkspaces = ReadonlyArray<IWorkspace>;