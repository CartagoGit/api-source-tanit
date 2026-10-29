/**
 * `SymbolGraph` contract mirror (audit 2026-09-06 §12,
 * proposal `r00014`).
 *
 * The implementation lives in `packages/core/discovery/
 * symbol-graph.ts`. The contract lives here so scanners
 * (`scan-result.symbols`) and consumers (exporters,
 * validation providers) can depend on **types only** —
 * matching how `ISchemaGraph` is published.
 */
import type { SymbolKind, SymbolId } from "./symbol-id.interface.js";

/** One symbol in the graph. */
export interface ISymbolNode {
  readonly id: SymbolId;
  readonly kind: SymbolKind;
  /** Opaque framework-specific data (`/users` prefix for routers, …). */
  readonly payload?: unknown;
}

/**
 * Import edge — `import { router as usersRouter } from
 * "./users/routes"`.
 *
 * x00063 adds two optional fields that close the cross-file
 * "search every file" ambiguity in `SymbolGraph.resolveByImportPath()`:
 *
 * - `targetFile`: the **resolved** destination file, picked by
 *   the import resolver (with the `.ts/.tsx/.js` extension
 *   fallback and the `index.{ext}` fallback). When `null`, the
 *   resolver returned no concrete file (e.g. `node_modules`,
 *   a misspelling). The SymbolGraph then falls back to the
 *   legacy global-name search for backwards compatibility.
 * - `targetSymbol`: the SymbolId of the destination binding,
 *   already resolved. When set, the SymbolGraph skips the
 *   lookup entirely.
 *
 * Both fields are populated by `SymbolGraphBuilder.addImport()`
 * when the caller passes them in (the express scanner already
 * uses the import-resolver to compute them; the SymbolGraph
 * generic path now consumes the same output).
 */
export interface IImportRecord {
  readonly sourceFile: string;
  readonly specifier: string;
  readonly localName: string;
  readonly importedName: string;
  /** Resolved target file (x00063), or `null` when unresolvable. */
  readonly targetFile?: string | null;
  /** Resolved target SymbolId (x00063), or `null` when unresolvable. */
  readonly targetSymbol?: SymbolId | null;
}

/** Frozen, queryable symbol graph. */
export interface ISymbolGraph {
  readonly nodes: ReadonlyArray<ISymbolNode>;
  readonly imports: ReadonlyArray<IImportRecord>;
  /**
   * Look up nodes by name in a single file. Used by the
   * scanner's intra-file pass; cross-file flows go
   * through `resolveByImportPath`.
   */
  resolveByName(
    sourceFile: string,
    localName: string,
  ): ReadonlyArray<ISymbolNode>;
  /**
   * Follow an import edge:
   *
   *   `import { usersRouter } from "./users/routes"`
   *
   * → find the node(s) in the **destination file** whose
   * `localName` matches the imported symbol's name.
   *
   * Returns `[]` when the specifier is not registered or
   * the destination has no matching node. Never throws.
   */
  resolveByImportPath(
    sourceFile: string,
    specifier: string,
    localName: string,
  ): ReadonlyArray<ISymbolNode>;
}

/**
 * The options a graph is built with.
 *
 * `experimental.allowGlobalSymbolLookup` decides whether the legacy
 * "look the symbol up by name in **every** file" fallback is
 * allowed. It is `false` by default, and that is the point: the
 * fallback answers a question the caller did not ask ("which of the
 * two routers named `router` did you mean?") and answers it by
 * returning both.
 *
 * The flag exists for the callers that genuinely cannot name the
 * destination file — a project that imports a symbol from a
 * package the resolver does not know how to follow, for instance.
 * See `docs/MODULE-RESOLUTION.md` for the case and the cost.
 */
export interface ISymbolGraphOptions {
  readonly experimental?: {
    /** Allow the legacy global-name lookup. Defaults to `false`. */
    readonly allowGlobalSymbolLookup?: boolean;
  };
}
