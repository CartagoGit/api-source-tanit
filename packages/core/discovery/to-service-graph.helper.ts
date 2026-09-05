/**
 * toServiceGraph - a00013 S2.
 *
 * Builds an IServiceGraph from discoverSpecs' result WITHOUT changing the
 * pipeline flow. The merger already distinguishes serviceId (a00010); this
 * helper formalizes that identity in a reusable IServiceGraph and leaves the
 * door open for S3 and S4 (actual consumption from buildFor and the CLI).
 *
 * Why it exists before buildFor consumes it:
 * - S2 is deliberately adjacent: add the adapter, test it, and leave it ready.
 *   S3 will connect it to buildFor and add the --combine-services CLI flag; S4
 *   will connect it to per-service auth discrimination.
 * - If S2 included all wiring at once, S3 and S4 would touch the same files
 *   in three consecutive slices. The proposal parser had already flagged the
 *   S2/S3 conflict as a disjointness warning (all three slices target
 *   generation.pipeline.ts).
 * - The helper is pure: it does not read the file system, touch process.cwd(),
 *   or read process.argv. Its only dependency on pipeline state is the
 *   IDiscovery passed as an argument.
 *
 * Contract:
 * - Flat project (zero detected workspaces): one service whose serviceId is
 *   derived from match.frameworkSearchRoot (falling back to
 *   framework@projectRoot when absent). combined === false. This is the path
 *   used by 100% of the examples in examples/example-asterix/.
 * - Multi-workspace monorepo (>= 2 matches): one service per match. combined
 *   defaults to === false. The caller decides whether to pass combined: true
 *   (the future --combine-services behavior).
 * - Monorepo with no enumerated workspaces: an empty graph; do not invent a
 *   service. This matches groupByService with detectedMonorepo: true.
 *
 * State:
 * baseUrl and per-service auth are not yet derived from ProjectConfig—that is
 * S3/S4 work, which will need to move config loading into the service
 * descriptor. They are currently null/undefined respectively, so a caller that
 * needs an override can populate them before consuming the graph.
 */

import type { ParsedRoute } from "../../contracts/interfaces/core/scanner.interface.js";
import type { IEndpointAuth } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  IServiceDescriptor,
  IServiceGraph,
  IToServiceGraphInput,
} from "../../contracts/interfaces/core/service-graph.interface.js";
import { deriveServiceId, groupByService } from "./group-by-service.helper.js";

/**
 * Builds the IServiceGraph from the current discovery state.
 *
 * The helper does not infer anything absent from the input. If the caller has
 * not yet populated routesByService/authByService/etc., return a graph with each
 * service's identity and empty arrays—the exact shape S2 needs so S3/S4 can
 * populate it without changing the contract.
 */
export function toServiceGraph(input: IToServiceGraphInput): IServiceGraph {
  // x00025 S1: previously `routesByMatch.set(serviceId, routes)` overwrote
  // entries when the caller supplied two values with the same `serviceId` in
  // `input.routesByService`. The pipeline no longer produces that (the
  // `accumulateRoutesByService` helper deduplicates), but this helper is the
  // boundary between the pipeline and IServiceGraph, and we want the contract
  // to be correct locally too: union + dedupe here as well.
  const routesByMatch = new Map<string, ParsedRoute[]>();
  for (const [serviceId, routes] of input.routesByService) {
    const existing = routesByMatch.get(serviceId) ?? [];
    const seen = new Set<string>();
    const merged: ParsedRoute[] = [];
    for (const r of [...existing, ...routes]) {
      const key = `${r.method}|${r.uri}|${r.sourceFile}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(r);
    }
    routesByMatch.set(serviceId, merged);
  }
  for (const match of input.matches) {
    const serviceId = deriveServiceId(match);
    if (!routesByMatch.has(serviceId)) {
      routesByMatch.set(serviceId, []);
    }
  }
  return groupByService({
    matches: input.matches,
    routesByMatch,
    detectedMonorepo: input.monorepoDetection?.isMonorepo === true,
    combined: input.combined ?? false,
    authByService: input.authByService,
    baseUrlByService: input.baseUrlByService,
  });
}

/**
 * Variant of toServiceGraph that applies the caller's overrides to each
 * descriptor after calculation. Useful when the caller wants to produce a
 * decorated IServiceGraph without reimplementing auth/baseUrl/variable
 * propagation.
 *
 * It lives here for now because only S2 and its tests use it; if S3 or S4 need
 * it more broadly, promote it to an independent helper.
 */
export function decorateServices(
  graph: IServiceGraph,
  overrides: {
    readonly baseUrlByService?: ReadonlyMap<string, string | null> | undefined;
    readonly authByService?: ReadonlyMap<string, IEndpointAuth | undefined> | undefined;
    readonly variablesByService?:
      | ReadonlyMap<
        string,
        ReadonlyArray<{ readonly key: string; readonly value: string }>
      >
      | undefined;
  },
): IServiceGraph {
  const services: IServiceDescriptor[] = graph.services.map((service) => ({
    serviceId: service.serviceId,
    match: service.match,
    // x00031 S1: preserve the hybrid metadata.
    additionalMatches: service.additionalMatches,
    frameworks: service.frameworks,
    endpoints: service.endpoints,
    baseUrl: overrides.baseUrlByService?.get(service.serviceId) ?? service.baseUrl,
    auth: overrides.authByService?.get(service.serviceId) ?? service.auth,
    variables: overrides.variablesByService?.get(service.serviceId) ?? service.variables,
  }));
  return { services, combined: graph.combined };
}
