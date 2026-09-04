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

/**
 * The set of stable identities `(method, uri)` for the routes of one
 * service. Pre-computed once per call so each spec is matched in O(1).
 */
function endpointIdentitySet(
  endpoints: ReadonlyArray<ParsedRoute>,
): Set<string> {
  const set = new Set<string>();
  for (const route of endpoints) {
    set.add(`${route.method}|${route.uri}`);
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
  const filtered: EndpointSpec[] = [];
  for (const spec of discoverySpecs) {
    if (allowed.has(`${spec.method}|${spec.uri}`)) {
      filtered.push(spec);
    }
  }
  return filtered;
}
