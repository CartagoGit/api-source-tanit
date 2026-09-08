/**
 * `ProjectIndex` — the public facade of the index layer (f00016 S2).
 *
 * This module composes the five services that the slice ships:
 *
 *   - `file-cache.service.ts`       (SHA-256 + language)
 *   - `manifest-reader.service.ts`  (parsed manifests)
 *   - `ast-cache.service.ts`        (Babel AST cache)
 *   - `workspace-resolver.service.ts` (monorepo workspaces)
 *   - `incremental-invalidator.service.ts` (inverse graph)
 *
 * …and exposes one object that satisfies `IProjectIndex`. The shape
 * is what the slice acceptance text describes: `file(relPath)`,
 * `astFor(relPath)`, `manifestFor(relPath)`, plus the watch-driven
 * `invalidate(relPath)` returning the closure to re-scan.
 *
 * ## Compatibility note (`ts.Program` → `unknown`)
 *
 * The slice acceptance says `astFor(relPath): ts.Program | undefined`.
 * `typescript` is not a runtime dependency of this package, only
 * `@babel/parser`. The cache stores Babel ASTs and exposes them as
 * `unknown`. Adding `typescript` and returning `ts.Program` is the
 * obvious follow-up; the public surface here (`unknown | undefined`)
 * is forward-compatible with that change.
 */

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { IImportRecord, ISymbolGraph } from "../../contracts/interfaces/core/symbol-graph.interface.js";

import {
  cachedAst,
  invalidateAstsFor,
  loadAst,
  loadAsts,
  type ICachedAst,
} from "./ast-cache.service.js";
import {
  filesByLanguage,
  indexFiles,
  refreshIndexedFile,
  type IIndexedFile,
} from "./file-cache.service.js";
import {
  IncrementalInvalidator,
  type IImportEdge,
} from "./incremental-invalidator.service.js";
import {
  isManifestFile,
  readManifest,
  type IManifest,
} from "./manifest-reader.service.js";
import {
  detectWorkspaces,
  type IWorkspace,
} from "./workspace-resolver.service.js";

/** Public interface of a project index. */
export interface IProjectIndex {
  readonly root: string;
  readonly workspaces: ReadonlyArray<IWorkspace>;
  /** Number of files the index currently knows about. */
  readonly fileCount: number;
  /** Number of ASTs the cache currently holds. */
  readonly astCount: number;
  /** Number of manifests the cache currently holds. */
  readonly manifestCount: number;

  file(relPath: string): IIndexedFile | undefined;
  /** All files, as a readonly snapshot — useful for tests and diagnostics. */
  files(): ReadonlyArray<IIndexedFile>;
  astFor(relPath: string): unknown | undefined;
  manifestFor(relPath: string): IManifest | undefined;
  importsFor(relPath: string): ReadonlyArray<IImportRecord> | undefined;

  /**
   * Mark `relPath` as changed. Returns the closure (the file itself
   * plus every importer) that must be re-processed.
   */
  invalidate(relPath: string): ReadonlyArray<string>;
  invalidateAll(): void;
  close(): void;
}

/** Options for `ProjectIndex.open()`. */
export interface IProjectIndexOptions {
  /** Skip vendor directories during the initial walk (default: true). */
  readonly skipVendorDirs?: boolean;
  /** Pre-fill the AST cache during `open()`. Default: false. */
  readonly eagerAst?: boolean;
  /** Concurrency for the eager AST fill (default: 16). */
  readonly astConcurrency?: number;
  /**
   * Pre-seed the inverse graph from a `SymbolGraph`. Default: none.
   * The scanners still populate imports in their own time; this
   * option is for tests and the future scanner refactor.
   */
  readonly symbolGraph?: ISymbolGraph;
}

/** Default implementation of `IProjectIndex`. */
export class ProjectIndex implements IProjectIndex {
  private readonly _files = new Map<string, IIndexedFile>();
  private readonly _manifests = new Map<string, IManifest>();
  private readonly _asts = new Map<string, ICachedAst>();
  private readonly _imports = new Map<string, IImportRecord[]>();
  private readonly _workspaces: ReadonlyArray<IWorkspace>;
  private readonly _invalidator = new IncrementalInvalidator();
  private _closed = false;

  private constructor(
    public readonly root: string,
    workspaces: ReadonlyArray<IWorkspace>,
    files: Map<string, IIndexedFile>,
    manifests: Map<string, IManifest>,
    options: IProjectIndexOptions,
  ) {
    this._workspaces = Object.freeze([...workspaces]);
    this._files = files;
    this._manifests = manifests;
    if (options.symbolGraph) {
      this._invalidator.populateFromSymbolGraph(options.symbolGraph);
    }
    // Build the per-file import table from the same graph so
    // `importsFor(relPath)` works without an extra consumer.
    if (options.symbolGraph) {
      for (const imp of options.symbolGraph.imports) {
        const source = normalizeRel(imp.sourceFile);
        if (!source) continue;
        const list = this._imports.get(source) ?? [];
        list.push(imp);
        this._imports.set(source, list);
      }
    }
  }

