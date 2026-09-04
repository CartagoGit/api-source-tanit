/**
 * Multi-service graph: the discovery unit behind the `serviceId`
 * introduced in a00010/x00013.
 *
 * Before this proposal, a monorepo (`apps/users-api` +
 * `apps/payments-api`) ended up as a single collection with a single
 * `baseUrl`, a single global auth, and a set of endpoints mixed by
 * `METHOD+URI` coincidence. `serviceId` lets the endpoints be
 * distinguished; this contract elevates that distinction to a
 * first-class model so that the pipeline —not only the merger— can
 * honour it.
 *
 * Why **here** and not next to the orchestrator: `IServiceDescriptor`
 * reuses `IProjectMatch`, `ParsedRoute` and `IEndpointAuth`, three
 * types that already live in `contracts/`. If this lived in `core/`,
 * any MCP plugin consumer that wanted to import it would drag the
 * whole pipeline along (the same thing already happened with
 * `IProjectSummary`). `lint:contracts` enforces this.
 *
 * It does not introduce a `packages/contracts/index.ts` barrel —
 * the `contracts/` README is explicit about not adding one.
 * Importers use the canonical relative path.
 *
 * It is part of a00013 (Multi-service for monorepos). S1 only
 * defines the shape; S2-S4 wire it into the pipeline.
 */

import type { IProjectMatch, ParsedRoute } from "./scanner.interface.js";
import type { IEndpointAuth } from "./postman.interface.js";
import type { IMonorepoDetection } from "./discovery.interface.js";

/**
 * The descriptor of an individual service inside a multi-service
 * project.
 *
 * Three blocks:
 *
 * 1. Identity (where it comes from) — `serviceId`, `match`, `evidence`.
 * 2. Its own configuration (the one that overrides the monorepo
 *    global config).
 * 3. The service's routes, in the pipeline's neutral format.
 *
 * The three blocks live on the same object on purpose: each
 * service has a single `match`, a single config, and a single set
 * of routes. Splitting them apart would reintroduce the problem
 * this proposal is fighting — `loadProject()` loading one config
 * and the scanners ending up seeing another.
 *
 * `serviceId` is computed by default from
 * `match.frameworkSearchRoot` (a00010 already introduced it that
 * way). When the caller wants to force an explicit one (e.g. to
 * keep a stable identity across folder renames), they can
 * override it via `IServiceDescriptor.serviceId`. What the helper
 * will never invent are characters outside `[A-Za-z0-9_-]`,
 * because the id shows up in collection names and Postman
 * environment variables.
 */
export interface IServiceDescriptor {
  /** Stable identity of the service; used as the merge key and as the name. */
  readonly serviceId: string;
  /** The resolved framework match for THIS service. */
  readonly match: IProjectMatch;
  /** The routes detected for THIS service, in the neutral format. */
  readonly endpoints: ReadonlyArray<ParsedRoute>;
  /**
   * `baseUrl` override for this service (e.g.
   * `http://localhost:3001`). `null` when it inherits the project
   * global — the legacy behaviour.
   */
  readonly baseUrl: string | null;
  /**
   * Per-service auth. When `undefined`, the service inherits the
   * global one; when `{ kind: "none" }`, the service is public even
   * if the rest of the project carries bearer.
   *
   * Modelled as an override (not as a derived value) because
   * per-service detection can disagree with the project-level one:
   * `apps/catalog-api` may come with `apiKey` in a header and
   * `apps/payment-api` with `bearer`.
   */
  readonly auth: IEndpointAuth | undefined;
  /**
   * Service-specific variables. Empty = inherit globals;
   * non-empty = add (does not replace) variables to the environment.
   */
  readonly variables: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

/**
 * Inputs of the `groupByService` helper. It lives here for the
 * same reason as `IServiceDescriptor`: the helper is generic, but
 * its inputs are contracts shared across every caller (CLI, plugin,
 * tests). Moving them inside `core/` would reintroduce the bug this
 * contract is fighting: having to drag the implementation in just
 * to type something.
 */
export interface IGroupByServiceInput {
  /** Each match = a distinct service when there are several. */
  readonly matches: ReadonlyArray<IProjectMatch>;
  /** The routes detected **per match**, in the same order. */
  readonly routesByMatch: ReadonlyMap<string, ReadonlyArray<ParsedRoute>>;
  /** Did the caller already detect the monorepo? Default `false`. */
  readonly detectedMonorepo?: boolean | undefined;
  /** Per-service auth override; optional. */
  readonly authByService?: ReadonlyMap<string, IEndpointAuth | undefined> | undefined;
  /** Per-service baseUrl override; optional. */
  readonly baseUrlByService?: ReadonlyMap<string, string | null> | undefined;
  /** Extra variables per service (does not replace, adds). */
  readonly variablesByService?: ReadonlyMap<
    string,
    ReadonlyArray<{ readonly key: string; readonly value: string }>
  > | undefined;
  /** Combine all services into a single collection? */
  readonly combined?: boolean | undefined;
}

/**
 * The service graph that comes out of multi-service discovery.
 *
 * `combined` reflects the user's decision, not the pipeline's.
 * When `combined === true`, the pipeline produces a single merged
 * collection (legacy / `--combine-services` mode). When
 * `combined === false`, it produces one collection per service.
 *
 * `services` always contains at least one service: a single-service
 * project is not a monorepo and therefore yields
 * `services.length === 1` with `combined === false`. That invariant
 * is guaranteed by the `groupByService` helper (in `core/discovery/`),
 * not by this contract.
 */
export interface IServiceGraph {
  readonly services: ReadonlyArray<IServiceDescriptor>;
  /** Did the user ask to combine the services into a single collection? */
  readonly combined: boolean;
}

/**
 * Inputs of the `toServiceGraph` helper (a00013 S2). It lives here
 * for the same reason as `IGroupByServiceInput`: the helper is
 * generic, but its inputs are shared contracts. Moving them next
 * to the helper reintroduces the bug this contract is fighting
 * (dragging the implementation in just to type).
 *
 * `IMonorepoDetection` is re-exported from this barrel because
 * S3/S4 will populate it from `detectMonorepo()`. Keeping it here
 * guarantees that a consumer of the graph (CLI, plugin, alternative
 * exporter) can build an `IToServiceGraphInput` without importing
 * `core/`.
 */
export interface IToServiceGraphInput {
  readonly matches: ReadonlyArray<IProjectMatch>;
  readonly routesByService: ReadonlyMap<string, ReadonlyArray<ParsedRoute>>;
  readonly monorepoDetection?: IMonorepoDetection | undefined;
  readonly combined?: boolean | undefined;
  readonly authByService?: ReadonlyMap<string, IEndpointAuth | undefined> | undefined;
  readonly baseUrlByService?: ReadonlyMap<string, string | null> | undefined;
}
