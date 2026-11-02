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
  symbolIdToString,
} from "./symbol-id.js";
import type {
  ISymbolGraph,
  ISymbolGraphOptions,
  IImportRecord,
  ISymbolNode,
} from "../../contracts/interfaces/core/symbol-graph.interface.js";
import type { SymbolKind } from "../../contracts/interfaces/core/symbol-id.interface.js";

// Re-export the contract types so existing importers keep working.
export type { IImportRecord, ISymbolNode, SymbolKind };

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

/**
 * Empty graph (the default every scanner starts with before it starts
 * visiting).
 *
 * The options are the ones of the graph: by default the legacy
 * global-name lookup is **off**.
 */
export function empty(options?: ISymbolGraphOptions): ISymbolGraph {
  return finalize(newMutable(), options);
}

/**
 * Namespace alias so callers can write
 *   `SymbolGraph.empty()`
 * instead of importing two names. Mirrors the ergonomic
 * shape of every other helper in `core/discovery/`.
 */
export const SymbolGraph = {
  empty,
  builder: (options?: ISymbolGraphOptions) =>
    new SymbolGraphBuilder(options),
};

/** Mutable builder passed to scanners during the parse pass. */
export class SymbolGraphBuilder {
  private readonly state: IMutableSymbolGraph = newMutable();
  private readonly options: ISymbolGraphOptions;

  /**
   * @param options The options of the graph. The legacy global-name
   *                 lookup is off unless the caller asks for it.
   */
  constructor(options?: ISymbolGraphOptions) {
    this.options = options ?? {};
  }

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
    return finalize(this.state, this.options);
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

/**
 * The state behind a finished graph.
 *
 * It is what lets `removeLegacyGlobalNameLookup()` rebuild a graph
 * with the legacy fallback switched off, without the caller having
 * to rebuild the nodes.
 */
const STATES = new WeakMap<ISymbolGraph, IMutableSymbolGraph>();

/**
 * Whether the legacy global-name lookup may run for a graph.
 *
 * The lookup searches **every** file for a symbol with the imported
 * name. It was the behaviour of the graph before the import records
 * learned to name their destination, and it is a footgun: two
 * routers named `router` in two files both match, and the caller
 * picks one arbitrarily. It is off by default.
 */
function allowsGlobalSymbolLookup(options: ISymbolGraphOptions): boolean {
  return options.experimental?.allowGlobalSymbolLookup === true;
}

/**
 * Rebuild a graph without the legacy global-name lookup.
 *
 * The lookup is **removed by default**; this function is the
 * explicit way to switch it off on a graph that was built with
 * `experimental.allowGlobalSymbolLookup: true`.
 *
 * @param graph The graph to rebuild.
 * @returns      A graph with the same nodes and imports, whose
 *               `resolveByImportPath` no longer searches the whole
 *               project by name.
 */
export function removeLegacyGlobalNameLookup(graph: ISymbolGraph): ISymbolGraph {
  const state = STATES.get(graph);
  if (state === undefined) return graph;
  return finalize(state, { experimental: { allowGlobalSymbolLookup: false } });
}

function finalize(
  state: IMutableSymbolGraph,
  options?: ISymbolGraphOptions,
): ISymbolGraph {
  const nodes = Object.freeze(
    [...state.byFile.values()].flat().map((n) => Object.freeze(n)),
  );
  const imports = Object.freeze(
    [...state.importsByFile.values()].flat().map((i) => Object.freeze(i)),
  );
  const allowGlobalLookup = allowsGlobalSymbolLookup(options ?? {});
  const graph: ISymbolGraph = Object.freeze({
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
      // x00063: the import record may carry a `targetFile`
      // (resolved by the caller's import-resolver) and/or a
      // `targetSymbol` (the SymbolId of the destination binding).
      // Use them when present; fall back to the legacy
      // global-name search only when nothing was resolved.
      if (matching.targetSymbol) {
        const key = symbolIdToString(matching.targetSymbol);
        const direct = state.byFile.get(matching.targetSymbol.sourceFile);
        const found = direct?.find(
          (n) => symbolIdToString(n.id) === key,
        );
        return Object.freeze(found ? [found] : []);
      }
      if (matching.targetFile) {
        const bucket = state.byFile.get(matching.targetFile);
        if (!bucket) return Object.freeze([]);
        const out = bucket.filter(
          (n) => n.id.localName === matching.importedName,
        );
        return Object.freeze(out);
      }
      // Legacy fallback: search every other file for a node
      // with the right importedName. It only runs when the caller
      // asked for it (`experimental.allowGlobalSymbolLookup`), and
      // the answer it gives is a guess: two routers named
      // "router" in two files both match, and the caller picks
      // one arbitrarily — exactly the audit's "search globally"
      // footgun. Callers that know the destination should
      // populate `targetFile` / `targetSymbol` instead.
      if (!allowGlobalLookup) return Object.freeze([]);
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
  STATES.set(graph, state);
  return graph;
}
