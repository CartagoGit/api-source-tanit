/**
 * Filters the global `discovery.specs` down to the specs that belong
 * to a single `IServiceDescriptor`. x00028.
 *
 * Why it exists
 * - `discoverSpecs()` produces `IDiscovery.specs` as a **global
 *   catalog**: every scanner's specs, already merged across
 *   frameworks, are flattened into one array. Before x00028, every
 *   call to `buildForService()` did
 *
 *       const specs = [...discovery.specs];
 *
 *   meaning every service saw the **same** catalog. In a monorepo
 *   `apps/users` + `apps/orders`, both services saw both `GET
 *   /health`s and both `/users` and `/orders` endpoints, regardless
 *   of which workspace they belonged to. The resulting collections
 *   had duplicated endpoints and crossed `baseUrl` / `auth`.
 *
 * - `IServiceDescriptor.endpoints` is the **per-service route list**,
 *   already attributed correctly: each scanner knows the routes it
 *   emitted, `accumulateRoutesByService` (x00025) groups them by
 *   `serviceId`, and `toServiceGraph` builds one descriptor per
 *   service. The descriptor's `endpoints` is the only authoritative
 *   source of "what belongs to this service".
 *
 * The fix
 * - This helper turns the per-service route list into a Set of
 *   `(method, uri)` tuples (the stable identity for filtering,
 *   shared with x00025's dedupe key minus `sourceFile` which is not
 *   available on `EndpointSpec`) and returns the subset of
 *   `discovery.specs` whose `(method, uri)` is in the set.
 *
 *   `sourceFile` is intentionally NOT part of the filter identity
 *   here: `EndpointSpec` does not carry it (the scanner merges
 *   multi-source occurrences into one spec), so the filter is on the
 *   spec level, not the route level. Two services that share `(method,
 *   uri)` because of an upstream merger bug will still produce two
 *   filtered specs — that's the merger's job to deduplicate, not
 *   this helper's.
 *
 * - When `service.endpoints` is empty (the legacy single-service
 *   path, where `toServiceGraph` produces one descriptor with
 *   `endpoints: discovery.routes`), the helper returns **all** specs:
 *   the single service is the project, so the global catalog IS the
 *   per-service catalog. The 21 examples rely on this — they are
 *   flat projects and have a single service.
 *
 * Contract
 * - Pure: no disk, no `process.*`, no mutation.
 * - Order preserved: the filtered array is in the same order as the
 *   input `discovery.specs` (callers rely on that order for
 *   collection folder grouping).
 * - Set membership is O(1); total cost is O(|specs|) instead of
 *   O(|specs| * |endpoints|).
 *
 * Test surface
 * - `tests/core/filter-specs-for-service.spec.ts` covers:
 *    1. Single-service: full catalog returned.
 *    2. Two services with disjoint endpoints: each gets only its own.
 *    3. Two services with the same `(method, uri)` (e.g.
 *       `apps/users` and `apps/orders` both `GET /health`): each
 *       gets the spec — the merger is responsible for not
 *       double-emitting.
 *    4. Empty service.endpoints (legacy path): full catalog returned.
 *    5. Order preserved.
 *    6. Specs with `name` overrides survive filtering (the helper
 *       doesn't accidentally drop them).
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { ParsedRoute } from "../../contracts/interfaces/core/scanner.interface.js";
import type { IServiceDescriptor } from "../../contracts/interfaces/core/service-graph.interface.js";
import { normalizeForComparison } from "../helpers/uri.helper.js";

/**
 * The set of stable identities `(method, uri)` for the routes of one
 * service. Pre-computed once per call so each spec is matched in O(1).
 *
 * The identity MUST be computed through `normalizeForComparison`, not
 * on the raw string. `ParsedRoute.uri` and `EndpointSpec.uri` travel in
 * different formats — the scanner emits the framework's raw syntax
 * (`/users/:id`) and the adapter converts it to Postman form
 * (`/users/{{id}}`) — so comparing raw strings silently drops every
 * parameterized route from the filtered catalog (regression found the
 * same day x00028 shipped: the express example lost `GET/PUT/DELETE
 * /users/:id` and the CLI aborted with "3 in the routes but NOT in the
 * collection"). Normalizing both sides collapses `:id`, `{id}` and
 * `{{id}}` to the same `:p` marker, which is exactly the endpoint
 * identity the rest of the pipeline already agrees on (mergeKey,
 * endpointKey).
 */
