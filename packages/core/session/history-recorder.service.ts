import type { ICanonicalSnapshot } from "./snapshot-hash.service.js";
import { canonicalSnapshotJson, snapshotSha256 } from "./snapshot-hash.service.js";

/** Registro persistible de un snapshot emitido por una sesión. */
export interface IHistoryRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly formats: ReadonlyArray<string>;
  readonly count: number;
  readonly output: string;
  readonly sha256: string;
  readonly provenance: {
    readonly source: "scan" | "import" | "restore" | "export";
    readonly projectRoot?: string;
    readonly parentId?: string;
  };
  readonly snapshot: ICanonicalSnapshot;
  readonly configuration: Readonly<Record<string, unknown>>;
}

/** Diferencias estructurales entre dos snapshots del historial. */
export interface IHistoryDiff {
  readonly services: ReadonlyArray<string>;
  readonly operations: ReadonlyArray<string>;
  readonly added: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly schemaChanges: ReadonlyArray<IHistoryChange>;
  readonly authChanges: ReadonlyArray<IHistoryChange>;
  readonly serviceChanges: ReadonlyArray<IHistoryChange>;
  readonly operationChanges: ReadonlyArray<IHistoryChange>;
  readonly configuration?: { readonly before?: unknown; readonly after?: unknown };
}

/** Cambio individual incluido en un diff de historial. */
export interface IHistoryChange { readonly key: string; readonly serviceId: string; readonly operationId?: string; readonly before?: unknown; readonly after?: unknown; }

function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)));
  });
}

/** Compara dos snapshots y clasifica sus cambios de servicios y operaciones. */
export function diffSnapshots(
  left: ICanonicalSnapshot,
  right: ICanonicalSnapshot,
  leftConfiguration?: Readonly<Record<string, unknown>>,
  rightConfiguration?: Readonly<Record<string, unknown>>,
): IHistoryDiff {
  const leftServices = new Map(left.services.map((service) => [service.serviceId, service]));
  const rightServices = new Map(right.services.map((service) => [service.serviceId, service]));
  const services = new Set<string>();
  const operations = new Set<string>();
  const added = new Set<string>();
  const removed = new Set<string>();
  const changed = new Set<string>();
  const schemaChanges = new Set<string>();
  const authChanges = new Set<string>();
  const serviceChanges: IHistoryChange[] = [];
  const operationChanges: IHistoryChange[] = [];
  const schemaChangeDetails: IHistoryChange[] = [];
  const authChangeDetails: IHistoryChange[] = [];

  for (const serviceId of new Set([...leftServices.keys(), ...rightServices.keys()])) {
    const before = leftServices.get(serviceId);
    const after = rightServices.get(serviceId);
    if (!before) { services.add(serviceId); added.add(`service:${serviceId}`); continue; }
    if (!after) { services.add(serviceId); removed.add(`service:${serviceId}`); continue; }
    if (fingerprint({ framework: before.framework, transports: before.transports, baseUrl: before.baseUrl }) !== fingerprint({ framework: after.framework, transports: after.transports, baseUrl: after.baseUrl })) {
      services.add(serviceId); changed.add(`service:${serviceId}`); serviceChanges.push({ key: `service:${serviceId}`, serviceId, before: { framework: before.framework, transports: before.transports, baseUrl: before.baseUrl }, after: { framework: after.framework, transports: after.transports, baseUrl: after.baseUrl } });
    }
    if (fingerprint(before.auth) !== fingerprint(after.auth)) { authChanges.add(`service:${serviceId}`); authChangeDetails.push({ key: `service:${serviceId}`, serviceId, before: before.auth, after: after.auth }); }
    const beforeOperations = new Map(before.operations.map((operation) => [operation.operationId, operation]));
    const afterOperations = new Map(after.operations.map((operation) => [operation.operationId, operation]));
    for (const operationId of new Set([...beforeOperations.keys(), ...afterOperations.keys()])) {
      const beforeOperation = beforeOperations.get(operationId);
      const afterOperation = afterOperations.get(operationId);
      const key = `operation:${serviceId}/${operationId}`;
      operations.add(key);
      if (!beforeOperation) { added.add(key); continue; }
      if (!afterOperation) { removed.add(key); continue; }
      if (fingerprint({ method: beforeOperation.method, path: beforeOperation.path }) !== fingerprint({ method: afterOperation.method, path: afterOperation.path })) { changed.add(key); operationChanges.push({ key, serviceId, operationId, before: { method: beforeOperation.method, path: beforeOperation.path }, after: { method: afterOperation.method, path: afterOperation.path } }); }
      if (fingerprint({ request: beforeOperation.requestSchema, response: beforeOperation.responseSchema }) !== fingerprint({ request: afterOperation.requestSchema, response: afterOperation.responseSchema })) { schemaChanges.add(key); schemaChangeDetails.push({ key, serviceId, operationId, before: { request: beforeOperation.requestSchema, response: beforeOperation.responseSchema }, after: { request: afterOperation.requestSchema, response: afterOperation.responseSchema } }); }
      if (fingerprint(beforeOperation.auth) !== fingerprint(afterOperation.auth)) { authChanges.add(key); authChangeDetails.push({ key, serviceId, operationId, before: beforeOperation.auth, after: afterOperation.auth }); }
    }
  }
  return {
    services: [...services].sort(), operations: [...operations].sort(), added: [...added].sort(),
    removed: [...removed].sort(), changed: [...changed].sort(),
    authChanges: authChangeDetails.sort((left, right) => left.key.localeCompare(right.key)),
    serviceChanges: serviceChanges.sort((left, right) => left.key.localeCompare(right.key)),
    operationChanges: operationChanges.sort((left, right) => left.key.localeCompare(right.key)),
    schemaChanges: schemaChangeDetails.sort((left, right) => left.key.localeCompare(right.key)),
    configuration: { before: leftConfiguration ?? {}, after: rightConfiguration ?? {} },
  };
}

