import { createHash } from "node:crypto";

import type {
  ICompleteProjectSnapshot,
  IProjectSnapshot,
} from "../../contracts/interfaces/core/project-state.interface.js";

const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|private[-_]?key|credential|authorization)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown, key?: string): unknown {
  if (key !== undefined && SECRET_KEY.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return items.every(isRecord)
      ? items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : items;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entry]) => [entryKey, canonicalize(entry, entryKey)]),
    );
  }
  return value;
}

interface ICanonicalSnapshot {
  readonly snapshot: IProjectSnapshot;
  readonly json: string;
  readonly digest: string;
}

export function canonicalSnapshotJson(snapshot: IProjectSnapshot): string {
  return JSON.stringify(canonicalize(snapshot));
}

export function canonicalSnapshotDigest(snapshot: IProjectSnapshot): string {
  return createHash("sha256").update(canonicalSnapshotJson(snapshot)).digest("hex");
}

export function serializeCanonicalSnapshot(snapshot: IProjectSnapshot): ICanonicalSnapshot {
  const json = canonicalSnapshotJson(snapshot);
  return Object.freeze({
    snapshot: JSON.parse(json) as IProjectSnapshot,
    json,
    digest: createHash("sha256").update(json).digest("hex"),
  });
}

export function parseCanonicalSnapshot(json: string): IProjectSnapshot {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || !isRecord(parsed.projectId) || !isRecord(parsed.snapshotId)) {
    throw new Error("Invalid canonical snapshot");
  }
  return parsed as unknown as ICompleteProjectSnapshot | IProjectSnapshot;
}