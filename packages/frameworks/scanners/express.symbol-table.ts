/**
 * `express.symbol-table.ts` — minimal per-file router SymbolTable for the
 * Express scanner (`x00055` S1).
 *
 * ## Why this exists
 *
 * `x00055`'s original bug: two files can declare `const router = Router()`
 * each, and the scanner's legacy `Map<routerName, prefix>` collapses them
 * into one entry — the last file wins. A route declared on `users/router.ts`'s
 * `router` could inherit the prefix declared in `admin/router.ts`'s `router`.
 *
 * The cross-file fix lives in `r00014` / `x00055` S2 (SymbolGraph +
 * `mountPrefixOf`). But the graph needs a **per-file table of declarations**
 * to consume, and the scanner's legacy maps cannot provide one because they
 * already lost the file dimension.
 *
 * This module is that table: for every scanned file it records each router
 * declaration (`const X = Router()` / `express.Router()` / `Router({ prefix })`)
 * **keyed by the file that declares it**. Two same-named routers in two files
 * are two distinct rows — never collapsed.
 *
 * ## Scope (S1 only)
 *
 * - Collect: declarations per file, including their `{ prefix }` argument
 *   when present.
 * - Query: `prefixOf(file, localName)` — exact file + name lookup.
 *
 * NOT in scope here: resolving `import { router } from "./users/router"` to
 * the destination file (that is S2's `mountPrefixOf`, on top of the
 * `SymbolGraph` from `r00014`). The table is the per-file ground truth the
 * resolver will consume.
 *
 * ## Shape
 *
 * Deliberately a plain frozen structure (not a class with mutable state):
 * the scanner is stateless across `scan()` calls (a00010 S2), and the table
 * is one of the artifacts of the result, like `routes` or `symbols`.
 */
import type {
  IMutableSymbolTable,
  ISymbolTable,
  ISymbolTableEntry,
} from "../../contracts/interfaces/core/symbol-table.interface.js";

/** Empty table — every `scan()` starts here. */
export function emptySymbolTable(): IMutableSymbolTable {
  return { byFile: new Map() };
}

/**
 * Register one router declaration.
 *
 * Idempotent per `(file, localName)`: re-registering the same declaration
 * (e.g. the scanner re-walking the same module) replaces the entry instead
 * of duplicating it. A different `(file, localName)` never collides — that
 * is the whole point of the table.
 */
export function registerRouter(
  table: IMutableSymbolTable,
  entry: ISymbolTableEntry,
): void {
  const fileBucket = table.byFile.get(entry.file) ?? new Map();
  fileBucket.set(entry.localName, entry);
  table.byFile.set(entry.file, fileBucket);
}

/**
 * Prefix declared for `localName` in exactly `file`.
 *
 * Returns `undefined` when either the file or the name is unknown, or when
 * the declaration carried no `{ prefix }` argument. Callers must distinguish
 * `undefined` (unknown / no prefix) from `""` (explicitly declared empty
 * prefix) — the resolver in S2 treats both as "no prefix" but keeps the
 * distinction for diagnostics.
 */
export function prefixOf(
  table: ISymbolTable,
  file: string,
  localName: string,
): string | undefined {
  return table.byFile.get(file)?.get(localName)?.prefix;
}

/**
 * All router names declared in one file, sorted for deterministic output.
 * Used by tests and by the S2 resolver's diagnostics.
 */
export function routerNamesInFile(
  table: ISymbolTable,
  file: string,
): ReadonlyArray<string> {
  const bucket = table.byFile.get(file);
  if (!bucket) return [];
  return [...bucket.keys()].sort();
}

/**
 * Populate the table from one parsed module.
 *
 * `routerDeclarations` comes from the scanner's AST pass: it walks
 * `ast.assignments` whose value is a call to `Router(...)` /
 * `express.Router(...)` — the same shape the legacy `routerPrefixes` map
 * consumed, but keeping the file and the declaration offset so entries
 * never collide.
 *
 * `declarationStart` is the byte offset of the assignment: the same anchor
 * `makeSymbolId` uses, so S2 can join a table row to its SymbolGraph node
 * without a second lookup convention.
 */
export function populateFromModule(
  table: IMutableSymbolTable,
  input: {
    readonly file: string;
    readonly declarations: ReadonlyArray<{
      readonly localName: string;
      readonly prefix?: string;
      readonly declarationStart: number;
    }>;
  },
): void {
  for (const d of input.declarations) {
    registerRouter(table, {
      file: input.file,
      localName: d.localName,
      ...(d.prefix !== undefined ? { prefix: d.prefix } : {}),
      declarationStart: d.declarationStart,
    });
  }
}

/** Frozen view for tests / consumers outside the scanner. */
export function freezeSymbolTable(
  table: ISymbolTable,
): ISymbolTable {
  const frozen: IMutableSymbolTable = { byFile: new Map() };
  for (const [file, bucket] of table.byFile) {
    frozen.byFile.set(file, new Map(bucket));
  }
  return Object.freeze(frozen) as ISymbolTable;
}
