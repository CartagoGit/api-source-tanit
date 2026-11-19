/**
 * Host config AST parser contract (`c00010` S1 traceability,
 * proposal `x00058`).
 *
 * The implementation lives in
 * `packages/core/discovery/host-config-parser.service.ts`. The
 * contract lives here so MCP tools and exporters can describe
 * the parser's outputs without dragging in `@babel/parser`.
 *
 * The result is a discriminated union: success carries `value`,
 * failure carries a list of `IHostConfigDiagnostic` so the caller
 * can render a structured error to a user/agent without
 * catching exceptions.
 */

/** What kind of object the parser is reading. */
export type HostConfigKind = "project-config" | "manual-endpoints";

/** Diagnostic the parser can produce for a parse failure. */
export interface IHostConfigDiagnostic {
  readonly kind:
    | "syntax-error"
    | "missing-export"
    | "unsupported-expression"
    | "type-mismatch";
  readonly file: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly message: string;
  readonly hint?: string;
}

/** Result of parsing a single host file. */
export type HostConfigParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: ReadonlyArray<IHostConfigDiagnostic> };
