/**
 * `SymbolId` + `SymbolKind` types (audit 2026-09-06 §12,
 * proposal `r00014`).
 *
 * Lives in `contracts` so the scanners' public `IScanResult`
 * can describe the graph it carries without depending on
 * the implementation in `packages/core/discovery/`.
 */
/** Discriminator so consumers don't confuse a router with a plugin. */
export type SymbolKind =
  | "value"
  | "type"
  | "router"
  | "plugin"
  | "sub-app"
  | "handler";

/**
 * Stable cross-file symbol identity. Anchored to the declaration
 * position so two `const router = …` in different files never
 * collide.
 */
export interface SymbolId {
  readonly sourceFile: string;
  readonly declarationStart: number;
  readonly localName: string;
}
