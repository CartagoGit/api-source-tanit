/**
 * `ILocation` — where a node lives inside a source file.
 *
 * The one piece of geometry every language can answer without asking
 * questions: which file, which line, which column. A TypeScript
 * compiler reports `file:line:column`; a Python traceback reports
 * `file:line`; a Java stack trace reports `file:line`. The contract
 * asks for the three of them, and leaves the byte range optional
 * because not every frontend tracks it.
 *
 * Why it is its own contract and not a field repeated on every node:
 * a location is shared. A call expression, a symbol and a decorator
 * all point at the same coordinate space of the same file, and a
 * consumer that wants to report "line 42 of `routes.ts`" should not
 * have to know which of the three it is holding.
 *
 * ## The numbers
 *
 * - `line` is **1-based** — the first line of a file is line 1, the
 *   number a human reads in an editor and the number every compiler
 *   prints.
 * - `column` is **0-based** — the first character of a line is column
 *   0. Mixing conventions inside one contract is how "off by one"
 *   bugs are born, so the pair is fixed here: 1-based line, 0-based
 *   column, exactly like the ESTree convention every mainstream
 *   parser uses.
 *
 *   The column points at the **anchor** of the node: the thing that
 *   identifies it. For a declaration that is the name it introduces —
 *   the `A` of `class A` is at column 6, the `getUser` of
 *   `  getUser() {}` is at column 2. For a marker it is the name it
 *   carries — the `Get` of `@Get()`. For a call it is the expression
 *   being called.
 *
 *   Not the node that carries it: a decorated declaration *starts* at
 *   its decorator, and a consumer that positions by column would be
 *   sent to the `@` instead of to the name it is looking for. The
 *   anchor is the answer to "where is the thing I am looking for?",
 *   and that is the question a column is asked.
 * - `start` / `end` are **character offsets into the source**, `start`
 *   inclusive and `end` exclusive, so `source.slice(start, end)` is
 *   the text of the node. They are optional: a frontend that only
 *   knows the line (a regex-based one, or a linter that never slices
 *   the source) simply omits them.
 *
 * (r00020 S2 — LanguageIR agnostic foundation)
 */

export interface ILocation {
  /** Path of the file the node was read from. */
  readonly file: string;
  /** 1-based line of the node's anchor. */
  readonly line: number;
  /** 0-based column of the node's anchor. */
  readonly column: number;
  /**
   * Character offset of the first character of the node (inclusive).
   * Optional: not every frontend tracks byte ranges.
   */
  readonly start?: number;
  /**
   * Character offset just after the last character of the node
   * (exclusive). Optional, for the same reason as `start`.
   */
  readonly end?: number;
}
