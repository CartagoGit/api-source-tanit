import { createHash } from "node:crypto";

export interface ICanonicalSnapshot {
  readonly capturedAt: string;
  readonly formats: ReadonlyArray<string>;
  readonly services: ReadonlyArray<ICanonicalService>;
  readonly combinedExport?: ICombinedExport;
}

export interface ICombinedExport {
  readonly partial: boolean;
  readonly explanation: string;
  readonly services: ReadonlyArray<{ readonly serviceId: string; readonly reason: string }>;
  readonly operationRefs: Readonly<Record<string, { readonly serverRef?: string; readonly authRef?: string }>>;
}

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

export function canonicalSnapshotJson(snapshot: ICanonicalSnapshot): string {
  return JSON.stringify(canonicalize(snapshot));
}

export function snapshotSha256(snapshot: ICanonicalSnapshot): string {
  return createHash("sha256")
    .update(canonicalSnapshotJson(snapshot), "utf8")
    .digest("hex");
}

export function snapshotHashFromJson(json: string): string {
  return createHash("sha256").update(json, "utf8").digest("hex");
}