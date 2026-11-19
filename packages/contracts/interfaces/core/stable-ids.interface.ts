/** Stable identities used by durable state. Values are explicit and portable. */
export type StableIdKind =
  | "project"
  | "snapshot"
  | "service"
  | "operation"
  | "schema"
  | "server"
  | "auth";

export interface IStableId<K extends StableIdKind = StableIdKind> {
  readonly kind: K;
  readonly value: string;
}

export type ProjectId = IStableId<"project">;
export type SnapshotId = IStableId<"snapshot">;
export type ServiceId = IStableId<"service">;
export type OperationId = IStableId<"operation">;
export type SchemaId = IStableId<"schema">;
export type ServerRef = IStableId<"server">;
export type AuthRef = IStableId<"auth">;

export interface IStableIdFactory {
  project(seed: string): ProjectId;
  snapshot(seed: string): SnapshotId;
  service(seed: string): ServiceId;
  operation(seed: string): OperationId;
  schema(seed: string): SchemaId;
  serverRef(seed: string): ServerRef;
  authRef(seed: string): AuthRef;
}