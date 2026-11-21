/**
 * What changed between two revisions of a project.
 *
 * ## What it compares
 *
 * Two **canonical** snapshots — the projection that says what the API
 * surface was, without the thousand details that change every time
 * and mean nothing. The comparison is by service and by operation:
 *
 *   · a service that appears or disappears is **added** or
 *     **removed**;
 *   · a service whose framework, transports or base URL changed is
 *     **changed**, and the change says which of the three;
 *   · an operation whose method or path changed is **changed**;
 *   · an operation whose request or response changed is a **schema**
 *     change;
 *   · an operation whose authentication changed is an **auth** change.
 *
 * The last two are separate on purpose: a body that changed and a
 * token that changed are different facts, and a diff that merged them
 * would answer "something changed" to a question that had an answer.
 *
 * ## Why the comparison is pure
 *
 * Because it is the one thing about the history that must be right
 * whatever else is wrong: it reads two snapshots and says what is
 * different between them. It touches no disk, no session and no
 * clock, so the same two snapshots always produce the same diff — and
 * a diff that changed with the weather could not be trusted.
 */
import type { ICanonicalSnapshot } from "./snapshot-hash.service.js";
export type { IHistoryChange, IHistoryDiff, IHistoryRecord } from "../../contracts/interfaces/core/history.interface.js";
import type { IHistoryChange, IHistoryDiff } from "../../contracts/interfaces/core/history.interface.js";

/** A value, with its keys sorted, so two equal values look the same. */
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
