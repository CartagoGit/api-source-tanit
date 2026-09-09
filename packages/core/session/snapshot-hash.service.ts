import { createHash } from "node:crypto";
import type {
  ICanonicalSnapshot,
} from "../../contracts/interfaces/core/snapshot-hash.interface.js";

export type {
  ICanonicalOperation,
  ICanonicalService,
  ICanonicalSnapshot,
  ICombinedExport,
} from "../../contracts/interfaces/core/snapshot-hash.interface.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Serializa un snapshot con sus claves ordenadas de forma estable. */
export function canonicalSnapshotJson(snapshot: ICanonicalSnapshot): string {
  return JSON.stringify(canonicalize(snapshot));
}

/** Calcula el SHA-256 de la serialización canónica de un snapshot. */
export function snapshotSha256(snapshot: ICanonicalSnapshot): string {
  return createHash("sha256")
    .update(canonicalSnapshotJson(snapshot))
    .digest("hex");
}

/** Calcula el SHA-256 de un JSON canónico ya serializado. */
export function snapshotHashFromJson(json: string): string {
  return createHash("sha256").update(json).digest("hex");
}