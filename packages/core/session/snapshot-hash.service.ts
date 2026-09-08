import { createHash } from "node:crypto";

/** Representación estable de un snapshot usada para serialización y hashing. */
export interface ICanonicalSnapshot {
  readonly capturedAt: string;
  readonly formats: ReadonlyArray<string>;
  readonly services: ReadonlyArray<ICanonicalService>;
  readonly combinedExport?: ICombinedExport;
}

/** Metadatos de una exportación combinada parcial o completa. */
export interface ICombinedExport {
  readonly partial: boolean;
  readonly explanation: string;
  readonly services: ReadonlyArray<{ readonly serviceId: string; readonly reason: string }>;
  readonly operationRefs: Readonly<Record<string, { readonly serverRef?: string; readonly authRef?: string }>>;
}

/** Representación canónica de un servicio y sus operaciones. */
export interface ICanonicalService {
  readonly serviceId: string;
  readonly framework: string;
  readonly transports: ReadonlyArray<string>;
  readonly auth: unknown;
  readonly baseUrl?: string;
  readonly serverRef?: string;
  readonly authRef?: string;
  readonly operations: ReadonlyArray<ICanonicalOperation>;
}

/** Representación canónica de una operación exportable. */
export interface ICanonicalOperation {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly requestSchema?: unknown;
  readonly responseSchema?: unknown;
  readonly auth?: unknown;
  readonly serverRef?: string;
  readonly authRef?: string;
}

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