/** Mantiene registros de snapshots y sus configuraciones por proyecto. */
export class HistoryRecorderService {
  private readonly records = new Map<string, IHistoryRecord[]>();

  record(
    projectRoot: string,
    snapshot: ICanonicalSnapshot,
    options: {
      readonly formats?: ReadonlyArray<string>;
      readonly output?: string;
      readonly source?: IHistoryRecord["provenance"]["source"];
      readonly parentId?: string;
      readonly configuration?: Readonly<Record<string, unknown>>;
    } = {},
  ): IHistoryRecord {
    const timestamp = snapshot.capturedAt;
    const output = options.output ?? "";
    const record: IHistoryRecord = {
      id: `${timestamp}-${snapshotSha256(snapshot).slice(0, 12)}`,
      timestamp,
      formats: [...(options.formats ?? snapshot.formats)].sort(),
      count: snapshot.services.reduce((total, service) => total + service.operations.length, 0),
      output,
      sha256: snapshotSha256(snapshot),
      provenance: {
        source: options.source ?? "scan",
        projectRoot,
        parentId: options.parentId,
      },
      configuration: { ...(options.configuration ?? {}) },
      snapshot,
    };
    const records = this.records.get(projectRoot) ?? [];
    records.push(record);
    this.records.set(projectRoot, records);
    return record;
  }

  list(projectRoot: string): ReadonlyArray<IHistoryRecord> {
    return [...(this.records.get(projectRoot) ?? [])].sort((left, right) =>
      right.timestamp.localeCompare(left.timestamp),
    );
  }

  get(projectRoot: string, id: string): IHistoryRecord | undefined {
    return this.records.get(projectRoot)?.find((record) => record.id === id);
  }

  compare(projectRoot: string, leftId: string, rightId: string): IHistoryDiff {
    const left = this.get(projectRoot, leftId);
    const right = this.get(projectRoot, rightId);
    if (!left || !right) throw new Error("Both history records are required for comparison");
    return diffSnapshots(left.snapshot, right.snapshot, left.configuration, right.configuration);
  }

  serialize(record: IHistoryRecord): string {
    return canonicalSnapshotJson(record.snapshot);
  }
}