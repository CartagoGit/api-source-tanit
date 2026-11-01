/**
 * `SymbolId` helper (audit 2026-09-06 §12, proposal `r00014`
 * S1).
 *
 * A `SymbolId` is the **stable identity** of a symbol in
 * Tanit's cross-file resolver. Identity is anchored to the
 * declaration position, not to the textual name — two
 * `const router = …` declarations in different files have the
 * same `localName === "router"` but different `SymbolId`s.
 *
 * Stability is important: every cross-file reference the
 * scanners carry in their aux maps (Express router prefix,
 * Fastify plugin prefix, Hono sub-app mount) keys on
 * `SymbolId`, so the key never collides across files even when
 * the local name is the same.
 *
 * The interface itself lives in
 * `packages/contracts/interfaces/core/symbol-id.interface.ts`
 * (the canonical contract); this module owns the constructor
 * and the string form so callers keep importing them from
 * `./symbol-id.js`.
 */
export type { SymbolId } from "../../contracts/interfaces/core/symbol-id.interface.js";

import type { SymbolId } from "../../contracts/interfaces/core/symbol-id.interface.js";

/**
 * Build a `SymbolId`. Not much code on purpose — centralising
 * the construction lets the resolver assert invariants (non-empty
 * `sourceFile`, non-negative offset, non-empty `localName`)
 * from a single place instead of every scanner duplicating the
 * checks.
 */
export function makeSymbolId(
  sourceFile: string,
  declarationStart: number,
  localName: string,
): SymbolId {
  if (sourceFile.length === 0) {
    throw new Error("SymbolId: sourceFile is empty");
  }
  if (!Number.isFinite(declarationStart) || declarationStart < 0) {
    throw new Error(
      `SymbolId: declarationStart must be a non-negative finite number, got ${declarationStart}`,
    );
  }
  if (localName.length === 0) {
    throw new Error("SymbolId: localName is empty");
  }
  return Object.freeze({ sourceFile, declarationStart, localName });
}

/** Serialise a `SymbolId` to a stable string (file:offset:local). */
export function symbolIdToString(id: SymbolId): string {
  return `${id.sourceFile}:${id.declarationStart}:${id.localName}`;
}

/**
 * Parse a string produced by `symbolIdToString`. Inverse
 * operation; returns `null` when the input isn't shaped like
 * a serialised `SymbolId`.
 */
export function parseSymbolId(serialized: string): SymbolId | null {
  const lastColon = serialized.lastIndexOf(":");
  if (lastColon < 1) return null;
  const localName = serialized.slice(lastColon + 1);
  if (localName.length === 0) return null;
  const head = serialized.slice(0, lastColon);
  const headLastColon = head.lastIndexOf(":");
  if (headLastColon < 1) return null;
  const sourceFile = head.slice(0, headLastColon);
  const offsetStr = head.slice(headLastColon + 1);
  const declarationStart = Number.parseInt(offsetStr, 10);
  if (!Number.isFinite(declarationStart)) return null;
  if (sourceFile.length === 0) return null;
  return makeSymbolId(sourceFile, declarationStart, localName);
}
