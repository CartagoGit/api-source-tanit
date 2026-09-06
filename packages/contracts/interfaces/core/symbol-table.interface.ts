/**
 * Per-file router symbol table contract (`x00055` S1).
 *
 * Types live in `packages/contracts/` (§3.5 of the project bootstrap):
 * typing against this table must not drag the scanner implementation in.
 *
 * The implementation lives in
 * `packages/frameworks/scanners/express.symbol-table.ts`.
 */

/** One router declaration: `const X = Router({ prefix })` in `file`. */
export interface ISymbolTableEntry {
  /** File that declares the router (absolute or scanner-relative, as produced by the scan pass). */
  readonly file: string;
  /** Local binding name (`X`). */
  readonly localName: string;
  /**
   * Prefix from the `{ prefix: "..." }` argument, when present.
   * Absent = the declaration carried no prefix argument (NOT the same as
   * an explicitly declared `""`).
   */
  readonly prefix?: string;
  /** Byte offset of the declaration — the `SymbolId` anchor (r00014). */
  readonly declarationStart: number;
}

/**
 * Declarations keyed by file, then by local name.
 *
 * The two-level map is the fix for the `x00055` collision: a
 * `Map<string, prefix>` collapses two same-named routers in two files; a
 * per-file bucket keeps them apart.
 */
export interface ISymbolTable {
  readonly byFile: ReadonlyMap<string, ReadonlyMap<string, ISymbolTableEntry>>;
}