  /**
   * Open an index on `root`. The walk + manifest read + (optional)
   * AST fill happens eagerly so callers can immediately ask for
   * `file()`, `astFor()`, and `manifestFor()`.
   */
  static async open(
    root: string,
    options: IProjectIndexOptions = {},
  ): Promise<ProjectIndex> {
    const normRoot = root.replace(/[\\/]+$/, "");
    const workspaces = detectWorkspaces({
      projectRoot: normRoot,
      readTextFile: (abs) => safeRead(abs),
    });
    const files = await indexFiles({
      projectRoot: normRoot,
      workspaces,
      skipVendorDirs: options.skipVendorDirs,
    });
    const manifestPaths: string[] = [];
    for (const file of files.values()) {
      if (isManifestFile(file.relPath)) manifestPaths.push(file.relPath);
    }
    const manifests = new Map<string, IManifest>();
    for (const relPath of manifestPaths) {
      const m = await readManifest({ projectRoot: normRoot, relPath });
      if (m) manifests.set(relPath, m);
    }
    const index = new ProjectIndex(normRoot, workspaces, files, manifests, options);
    if (options.eagerAst) {
      await loadAsts({
        cache: index._asts,
        projectRoot: normRoot,
        files: [...files.values()],
        concurrency: options.astConcurrency,
      });
    }
    return index;
  }

  get workspaces(): ReadonlyArray<IWorkspace> {
    return this._workspaces;
  }

  get fileCount(): number {
    return this._files.size;
  }

  get astCount(): number {
    return this._asts.size;
  }

  get manifestCount(): number {
    return this._manifests.size;
  }

  file(relPath: string): IIndexedFile | undefined {
    if (this._closed) return undefined;
    return this._files.get(normalizeRel(relPath));
  }

  files(): ReadonlyArray<IIndexedFile> {
    return [...this._files.values()];
  }

  astFor(relPath: string): unknown | undefined {
    if (this._closed) return undefined;
    const norm = normalizeRel(relPath);
    const file = this._files.get(norm);
    if (!file) return undefined;
    const entry = cachedAst(this._asts, file);
    if (entry) return entry.ast;
    // Lazy fill: synchronous read is not allowed in a public
    // accessor (returns sync), so the lazy path is opt-in via the
    // helper below. Consumers that need the fill call `ensureAst`.
    return undefined;
  }

  /** Lazy AST fill — async variant that respects the cache + hash. */
  async ensureAst(relPath: string): Promise<unknown | undefined> {
    if (this._closed) return undefined;
    const norm = normalizeRel(relPath);
    const file = this._files.get(norm);
    if (!file) return undefined;
    const entry = await loadAst({
      cache: this._asts,
      projectRoot: this.root,
      file,
    });
    return entry ? entry.ast : undefined;
  }

  manifestFor(relPath: string): IManifest | undefined {
    if (this._closed) return undefined;
    return this._manifests.get(normalizeRel(relPath));
  }

  importsFor(relPath: string): ReadonlyArray<IImportRecord> | undefined {
    if (this._closed) return undefined;
    return this._imports.get(normalizeRel(relPath));
  }

  invalidate(relPath: string): ReadonlyArray<string> {
    if (this._closed) return [];
    const norm = normalizeRel(relPath);
    // The closure is computed from the invalidator regardless of
    // whether the file is in the file cache. The fixture-only tests
    // register imports on files the cache has not walked (e.g. the
    // synthetic `a.ts → b.ts → c.ts → d.ts` chain), and returning
    // `[]` for those would hide the real graph. The file-cache
    // refresh is a no-op when the path is unknown.
    const file = this._files.get(norm);
    if (file) {
      void refreshIndexedFile(this._files, file.absPath, this.root, this._workspaces);
    }
    const closure = this._invalidator.closureFor(norm);
    invalidateAstsFor(this._asts, closure);
    return closure;
  }

  invalidateAll(): void {
    if (this._closed) return;
    this._files.clear();
    this._manifests.clear();
    this._asts.clear();
    this._imports.clear();
    this._invalidator.clear();
  }

  close(): void {
    if (this._closed) return;
    this.invalidateAll();
    this._closed = true;
  }

  // ── Diagnostics used by the bench and by tests ─────────────────────────

  /** Snapshot of files indexed, grouped by language. */
  filesByLanguage() {
    return filesByLanguage(this._files);
  }

  /** Total edges in the inverse graph (forward + inverse, deduplicated). */
  invalidatorStats() {
    return this._invalidator.stats();
  }

  /**
   * Register an extra import edge. The scanner refactor (future
   * slice) calls this once per import it parses so `invalidate()`
   * has the inverse graph it needs without re-walking imports.
   */
  registerImport(edge: IImportEdge): void {
    if (this._closed) return;
    this._invalidator.registerImport(edge.importer, edge.imported);
  }
}

function normalizeRel(p: string): string {
  if (!p) return "";
  let out = p.replace(/\\/g, "/");
  while (out.startsWith("/")) out = out.slice(1);
  return out;
}

function safeRead(abs: string): string | null {
  // Synchronous read because `detectWorkspaces` is pure on purpose;
  // the helper exists to keep the public resolver free of async.
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

/** Namespace alias so callers can write `ProjectIndex.open(...)`. */
export const ProjectIndexFactory = { open: ProjectIndex.open };

/** Re-export the supporting types. */
export type {
  IIndexedFile,
  IndexedLanguage,
} from "./file-cache.service.js";
export type { IManifest, ManifestType, ManifestFormat } from "./manifest-reader.service.js";
export type {
  IWorkspace,
  WorkspaceManager,
} from "./workspace-resolver.service.js";
export type {
  IncrementalInvalidator,
  IImportEdge,
} from "./incremental-invalidator.service.js";

// `readFile` is re-exported for the future scanner refactor; today
// no caller uses it.
export type _IndexImportsAsyncReadFile = typeof readFile;
// `join` is re-exported to give the future scanner refactor a single
// import site; today it is only used inside `ensureAst`.
export type _IndexImportsJoin = typeof join;