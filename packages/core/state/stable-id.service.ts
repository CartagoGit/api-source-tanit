import { createHash } from "node:crypto";

import type {
  AuthRef,
  IStableId,
  IStableIdFactory,
  OperationId,
  ProjectId,
  SchemaId,
  ServerRef,
  ServiceId,
  SnapshotId,
  StableIdKind,
} from "../../contracts/interfaces/core/stable-ids.interface.js";

function makeId<K extends StableIdKind>(kind: K, seed: string): IStableId<K> {
  const value = createHash("sha256")
    .update(`${kind}\0${seed}`)
    .digest("hex")
    .slice(0, 32);
  return Object.freeze({ kind, value });
}

export class StableIdService implements IStableIdFactory {
  project(seed: string): ProjectId {
    return makeId("project", seed);
  }

  snapshot(seed: string): SnapshotId {
    return makeId("snapshot", seed);
  }

  service(seed: string): ServiceId {
    return makeId("service", seed);
  }

  operation(seed: string): OperationId {
    return makeId("operation", seed);
  }

  schema(seed: string): SchemaId {
    return makeId("schema", seed);
  }

  serverRef(seed: string): ServerRef {
    return makeId("server", seed);
  }

  authRef(seed: string): AuthRef {
    return makeId("auth", seed);
  }
}