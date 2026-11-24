/**
 * What makes two endpoints the same endpoint.
 *
 * This question was answered in three places, in three different ways:
 *
 * | Where | Formula |
 * |---|---|
 * | Pipeline's `dedupeSpecs` | `` `${method} ${uri} ${name}` `` |
 * | Collection invariants | `` `${method} ${raw}` `` (+ body) |
 * | `check` (`diff.script.ts`) | `` `${method} ${normalized}` `` (+ name) |
 *
 * And the same bug bit **four times**, always for assuming that the URL
 * identifies the operation. That holds in REST and not in GraphQL or
 * tRPC, where there is **one** endpoint — `POST /graphql` — and what
 * distinguishes one query from another is the name:
 *
 *   1. `dedupeSpecs` made a whole schema produce a single request.
 *   2. The invariants warned about the other four as duplicates.
 *   3. `check` counted 1 path of 5, so it did not detect any drift:
 *      if four operations disappeared from the code, it still said
 *      1 against 1 and gave the green light.
 *   4. The OpenAPI scanner invented `__params`, leaked through `as any`,
 *      because a path had no way of saying which scanner it came from.
 *
 * The first three were patched one by one. Three appearances of the
 * same bug are not three slip-ups: they are a missing piece. This is
 * the piece.
 *
 * ## Where it is NOT used, and why
 *
 * In the duplicate check of `collection-invariants.helper.ts`. It is
 * not an oversight: it asks **another question**.
 *
 * Here we compare the code with the collection, and for that we need
 * to normalize — `/users/{id}` in code and `/users/{{userId}}` in the
 * collection are the same endpoint. The invariants compare the
 * collection with itself, where the normalization brings nothing and
 * actually **subtracts**: it collapses the parameter name to `:p`, so
 * `/search/{{historic}}` and `/search/{{plate}}` — two distinct
 * endpoints that Laravel separates with a `where()`, and that
 * `uri.helper` documents as the known edge case — would warn as
 * duplicates.
 *
 * A false warning in an invariant is worse than not having one,
 * because the next person who sees it, accusing without cause, stops
 * reading them. Putting both questions in one function so the
 * duplicate count would go down would have been the wrong abstraction.
 */
import { normalizeForComparison } from "./uri.helper.js";
import type { IEndpointIdentity } from "../../contracts/interfaces/core/helpers.interface.js";

/**
 * The key of an operation. Same operation, same key.
 *
 * The URI is always normalized, so `/api/users` and `api/users` are not
 * counted as two. The name and body only enter when present: adding
 * them empty would make a route with a name and the same one without
 * it stop matching, which is the opposite of what we want.
 */
export function endpointKey(identity: IEndpointIdentity): string {
  const method = identity.method.toUpperCase();
  const uri = normalizeForComparison(identity.uri);
  // Audit 2nd review #3: in monorepos, two endpoints with the same
  // METHOD+URI but different `serviceId` (workspace) are NOT the same
  // operation. We include `serviceId` in the key when present (a
  // multi-workspace monorepo); flat projects leave it empty and keep
  // colliding as before.
  const serviceId = identity.serviceId ?? "";
  let key = `${serviceId}::${method} ${uri}`;
  if (identity.name !== undefined && identity.name !== "") {
    key += ` ${identity.name}`;
  }
  if (identity.body !== undefined && identity.body !== "") {
    key += ` ${identity.body}`;
  }
  return key;
}

/**
 * How an operation is called when it has to be shown to someone.
 *
 * `POST /graphql` repeated three times says nothing: the name is needed
 * to know which one is missing. This is what turns a list of three
 * identical lines into a useful list.
 */
export function describeEndpoint(identity: IEndpointIdentity): string {
  const base = `${identity.method.toUpperCase()} ${identity.uri}`;
  return identity.name !== undefined && identity.name !== ""
    ? `${base}  (${identity.name})`
    : base;
}

/**
 * Does this protocol distinguish operations by name?
 *
 * It is not a list of frameworks: it is a property of the routes that
 * arrive. If several share method and URI, the name is the only thing
 * left — and it does not matter whether it is GraphQL, tRPC, or a
 * hand-written JSON-RPC. Asking this way avoids a list that has to be
 * maintained every time a new framework is supported.
 */
export function needsNameToDisambiguate(
  routes: ReadonlyArray<IEndpointIdentity>,
): boolean {
  const sinNombre = new Set<string>();
  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${normalizeForComparison(route.uri)}`;
    if (sinNombre.has(key)) return true;
    sinNombre.add(key);
  }
  return false;
}
