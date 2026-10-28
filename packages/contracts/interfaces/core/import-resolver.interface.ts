/**
 * Import resolver contract (audit 2026-09-06 §12,
 * proposal `r00014` S2).
 *
 * The implementation lives in
 * `packages/core/discovery/import-resolver.ts`. The contract lives
 * here so other frontends (Python, Go, Rust, …) can publish
 * candidates with the same shape.
 *
 * One candidate the resolver can return.
 *
 * - `path`: posix-shaped path. Always starts with `/` when the
 *   input `fromFile` was absolute.
 * - `kind`: why this candidate was generated (extension
 *   fallback, `/index.{ext}` fallback, or literal). The caller
 *   can decide to log a warning for, say, a `/index.js`
 *   fallback in a TS project.
 */
export interface IImportCandidate {
  /** Absolute, posix-separated path. */
  readonly path: string;
  readonly kind: "literal" | "extension-fallback" | "index-fallback";
}
