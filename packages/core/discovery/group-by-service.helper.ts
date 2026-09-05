/**
 * `groupByService` — a00013 S1.
 *
 * Converts the discovery result into an `IServiceGraph` where each service has
 * its own `match`, `endpoints`, `baseUrl`, and `auth` override. Before this
 * proposal, the pipeline loaded **one** `ProjectConfig` and mixed
 * `ParsedRoute` objects from all workspaces into a single array. The merger
 * identified them by `serviceId` (introduced in a00010), but `baseUrl`,
 * `auth`, and `variables` remained global. This models the natural unit: one
 * service = one `match` + one config + one list of routes.
 *
 * ## Contract
 *
 * - The helper is **pure**: it does not read the file system, touch
 *   `process.cwd()`, or make network requests. `lint:no-process-cwd` and
 *   `lint:no-instance-mutable-maps-in-scanners` have nothing to report.
 * - `serviceId` is derived by default from `match.frameworkSearchRoot`
 *   (a00010). When `frameworkSearchRoot` is absent, fall back to
 *   `match.framework + "@" + projectRoot`. This cascade ensures that **two
 *   workspaces with the same directory but different frameworks do not
 *   collide**—for example, `apps/payments-api/` containing two frameworks in
 *   separate subdirectories. Normalization to `[A-Za-z0-9_-]` prevents an
 *   invalid id from leaking into Postman collection names.
 * - `detectedMonorepo === false` produces a graph with `length === 1` and
 *   `combined === false`. The invariant that every graph has at least one
 *   service is **validated by an explicit test**, not left to the consumer.
 * - The caller's `combined` parameter is **optional**. It defaults to `false`,
 *   meaning one collection per service (the new model). Callers that need the
 *   legacy behavior pass `true` (`--combine-services` in the CLI).
 * - The helper does not mutate the `ParsedRoute[]` it receives. Scans are
 *   stateless between invocations (a00010 B-06), and this helper preserves
 *   that invariant.
 *
 * ## Why it exists
 *
 * `IServiceGraph` is introduced alongside this helper; in a00013 S2-S4,
 * `generation.pipeline.ts` and `loadProject()` will migrate to consume this
 * shape. Until then, only the S1 tests use the helper—it is not dead on
 * arrival.
 *
 * @see ./service-graph.interface.ts for the graph shape.
 */

import type { IProjectMatch } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IGroupByServiceInput,
  IServiceDescriptor,
  IServiceGraph,
} from "../../contracts/interfaces/core/service-graph.interface.js";

/** Characters allowed in a `serviceId` used in a Postman name. */
const SERVICE_ID_SAFE = /[^A-Za-z0-9_-]/g;

/**
 * Normalizes the id by trimming disallowed characters and replacing
 * underscore sequences with one hyphen. Empty after normalization →
 * `"default"`.
 */
