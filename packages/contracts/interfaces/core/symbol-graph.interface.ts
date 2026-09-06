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
import type { SymbolKind } from "./symbol-id.interface.js";

/**
 * Stable cross-file symbol identity. Anchored to the
 * declaration position so two `const router = …` in
 * different files never collide.
 */
export interface SymbolId {
  readonly sourceFile: string;
  readonly declarationStart: number;
  readonly localName: string;
}

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
 */
export interface IImportRecord {
  readonly sourceFile: string;
  readonly specifier: string;
  readonly localName: string;
  readonly importedName: string;
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