function endpointIdentitySet(
  endpoints: ReadonlyArray<ParsedRoute>,
): Set<string> {
  const set = new Set<string>();
  for (const route of endpoints) {
    set.add(`${route.method}|${normalizeForComparison(route.uri)}`);
  }
  return set;
}

/**
 * Returns the subset of `discovery.specs` whose `(method, uri)`
 * matches a route in `service.endpoints`. When the service has no
 * endpoints, returns `discovery.specs` unchanged (legacy / single
 * service path).
 *
 * The returned type is `EndpointSpec[]` (not `ReadonlyArray`)
 * because downstream helpers — `applyAgnosticInference`,
 * `inferCollectionVariables`, `detectAuthScheme`,
 * `hasLoginEndpoint` — mutate the specs in place (e.g.
 * `applyAgnosticInference` writes `body` and `description`). The
 * legacy code path `[...discovery.specs]` was already a fresh
 * mutable copy for that reason; we preserve that contract.
 *
 * @param discoverySpecs The global catalog produced by `discoverSpecs()`.
 * @param service        The descriptor for one service in the graph.
 * @returns              Specs that belong to this service.
 */
export function filterSpecsForService(
  discoverySpecs: ReadonlyArray<EndpointSpec>,
  service: IServiceDescriptor,
): EndpointSpec[] {
  // Legacy path: `service.endpoints` is empty when the helper is
  // running on a flat project. In that case `buildForService()` is
  // being asked to generate the one and only collection from the
  // whole catalog; filtering would drop nothing anyway, but skipping
  // the work keeps the path identical to the pre-x00028 behaviour.
  // We hand back a fresh mutable copy so the caller can mutate it
  // without aliasing the global catalog (the next iteration of the
  // multi-service loop would otherwise see the previous service's
  // mutations).
  if (service.endpoints.length === 0) {
    return [...discoverySpecs];
  }
  const allowed = endpointIdentitySet(service.endpoints);
  // x00028 S3: when two services share `(method, uri)` (e.g. both
  // expose `GET /health`), the filter must also require that the
  // spec carries THIS service's `serviceId`. Without this constraint,
  // each service would inherit the other's specs and the dedupe at
  // downstream layers would have already thrown away the duplication
  // that gives the collection its single-source-of-truth feel.
  //
  // Normalize `undefined` to `""` on BOTH sides: the descriptor may
  // arrive without a `serviceId` (legacy callers, hand-crafted test
  // fixtures) and the spec may be one that pre-dates x00028 S3's
  // adapter stamping. Treating either side as "no workspace
  // identity" lets the (method, uri) match stand on its own in
  // those cases, which is exactly what the flat-project path needs.
  // Real monorepo data always stamps both ends, so the equality
  // branch is what runs there.
  const serviceId = service.serviceId ?? "";
  // x00039 S1 / flat-hybrid: when the descriptor groups several
  // frameworks under one service (`additionalMatches.length > 0`),
  // its `serviceId` is `normalizeServiceId(projectRoot)` while each
  // spec carries `deriveServiceId(match.framework@projectRoot)`.
  // The two are not equal by construction — that's exactly what
  // x00031 S1 set up — so a strict equality check would reject every
  // spec and produce a zero-endpoint collection. The `(method, uri)`
  // match above already proves the spec belongs to one of the
  // descriptor's routes; flat-hybrid is a single project, so the
  // `serviceId` discrimination (which exists to disambiguate two
  // separate workspaces) is unnecessary here.
  const isFlatHybrid = service.additionalMatches.length > 0;
  const filtered: EndpointSpec[] = [];
  for (const spec of discoverySpecs) {
    // Same normalization as `endpointIdentitySet`: the spec side
    // carries Postman form (`{{id}}`), the route side carries raw
    // framework form (`:id`). Both collapse to `:p` here.
    if (allowed.has(`${spec.method}|${normalizeForComparison(spec.uri)}`)) {
      if (isFlatHybrid) {
        filtered.push(spec);
        continue;
      }
      const specServiceId = spec.serviceId ?? "";
      // Belt-and-braces: even if `(method, uri)` collides with a
      // sibling service, we only keep the spec if it actually belongs
      // to THIS service. In flat projects both `service.serviceId`
      // and `spec.serviceId` are empty, so the equality holds and
      // the legacy behaviour is preserved.
      if (serviceId === "" || specServiceId === "" || specServiceId === serviceId) {
        filtered.push(spec);
      }
    }
  }
  return filtered;
}
