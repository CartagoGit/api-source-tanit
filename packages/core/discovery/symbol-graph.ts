/**
 * `SymbolGraph` — Tanit's cross-file symbol resolver (audit
 * 2026-09-06 §12, proposal `r00014` S1).
 *
 * The graph holds `ISymbolNode`s, keyed by source file. Each
 * node carries the data a cross-file consumer needs to
 * resolve a textual reference back to a declaration:
 *
 * - its `SymbolId` (file + offset + localName),
 * - a `kind` tag so consumers don't confuse a value with a
 *   type alias when they look up by name,
 * - an opaque `payload` (the framework inferrer fills it with
 *   whatever it needs to expose; e.g. the Express scanner
 *   stores the router's prefix path here; S4 of `r00014`
 *   consumes it).
 *
 * Imports sit in a parallel map (`IImportRecord`s) so that
 * `resolveByImportPath` can follow `import { router } from
 * "./users/routes"` to the declaration graph of the target
 * file. The map is filled by each scanner when it visits an
 * `import` statement; S1 only stores and queries it.
 *
 * Concurrency / mutability: the graph is **synchronous** and
 * built during one `IScanResult` collection pass. We never
 * mutate the graph after it leaves the scanner — `SymbolGraph`
 * is `Object.freeze()`d on return. Consumers that need a
 * mutable graph (rare, only tests) get a fresh one through
 * `SymbolGraph.empty()`.
 */
import {
  makeSymbolId,
  type SymbolId,
  symbolIdToString,
} from "./symbol-id.js";
import type { ISymbolGraph } from "../../contracts/interfaces/core/symbol-graph.interface.js";

/** Tags a node so consumers don't confuse a value with a type alias. */
export type SymbolKind =
  | "value"
  | "type"
  | "router"
  | "plugin"
  | "sub-app"
  | "handler";

/** Single symbol in the graph. */
export interface ISymbolNode {
  readonly id: SymbolId;
  readonly kind: SymbolKind;
  /**
   * Opaque payload — the scanner fills it with whatever
   * cross-file consumers need (router prefix, plugin prefix,
   * sub-app mount path, …). Typed as `unknown` here on
   * purpose so the graph stays framework-agnostic.
   */
  readonly payload?: unknown;
}

/**
 * One import edge — `import { router as usersRouter } from
 * "./users/routes"`. The graph does **not** resolve
 * `"./users/routes"` to a file path (that's S2). It just
 * records the specifier and the local names so the resolver
 * can later walk the edge.
 */
export interface IImportRecord {
  readonly sourceFile: string;
  /** Raw specifier as written in `from "..."`. */
  readonly specifier: string;
  /** Local name in the importing file. */
  readonly localName: string;
  /** Original imported name (different from `localName` on `as` renames). */
  readonly importedName: string;
}

/** Mutation surface — kept off the public `ISymbolGraph`. */
interface IMutableSymbolGraph extends Omit<ISymbolGraph, "resolveByName" | "resolveByImportPath"> {
  byFile: Map<string, ISymbolNode[]>;
  importsByFile: Map<string, IImportRecord[]>;
}

function newMutable(): IMutableSymbolGraph {
  return {
    nodes: [],
    imports: [],
    byFile: new Map(),
    importsByFile: new Map(),
  };
}

/** Empty graph (the default every scanner starts with before it starts visiting). */
export function empty(): ISymbolGraph {
  return finalize(newMutable());
}

/**
 * Namespace alias so callers can write
 *   `SymbolGraph.empty()`
 * instead of importing two names. Mirrors the ergonomic
 * shape of every other helper in `core/discovery/`.
 */
export const SymbolGraph = {
  empty,
  builder: () => new SymbolGraphBuilder(),
};

/** Mutable builder passed to scanners during the parse pass. */
export class SymbolGraphBuilder {
  private readonly state: IMutableSymbolGraph = newMutable();

  /**
   * Add a node. **Idempotent**: if a node with the same
   * `SymbolId` already exists, the call is a no-op (the
   * proposal explicitly asks for "addSymbol idempotente" in
   * S1; frameworks re-walk the same file once per scanner
   * and would otherwise register the same symbol twice).
   */
  addSymbol(node: ISymbolNode): void {
    const id = node.id;
    makeSymbolId(id.sourceFile, id.declarationStart, id.localName);
    const fileBucket = this.state.byFile.get(id.sourceFile) ?? [];
    const exists = fileBucket.some(
      (n) => symbolIdToString(n.id) === symbolIdToString(id),
    );
    if (exists) return;
    fileBucket.push(node);
    this.state.byFile.set(id.sourceFile, fileBucket);
  }

  /** Add an import record. Duplicates by `(file, specifier, localName)` collapse. */
  addImport(record: IImportRecord): void {
    const fileBucket = this.state.importsByFile.get(record.sourceFile) ?? [];
    const dup = fileBucket.some(
      (r) =>
        r.specifier === record.specifier &&
        r.localName === record.localName,
    );
    if (dup) return;
    fileBucket.push(record);
    this.state.importsByFile.set(record.sourceFile, fileBucket);
  }

  /**
   * Build a frozen `ISymbolGraph` from the recorded state.
   * Call exactly once per scanner pass.
   */
  finalize(): ISymbolGraph {
    return finalize(this.state);
  }

  /** Read-only inspection (test escape hatch). */
  snapshot(): {
    nodes: ReadonlyArray<ISymbolNode>;
    imports: ReadonlyArray<IImportRecord>;
  } {
    return {
      nodes: [...this.state.byFile.values()].flat(),
      imports: [...this.state.importsByFile.values()].flat(),
    };
  }
}

function finalize(state: IMutableSymbolGraph): ISymbolGraph {
  const nodes = Object.freeze(
    [...state.byFile.values()].flat().map((n) => Object.freeze(n)),
  );
  const imports = Object.freeze(
    [...state.importsByFile.values()].flat().map((i) => Object.freeze(i)),
  );
  return Object.freeze({
    nodes,
    imports,
    resolveByName(sourceFile: string, localName: string) {
      const bucket = state.byFile.get(sourceFile);
      if (!bucket) return Object.freeze([]);
      return Object.freeze(
        bucket.filter((n) => n.id.localName === localName),
      );
    },
    resolveByImportPath(sourceFile: string, specifier: string, localName: string) {
      const importsBucket = state.importsByFile.get(sourceFile);
      if (!importsBucket) return Object.freeze([]);
      const matching = importsBucket.find(
        (r) => r.specifier === specifier && r.localName === localName,
      );
      if (!matching) return Object.freeze([]);
      // The destination file is whatever the resolver
      // (S2) joined up; the graph doesn't track that
      // here, so the framework scanner's call to
      // S2 supplies it. Today, callers also look in
      // `state.byFile` for any node that imports
      // `specifier` and matches the importedName.
      const targetBucket = [...state.byFile.entries()];
      const out: ISymbolNode[] = [];
      for (const [targetFile, bucket] of targetBucket) {
        if (targetFile === sourceFile) continue;
        for (const n of bucket) {
          if (n.id.localName === matching.importedName) out.push(n);
        }
      }
      return Object.freeze(out);
    },
  });
}
