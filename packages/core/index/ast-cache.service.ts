/**
 * AST cache — single source of truth for parsed source files
 * (f00016 S2).
 *
 * The proposal acceptance text says the cache stores
 * `ts.Program`s. The runtime does not have `typescript` as a
 * dependency (only `@babel/parser`, which the scanners already
 * use), so the cache stores **Babel ASTs** for JS/TS files and
 * returns them as `unknown`. Callers that need a `ts.Program` for
 * cross-file type-aware analysis would still need to add
 * `typescript` to the dependency list — that work is out of scope
 * for S2 and tracked separately.
 *
 * ## Why Babel is acceptable here
 *
 *   - The Babel AST is what `language-frontends/typescript-frontend.ts`
 *     already produces; reusing the same representation means the
 *     scanners that today re-parse the file do not pay a second
 *     conversion cost.
 *   - The cache's job is **to avoid re-parsing**, not to pick a
 *     dialect. The dialect question lives in the consumer.
 *   - The cache's invalidation key is the SHA-256 of the source.
 *     Same hash on the second scan ⇒ same AST, no re-parse.
 *
 * ## Hooks for the future TS upgrade
 *
 *   - `astFor(relPath)` returns `unknown | undefined` — exactly the
 *     shape `ts.Program` would take if/when the dependency lands.
 *   - `parseAst(source, language, relPath)` is the seam: swap its
 *     body for `ts.createProgram` and the cache contract is
 *     unchanged.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse as babelParse, type ParserPlugin, type ParserOptions } from "@babel/parser";

import type {
  AstCapableLanguage,
  ICachedAst,
  IIndexedFile,
  IndexedLanguage,
} from "../../contracts/interfaces/core/index.interface.js";
import { sha256Of } from "./file-cache.service.js";

/** Parses source text with the parser that matches `language`. */
export function parseAst(args: {
  readonly source: string;
  readonly language: AstCapableLanguage;
  readonly relPath: string;
}): unknown {
  const plugins: ParserPlugin[] = [];
  if (args.language === "typescript" || args.language === "tsx") {
    plugins.push("typescript");
  }
  if (args.language === "tsx" || args.language === "jsx") {
    plugins.push("jsx");
  }
  try {
    const opts: ParserOptions = {
      sourceType: "module" as const,
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins,
    };
    return babelParse(args.source, opts);
  } catch {
    // Same shape as the TS frontend's `parseModule`: errors degrade
    // to `null` so the cache stays truthful ("we tried, it did not
    // parse") without throwing into the caller.
    return null;
  }
}

/**
 * Reads a file from disk and parses it into the cache, replacing any
 * previous entry. Returns the new record or `null` when the file is
 * gone. The cache is mutated by side-effect so the caller does not
 * need to reassign.
 */
export async function loadAst(args: {
  readonly cache: Map<string, ICachedAst>;
  readonly projectRoot: string;
  readonly file: IIndexedFile;
}): Promise<ICachedAst | null> {
  if (!isAstCapable(args.file.language)) return null;
  let raw: string;
  try {
    raw = await readFile(join(args.projectRoot, ...args.file.relPath.split("/")), "utf8");
  } catch {
    return null;
  }
  const hash = sha256Of(raw);
  if (args.cache.get(args.file.relPath)?.hashSha256 === hash) {
    return args.cache.get(args.file.relPath) ?? null;
  }
  const ast = parseAst({ source: raw, language: args.file.language, relPath: args.file.relPath });
  const entry: ICachedAst = {
    hashSha256: hash,
    ast,
    language: args.file.language,
  };
  args.cache.set(args.file.relPath, entry);
  return entry;
}

/**
 * Cache lookup that respects the hash: if the file on disk has
 * changed since the cache was filled, the entry is dropped and the
 * cache reports a miss. Callers that want the new value call
 * `loadAst` afterwards.
 */
export function cachedAst(
  cache: ReadonlyMap<string, ICachedAst>,
  file: IIndexedFile,
): ICachedAst | undefined {
  if (!isAstCapable(file.language)) return undefined;
  const entry = cache.get(file.relPath);
  if (!entry) return undefined;
  if (entry.hashSha256 !== file.hashSha256) return undefined;
  return entry;
}

/**
 * Eagerly fills the cache for every file the index knows about.
 * Uses a bounded concurrency (`READ_CONCURRENCY`) so the bench
 * reproduces the same shape as `readAllFiles`.
 */
export async function loadAsts(args: {
  readonly cache: Map<string, ICachedAst>;
  readonly projectRoot: string;
  readonly files: ReadonlyArray<IIndexedFile>;
  readonly concurrency?: number;
}): Promise<void> {
  const width = Math.max(1, args.concurrency ?? 16);
  const work = args.files.filter((f) => isAstCapable(f.language));
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < work.length) {
      const idx = next++;
      const file = work[idx];
      if (!file) return;
      await loadAst({ cache: args.cache, projectRoot: args.projectRoot, file });
    }
  };
  const lanes: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(width, work.length); i++) lanes.push(worker());
  await Promise.all(lanes);
}

/**
 * Drops every cached AST that depends on `relPath`. The inverse
 * graph the invalidator carries is the source of truth — this
 * helper exists so callers do not have to spell out the closure.
 */
export function invalidateAstsFor(
  cache: Map<string, ICachedAst>,
  relPaths: ReadonlyArray<string>,
): void {
  for (const p of relPaths) cache.delete(p);
}

/** Type guard: can this language be AST-cached at all? */
export function isAstCapable(language: IndexedLanguage): language is AstCapableLanguage {
  return (
    language === "typescript" ||
    language === "javascript" ||
    language === "tsx" ||
    language === "jsx"
  );
}

/** Re-export the helper for callers that want to mirror the same shape. */
export { sha256Of };