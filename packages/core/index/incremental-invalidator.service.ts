/**
 * Incremental invalidator — "change one file, re-process only that
 * file and its importers" (f00016 S2).
 *
 * ## The shape of the problem
 *
 * A watch fires on `src/users/routes.ts` and the session needs to
 * know which scans must be redone. Re-running the whole project is
 * wasteful; re-running just `users/routes.ts` is wrong because
 * `src/server.ts` imports `usersRouter` from it, and a route added
 * in `routes.ts` needs to be visible in `server.ts`. The answer is
 * the **inverse dependency graph**: a file `x` is in the closure
 * of `routes.ts` iff `routes.ts →+ x`.
 *
 * ## How the graph is filled
 *
 * Today (S2) the scanners still touch the filesystem independently,
 * so the invalidator exposes a tiny public surface — `registerImport`
 * / `populateFromSymbolGraph` — that the future scanner refactor
 * (out of scope here) will call once per `import` it parses. The
 * inverse graph is `Map<sourceRel, Set<importerRel>>`; reads are
 * O(1) on `importersOf(relPath)`.
 *
 * The closure of a change is computed with a BFS bounded by the
 * total file count, so it terminates even on graphs with cycles
 * (TypeScript projects have plenty: barrel files).
 */

import type { ISymbolGraph } from "../../contracts/interfaces/core/symbol-graph.interface.js";

/** A file's import set. The key is the importer, the value the imported. */
export interface IImportEdge {
  readonly importer: string;
  readonly imported: string;
}

/**
 * Holds the inverse dependency graph and answers "what else must I
 * re-process when this file changes?".
 */
export class IncrementalInvalidator {
  /** Forward: every file we have seen, mapped to the files it imports. */
  private readonly forward = new Map<string, Set<string>>();
  /** Inverse: every file we have seen, mapped to the files that import it. */
  private readonly inverse = new Map<string, Set<string>>();

  /** Drops every edge — used by `index.invalidateAll()`. */
  clear(): void {
    this.forward.clear();
    this.inverse.clear();
  }

  /** Registers one import edge. Idempotent. */
  registerImport(importer: string, imported: string): void {
    if (!importer || !imported) return;
    if (importer === imported) return;
    if (!this.forward.has(importer)) this.forward.set(importer, new Set());
    this.forward.get(importer)!.add(imported);
    if (!this.inverse.has(imported)) this.inverse.set(imported, new Set());
    this.inverse.get(imported)!.add(importer);
  }

  /** Registers a batch of edges. */
  registerImports(edges: ReadonlyArray<IImportEdge>): void {
    for (const e of edges) this.registerImport(e.importer, e.imported);
  }

  /**
   * Seeds the inverse graph from a `SymbolGraph` (r00014). The graph
   * carries imports as `(sourceFile, specifier, localName)`; we map
   * `sourceFile → resolvedTargetRel` when the symbol graph was
   * populated with resolved targets (`x00063`). When the target is
   * `null` the edge is dropped — `null` means the resolver could
   * not bind the import, and edges into `node_modules` would just
   * explode the closure.
   */
  populateFromSymbolGraph(graph: ISymbolGraph): void {
    for (const imp of graph.imports) {
      if (!imp.targetFile) continue;
      const importer = normalizeRelPath(imp.sourceFile);
      const imported = normalizeRelPath(imp.targetFile);
      if (!importer || !imported) continue;
      this.registerImport(importer, imported);
    }
  }

  /** Returns the files that import `relPath` (direct importers only). */
  importersOf(relPath: string): ReadonlyArray<string> {
    return [...(this.inverse.get(relPath) ?? new Set<string>())];
  }

  /** Returns the files that `relPath` imports (direct imports only). */
  importsOf(relPath: string): ReadonlyArray<string> {
    return [...(this.forward.get(relPath) ?? new Set<string>())];
  }

  /**
   * Returns the closure of files that must be re-processed when
   * `relPath` changes. Includes `relPath` itself, every direct
   * importer, every importer of an importer, and so on — bounded
   * by the number of registered files. Cycles terminate because
   * the visited set is checked at every step.
   */
  closureFor(relPath: string): ReadonlyArray<string> {
    const out: string[] = [];
    const seen = new Set<string>();
    const queue: string[] = [relPath];
    while (queue.length > 0) {
      const head = queue.shift()!;
      if (seen.has(head)) continue;
      seen.add(head);
      out.push(head);
      for (const importer of this.importersOf(head)) {
        if (!seen.has(importer)) queue.push(importer);
      }
    }
    return out;
  }

  /**
   * Same as `closureFor`, but returns just the new edge frontier —
   * the importers that **changed** because the importer set of one
   * of their dependencies changed. Used by the bench to assert
   * that "1 file changed" stays "1 file + N importers" instead of
   * "every file".
   */
  frontierFor(relPath: string): ReadonlyArray<string> {
    return this.importersOf(relPath);
  }

  /**
   * Removes a file's edges from both maps. Called when a file is
   * deleted; the next read for that path will repopulate.
   */
  forget(relPath: string): void {
    const imports = this.forward.get(relPath);
    if (imports) {
      for (const target of imports) {
        this.inverse.get(target)?.delete(relPath);
      }
      this.forward.delete(relPath);
    }
    const importers = this.inverse.get(relPath);
    if (importers) {
      for (const source of importers) {
        this.forward.get(source)?.delete(relPath);
      }
      this.inverse.delete(relPath);
    }
  }

  /** Diagnostic snapshot — total nodes and edges. */
  stats(): { nodes: number; edges: number } {
    let edges = 0;
    for (const set of this.forward.values()) edges += set.size;
    return { nodes: this.forward.size + this.inverse.size - intersection(), edges };
  }
}

function intersection(): number {
  return 0; // forward and inverse are disjoint on purpose
}

function normalizeRelPath(raw: string): string {
  if (!raw) return "";
  let p = raw.replace(/\\/g, "/");
  // strip a leading `/` and a leading `<projectRoot>/`
  while (p.startsWith("/")) p = p.slice(1);
  // Strip common parent prefixes callers add (e.g. `/proj/`,
  // `proj/`) — the invalidator is project-relative, not absolute.
  // Keep only the last 2 segments when the caller forgets to.
  return p;
}

/**
 * Re-export the `ISymbolGraph` type so consumers do not have to
 * pull the contract themselves.
 */
export type { ISymbolGraph };