function normalizeServiceId(raw: string): string {
  const trimmed = raw.replace(SERVICE_ID_SAFE, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return trimmed.length === 0 ? "default" : trimmed;
}

/**
 * Derives a stable id from a match. Two matches with the same
 * `frameworkSearchRoot` produce the same id.
 *
 * - When `frameworkSearchRoot` exists, use it as the id base, exactly as
 *   introduced by a00010.
 * - Otherwise, fall back to `<framework>@<projectRoot>` to avoid collisions
 *   between single-framework services in different roots.
 */
export function deriveServiceId(match: IProjectMatch): string {
  const base =
    match.frameworkSearchRoot !== undefined && match.frameworkSearchRoot !== ""
      ? match.frameworkSearchRoot
      : `${match.framework}@${match.projectRoot}`;
  return normalizeServiceId(base);
}

/**
 * Builds an `IServiceGraph` from discovery matches and routes.
 *
 * Throws `Error` if:
 * - A `routesByMatch` entry is missing for a match.
 * - `matches` is empty and `detectedMonorepo === false` (a non-monorepo
 *   project **must** have at least one match; otherwise the caller did not
 *   understand the contracts). The caller can bypass this check by passing
 *   `detectedMonorepo === true` with an empty array—the "declared monorepo
 *   with no enumerated workspaces" case.
 */
export function groupByService(input: IGroupByServiceInput): IServiceGraph {
  const combined = input.combined ?? false;
  if (input.matches.length === 0) {
    if (input.detectedMonorepo === true) {
      return { services: [], combined };
    }
    throw new Error(
      "groupByService requires at least one match when detectedMonorepo === false",
    );
  }

  const services: IServiceDescriptor[] = [];
  const byId = new Map<string, IServiceDescriptor>();
  // Flat hybrid project: several frameworks over the SAME root (no
  // monorepo, no `frameworkSearchRoot`). They are ONE service with
  // several capabilities, not N services — the legacy
  // `generateCollection()` contract must keep returning one
  // collection for them. Keyed by projectRoot in that case; keyed by
  // the derived id otherwise (workspaces keep their per-service
  // split).
  const flatHybrid =
    input.matches.length > 1 &&
    input.detectedMonorepo === false &&
    input.matches.every(
      (m) => m.frameworkSearchRoot === undefined || m.frameworkSearchRoot === "",
    );
  const serviceKeyOf = (match: IProjectMatch): string =>
    flatHybrid ? normalizeServiceId(match.projectRoot) : deriveServiceId(match);
  for (const match of input.matches) {
    const serviceId = serviceKeyOf(match);
    // In the flat-hybrid case the per-framework entries of
    // `routesByMatch` live under their derived ids, so this lookup
    // misses by design: the routes arrive via the merge below, from
    // every framework of the same root.
    const routes = input.routesByMatch.get(serviceId) ?? [];
    if (!flatHybrid && !input.routesByMatch.has(serviceId)) {
      throw new Error(
        `groupByService is missing routes for service '${serviceId}' (framework=${match.framework})`,
      );
    }
    const existing = byId.get(serviceId);
    if (existing) {
      // Second (or later) match of the same service: merge its routes
      // in, deduplicating by `(method, uri, sourceFile)` -- the same
      // identity `accumulateRoutesByService` uses. `IServiceDescriptor`
      // is `readonly` everywhere, so we replace the descriptor in the
      // map with a new one carrying the merged endpoints (and copy
      // `baseUrl`, `auth`, `variables` from the previous entry -- the
      // first match wins for those, consistent with a00013 S3).
      const merged: IServiceDescriptor = {
        serviceId: existing.serviceId,
        match: existing.match,
        // x00031 S1: append the new match to `additionalMatches` and
        // to `frameworks` so callers can see the hybrid composition.
        additionalMatches: [...existing.additionalMatches, match],
        frameworks: existing.frameworks.includes(match.framework)
          ? existing.frameworks
          : [...existing.frameworks, match.framework],
        endpoints: [
          ...existing.endpoints,
          ...routes.filter(
            (r) =>
              !existing.endpoints.some(
                (e) =>
                  e.method === r.method &&
                  e.uri === r.uri &&
                  e.sourceFile === r.sourceFile,
              ),
          ),
        ],
        baseUrl: existing.baseUrl,
        auth: existing.auth,
        variables: existing.variables,
      };
      byId.set(serviceId, merged);
      // Keep `services` in sync: replace the same slot so callers that
      // iterate by index see the merged descriptor.
      const slot = services.findIndex((s) => s.serviceId === serviceId);
      if (slot !== -1) services[slot] = merged;
      continue;
    }
    const descriptor: IServiceDescriptor = {
      serviceId,
      match,
      // x00031 S1: populate the new additive fields for first-match
      // case. `additionalMatches` is empty here; `frameworks` is the
      // single-framework list.
      additionalMatches: [],
      frameworks: [match.framework],
      endpoints: routes,
      baseUrl: input.baseUrlByService?.get(serviceId) ?? null,
      auth: input.authByService?.get(serviceId) ?? undefined,
      variables: input.variablesByService?.get(serviceId) ?? [],
    };
    byId.set(serviceId, descriptor);
    services.push(descriptor);
  }
  return { services, combined };
}
