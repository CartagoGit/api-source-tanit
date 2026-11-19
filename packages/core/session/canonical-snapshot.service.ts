/**
 * The canonical projection of a project snapshot.
 *
 * ## What this is
 *
 * A snapshot (`IProjectSnapshot`) carries everything the pipeline
 * produced: the generated collection, every endpoint with its
 * schemas and its inferred responses, the routes, the configuration,
 * the warnings. It is **big** and it is **not comparable**: two
 * snapshots of the same project differ in a thousand places that
 * mean nothing (the session id, the capture time, the order of a
 * list).
 *
 * The canonical snapshot is the **projection** that answers one
 * question: *what is the API surface, and how did it change?* It
 * keeps the service identity, the transports, the authentication, and
 * one entry per operation — and nothing else.
 *
 * ## Why it had to be written
 *
 * `diffSnapshots()` and `snapshotSha256()` were written and tested
 * against this shape, and **nothing ever produced it**: the recorder
 * took an `ICanonicalSnapshot` that no caller could build. The
 * contract existed, the diff existed, and the two were never joined —
 * so the "persisted history" was a shape and a comparison, with no
 * history to compare.
 *
 * This is the join. The projection is deterministic: the same
 * snapshot always yields the same canonical snapshot, and therefore
 * the same hash.
 */
import type { IGenerationResult } from "../../contracts/interfaces/core/discovery.interface.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/endpoint-legacy.interface.js";
import type { IAuthRef } from "../../contracts/interfaces/core/auth-ref.interface.js";
import type { IServerRef } from "../../contracts/interfaces/core/server-ref.interface.js";
import type { IProjectSnapshot } from "../../contracts/interfaces/core/session.interface.js";
import type {
  ICanonicalOperation,
  ICanonicalService,
  ICanonicalSnapshot,
} from "../../contracts/interfaces/core/snapshot-hash.interface.js";

/** The key of the collection variable that holds the base URL. */
const BASE_URL_VARIABLE = "baseUrl";

/**
 * The name of an operation, used as its identity.
 *
 * The **name**, not the method and the path: an operation whose path
 * changed is the *same* operation that moved, and a diff that said
 * "removed one, added another" would hide the only thing that
 * matters. When the endpoint has no name, the method and the path
 * are the identity — and a moved operation then reads as two, which
 * is the honest answer for an endpoint nobody named.
 */
function operationIdOf(spec: EndpointSpec): string {
  return spec.name.trim() === "" ? `${spec.method} ${spec.uri}` : spec.name;
}

/** The transports a service speaks, sorted and without duplicates. */
function transportsOf(specs: ReadonlyArray<EndpointSpec>): ReadonlyArray<string> {
  const transports = new Set<string>();
  for (const spec of specs) transports.add(spec.transport ?? "http");
  return [...transports].sort();
}

/** The base URL the collection declares, when it declares one. */
function baseUrlOf(result: IGenerationResult): string | undefined {
  const variable = result.collection.variable.find((entry) => entry.key === BASE_URL_VARIABLE);
  return variable === undefined ? undefined : variable.value;
}

/**
 * The id of the server an operation talks to.
 *
 * The canonical snapshot keeps the **id**, not the whole reference:
 * the id is what says "the same server as before", and a URL that
 * changed does not make it a different server.
 */
function serverRefId(ref: IServerRef | undefined): string | undefined {
  return ref === undefined ? undefined : String(ref.id);
}

/**
 * The id of the authentication an operation uses.
 *
 * For the same reason as the server: the identity, not the shape.
 */
function authRefId(ref: IAuthRef | undefined): string | undefined {
  return ref === undefined ? undefined : String(ref.id);
}

/** One operation, in the shape the diff compares. */
function toCanonicalOperation(spec: EndpointSpec): ICanonicalOperation {
  return {
    operationId: operationIdOf(spec),
    method: spec.method,
    path: spec.uri,
    // The request the endpoint takes: its schema when the scanner
    // built one, the raw body when it did not. Either is "what the
    // caller has to send", and that is what changed when it changed.
    requestSchema: spec.schemaGraph ?? spec.body,
    // The answers the endpoint gives, with their statuses. The
    // inferrer fills this in; an endpoint nobody inferred keeps its
    // absence, which is itself a difference worth showing.
    responseSchema: spec.responses,
    auth: spec.auth,
    serverRef: serverRefId(spec.serverRef),
    authRef: authRefId(spec.authRef),
  };
}

/** One service, in the shape the diff compares. */
function toCanonicalService(result: IGenerationResult): ICanonicalService {
  return {
    serviceId: result.serviceId ?? "default",
    framework: result.match?.framework ?? "unknown",
    transports: transportsOf(result.specs),
    // The detected scheme **with its evidence**: an automatic
    // detection that cannot be cross-checked has to be trusted
    // blindly, and the diff says when that trust changed.
    auth: result.authScheme,
    baseUrl: baseUrlOf(result),
    serverRef: serverRefId(result.specs[0]?.serverRef),
    authRef: authRefId(result.specs[0]?.authRef),
    operations: result.specs.map(toCanonicalOperation),
  };
}

/**
 * The canonical snapshot of a project snapshot.
 *
 * The capture time is the snapshot's own, in ISO 8601: it is what
 * makes two records of the same project different records instead of
 * one.
 */
export function toCanonicalSnapshot(snapshot: IProjectSnapshot): ICanonicalSnapshot {
  return {
    capturedAt: snapshot.capturedAt.toISOString(),
    formats: [],
    services: snapshot.results.map(toCanonicalService),
  };
}
