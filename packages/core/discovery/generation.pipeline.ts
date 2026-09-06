/**
 * Generation pipeline: `projectRoot` -> `PostmanCollection`.
 *
 * This is the only place where the order of steps is decided:
 *
 *   1. Detect the framework (with the catalog injected into it).
 *   2. Scan routes and resolve validation rules.
 *   3. Merge the host's manual overrides.
 *   4. Infer bodies and query params for what has no rules.
 *   5. Derive the missing collection variables.
 *   6. Build the Postman collection.
 *
 * It used to be copy-pasted in three places -- `scripts/generate.script.ts`,
 * `tests/helpers/run-scanner.ts`, and the validation gate -- and the
 * three copies had already diverged: the gate's copy skipped the host
 * variable merge, so `{{pathParam}}` ended up undeclared. A gate that
 * runs a pipeline different from the CLI's validates nothing.
 *
 * The variant-enrichment step (`catalog-enricher`) and the disk write
 * are deliberately out of scope: they belong to the script, not the
 * pipeline.
 */
import type {
  EndpointSpec,
  IEndpointAuth,
} from "../../contracts/interfaces/core/postman.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import type { IProjectContext } from "../../contracts/interfaces/core/project-context.interface.js";
import type {
  IDetectedFramework,
  IProjectMatch,
  ParsedRoute,
} from "../../contracts/interfaces/core/scanner.interface.js";
import { buildSpecsFromScanner } from "../adapters/parsed-route-to-spec.adapter.js";
import { endpointKey } from "../helpers/route-identity.helper.js";
import { authVariablesFor, detectAuthScheme } from "../domain/auth-scheme.service.js";
import { hasLoginEndpoint, applyAuthFlow, authEnvironmentVariables, detectLaravelTokenPath } from "../domain/auth-flow.service.js";
import { buildCollection } from "../domain/collection-builder.service.js";
import { applyAgnosticInference, inferCollectionVariables } from "../domain/param-inferrer.service.js";
import { loadProject } from "./project-loader.service.js";

import { resolveProjectContext } from "./project-context.service.js";
import { mergeWithManual } from "../domain/endpoint-merge.service.js";
import {
  buildServiceConfig,
  pickAuth,
  toIEndpointAuth,
} from "./auth-scheme.helper.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  IDetectedAuthScheme,
  IGenerationOptions,
  IGenerationResult,
} from "../../contracts/interfaces/core/discovery.interface.js";
import type { IEndpointProvenanceEntry } from "../../contracts/interfaces/core/merge.interface.js";
import {
  endpointSpecFromMerged,
  mergeEndpoints,
} from "./endpoint-merger.service.js";
import {
  detectMonorepo,
} from "./monorepo-detector.helper.js";
import type { IMonorepoDetection } from "../../contracts/interfaces/core/discovery.interface.js";
import type { IServiceDescriptor } from "../../contracts/interfaces/core/service-graph.interface.js";
import { toServiceGraph } from "./to-service-graph.helper.js";
import { deriveServiceId } from "./group-by-service.helper.js";
import { accumulateRoutesByService } from "./accumulate-routes-by-service.helper.js";
import { filterSpecsForService } from "./filter-specs-for-service.helper.js";

/**
 * Discovers the endpoints of a project and builds its collection.
 *
 * `projectRoot` is the source of truth, and it travels **as an
 * argument** all the way down: the context is resolved once here and
 * flows explicitly through the pipeline, the loader, and the scanners.
 *
 * Before, this was wrapped in `withProjectRoot()`, which set global
 * environment variables, executed, and restored them. It worked, but at
 * the cost of a queue: two concurrent calls clobbered each other's
 * state, so they had to be serialized. Two analyses at a time took as
 * long as their sum.
 *
 * No more. `tests/e2e/concurrent-projects.test.ts` generates two
 * projects of different frameworks with `Promise.all` and verifies that
 * they do not collide: not in endpoints, not in name, not in the
 * context root.
 */

/**
 * Thrown by `generateCollection()` when the project has several
 * services but the caller did NOT request `--combine-services` (nor
 * `IGenerationOptions.combineServices === true`).
 *
 * ## Why it exists
 *
 * Until x00024, the singular contract documented "a single collection"
 * but the multi-service branch did `return result[0]` and silently
 * discarded the rest. That turned `await generateCollection(monorepoRoot)`
 * into a call that loses services without warning -- exactly the kind
 * of bug a caller never catches in CI. The plural API
 * `generateCollections()` was already returning the full array.
 *
 * ## When it is thrown
 *
 * `generateCollection()` calls `buildFor` and observes three shapes:
 *
 *   - **Single-service** (a single match, single-workspace monorepo,
 *     or flat project): `result` is a single `IGenerationResult`. No
 *     throw.
 *   - **Multi-service + `combineServices: true`**: the caller asked to
 *     fuse; `buildFor` already returns a single combined
 *     `IGenerationResult`. No throw.
 *   - **Multi-service + `combineServices: false/undefined`**: this is
 *     the case where this exception is thrown.
 *
 * The legacy contract (single-service) keeps working exactly as
 * before -- this only adds a new case.
 *
 * ## Shape of the error
 *
 * It carries the data the CLI needs to print a useful message without
 * having to parse the text of `super()`:
 *
 *   - `serviceCount`: the number of services detected.
 *   - `serviceIds`: the derived ids (from `match.frameworkSearchRoot`
 *     via `deriveServiceId`); empty if none had a resolvable id.
 *
 * The message includes the suggestion ("use --combine-services or
 * generateCollections()") so that a user who sees the error in raw
 * form knows what to do.
 *
 * It lives in this same `.pipeline.ts` (not in `packages/core/errors/`)
 * because `lint:naming` for `packages/core/` only allows the suffixes
 * `.service`, `.pipeline`, `.orchestrator`, `.adapter`, and `.helper`.
 * An error class fits none, so it stays where it is thrown -- the same
 * pattern as `PostmanApiError` in `domain/postman-api.service.ts`.
 */
export class MultipleServicesWithoutCombineError extends Error {
  /** Number of services detected. */
  readonly serviceCount: number;
  /** The `serviceId`s of the detected services (may be empty). */
  readonly serviceIds: ReadonlyArray<string>;

  constructor(
    serviceCount: number,
    serviceIds: ReadonlyArray<string>,
  ) {
    const ids =
      serviceIds.length > 0
        ? ` (${serviceIds.join(", ")})`
        : "";
    super(
      `Detected ${serviceCount} services${ids} but ` +
        `--combine-services was not requested. ` +
        `Use 'generateCollections()' for the array, or pass --combine-services ` +
        `to merge into a single collection.`,
    );
    this.name = "MultipleServicesWithoutCombineError";
    this.serviceCount = serviceCount;
    this.serviceIds = serviceIds;
  }
}

/**
 * Discovers the endpoints of a project and builds its collection.
 *
 * `projectRoot` is the source of truth, and it travels **as an
 * argument** all the way down: the context is resolved once here and
 * the loader and the scanners.
 *
 * Before, this was wrapped in `withProjectRoot()`, which set global
 * environment variables, executed, and restored them. It worked, but at
 * the cost of a queue: two concurrent calls clobbered each other's
 * state, so they had to be serialized. Two analyses at a time took as
 * long as their sum.
 *
 * No more. `tests/e2e/concurrent-projects.test.ts` generates two
 * projects of different frameworks with `Promise.all` and verifies that
 * they do not collide: not in endpoints, not in name, not in the
 * context root.
 */
export async function generateCollection(
  projectRoot: string,
  options: IGenerationOptions,
): Promise<IGenerationResult> {
  // A non-existent root is a caller error, not an empty project.
  // Without this, a `--project-root` with a typo returned a
  // zero-endpoint collection without saying why -- and `summary` did
  // throw, so the two paths disagreed.
  if (!existsSync(projectRoot)) {
    throw new Error(
      `The projectRoot does not exist: ${projectRoot}\n` +
        "Check the path you pass to `--project-root`.",
    );
  }

  const context = resolveProjectContext({ projectRoot });
  const result = await buildFor(context, options);
  // Legacy single-collection contract: if buildFor returns a single
  // IGenerationResult (combineServices=true or a single service), we
  // return it as-is. If it returns an array, the caller has NOT
  // requested combine -- previously we silently picked the first
  // service (x00024 audit P1 #2: we lost N-1 services without
  // warning). Now we throw an explicit error with the detected
  // serviceIds so the CLI can translate it into an actionable exit
  // code. Callers that need the explicit array still use
  // `generateCollections`.
  if (Array.isArray(result)) {
    if (result.length > 1 && options.combineServices !== true) {
      const serviceIds = result
        .map((r) => r.serviceId ?? "<unknown>")
        .filter((id): id is string => id !== "<unknown>");
      throw new MultipleServicesWithoutCombineError(result.length, serviceIds);
    }
    const first: IGenerationResult = result[0] as IGenerationResult;
    return first;
  }
  return result as IGenerationResult;
}

/**
 * Multi-service variant of `generateCollection`. Returns ALL the
 * collections, one per service, in discovery order.
 *
 * - Without `--combine-services` and with N>1 services: an array of
 *   N collections (each with `collectionName` derived from the
 *   serviceId).
 * - With `--combine-services` or N===1: an array of length 1 (the
 *   legacy collection).
 *
 * The CLI writes one file per entry; the MCP plugin and the web UI
 * expose the array as-is.
 */
export async function generateCollections(
  projectRoot: string,
  options: IGenerationOptions,
): Promise<ReadonlyArray<IGenerationResult>> {
  if (!existsSync(projectRoot)) {
    throw new Error(
      `The projectRoot does not exist: ${projectRoot}\n` +
        "Check the path you pass to `--project-root`.",
    );
  }
  const context = resolveProjectContext({ projectRoot });
  const result = await buildFor(context, options);
  if (Array.isArray(result)) {
    return result.slice() as ReadonlyArray<IGenerationResult>;
  }
  return [result as IGenerationResult];
}

async function buildFor(
  context: IProjectContext,
  options: IGenerationOptions,
): Promise<IGenerationResult | ReadonlyArray<IGenerationResult>> {
  const discovery = await discoverSpecs(context, options);

  // Legacy path: zero matches (no scanner recognized the project, and
  // no legacy fallback either). We synthesize a single service with
  // null match so that `buildForService` runs the full legacy path
  // (`applyAgnosticInference` + `buildCollection` + auth flow). If
  // we skipped it, callers that expect those fields populated (e.g.
  // summary) would see empty values without knowing why.
  if (discovery.matches.length === 0) {
    const synthetic: IProjectMatch = {
      framework: "unknown",
      projectRoot: context.projectRoot,
      artifacts: [],
    };
    return buildForService(
      { ...discovery, matches: [synthetic] },
      {
        serviceId: "default",
        match: synthetic,
        // x00031 S1: additive fields. The synthetic `default` service
        // wraps the whole discovery into one descriptor; it has no
        // secondary matches and exposes the original framework.
        additionalMatches: [],
        frameworks: [synthetic.framework],
        endpoints: discovery.routes,
        baseUrl: null,
        auth: undefined,
        variables: [],
      },
      context,
      options,
    );
  }

  // a00013 S3: we compute the ServiceGraph. In a flat project it
  // produces length=1 (legacy path); in multi-service with
  // combineServices=false, it produces N services that we emit as
  // separate collections.
  const combined = options.combineServices === true;
  const graph = toServiceGraph({
    matches: discovery.matches,
    routesByService: discovery.routesByService,
    monorepoDetection: discovery.monorepoDetection,
    combined,
  });

  if (graph.services.length === 1) {
    return buildForService(discovery, graph.services[0]!, context, options);
  }
  if (combined) {
    // Combined mode: merge every service's endpoints into a single
    // descriptor and pass it to `buildForService`. The endpoint
    // filter inside `buildForService` is then a no-op (it filters by
    // the descriptor's own `endpoints` list, which already contains
    // every contribution). `match` / `baseUrl` / `auth` come from
    // the first service; the merged `endpoints` is what produces
    // the single combined collection the caller expects.
    const seen = new Set<string>();
    const mergedEndpoints: ParsedRoute[] = [];
    for (const s of graph.services) {
      for (const r of s.endpoints) {
        const key = `${r.method}|${r.uri}|${r.sourceFile}`;
        if (seen.has(key)) continue;
        seen.add(key);
        mergedEndpoints.push(r);
      }
    }
    const first = graph.services[0]!;
    const mergedService: IServiceDescriptor = {
      // x00028 S3: the combined service is a synthetic descriptor
      // whose `endpoints` is the union of every contributing
      // service. It does NOT have a workspace identity of its own
      // — the filter helper treats `serviceId === ""` as "legacy /
      // flat project" and trusts the `(method, uri)` match alone,
      // which is what we want here (the filter must accept specs
      // from ALL services in the combined collection). Using
      // `first.serviceId` would let the filter reject every spec
      // that came from a sibling service: `spec.serviceId ===
      // first.serviceId` would fail for every other service.
      serviceId: "",
      match: first.match,
      // x00031 S1: propagate the hybrid metadata from the first service
      // (which is the only one with the merged endpoints anyway).
      additionalMatches: first.additionalMatches,
      frameworks: first.frameworks,
      endpoints: mergedEndpoints,
      baseUrl: first.baseUrl,
      auth: first.auth,
      variables: first.variables,
    };
    return buildForService(discovery, mergedService, context, options);
  }
  const out: IGenerationResult[] = [];
  for (const service of graph.services) {
    out.push(await buildForService(discovery, service, context, options));
  }
  return out;
}

async function buildForService(
  discovery: IDiscovery,
  service: IServiceDescriptor,
  context: IProjectContext,
  options: IGenerationOptions,
): Promise<IGenerationResult> {
  const projectRoot = context.projectRoot;
  // S4: the descriptor is now used -- no more `void service;`. We
  // apply the per-service overrides (baseUrl + auth) on top of the
  // discovery result. The work is ALWAYS done over `localConfig`, a
  // copy of `discovery.config`: mutating the original would
  // contaminate the next iteration of the multi-service loop in
  // `buildFor`. It is the difference between "one collection per
  // service" and "N collections with the same baseUrl from the last
  // iteration".
  //
  // Single-service path: `service.baseUrl === null` and
  // `service.auth === undefined`, so `buildServiceConfig(config,
  // service)` produces a copy equivalent to the original (except
  // for the variables array, which is also copied by value). The 21
  // examples keep passing because that case is the dominant one.
  //
  // Spec filtering by `service.endpoints` is left for a later slice
  // (when a per-service override may change which endpoints enter);
  // here every service sees the same `discovery.specs`. The S4
  // acceptance is authScheme + baseUrl per service -- filtering is
  // not required.
  const localConfig = buildServiceConfig(discovery.config, service);
  // x00028 S1: filter the global catalog down to the specs that
  // belong to THIS service. `discovery.specs` is a merged cross-
  // service catalog; `IServiceDescriptor.endpoints` is the per-
  // service route list, populated correctly by `accumulateRoutesBy
  // Service` (x00025) and grouped by `toServiceGraph`. Before this
  // line every service saw the same global catalog and produced
  // collections that crossed `baseUrl`, `auth` and routes.
  const specs = filterSpecsForService(discovery.specs, service);
  const inference = applyAgnosticInference(specs);

  // Collection variables: derive the missing ones, respecting the ones
  // the host already declared (and the `baseUrl` that
  // `buildServiceConfig` just pinned per service).
  localConfig.variables = inferCollectionVariables(specs, localConfig.variables ?? []);
  if (options.collectionName) localConfig.collectionName = options.collectionName;

  // The auth scheme is resolved BEFORE building: it decides which
  // headers each request carries, so it cannot be patched afterwards.
  //
  // S4: auth is resolved per service. The per-spec detector
  // (`detectAuthScheme`) runs on the service's specs; the
  // descriptor's override (`service.auth`) wins if defined, and
  // `pickAuth` propagates it without collapsing the discriminator
  // (audit review #16: a `{ kind: "scheme", scheme: "bearer" }` from
  // the descriptor NEVER ends up as `{ kind: "none" }`). The result
  // is converted back to `IDetectedAuthScheme` so that
  // `buildCollection`, `applyAuthFlow` and `authVariablesFor` (all
  // consumers of `IDetectedAuthScheme`) see the shape they expect.
  const detectedFromSpecs = detectAuthScheme(specs, hasLoginEndpoint(specs));
  const projectWideFallback = toIEndpointAuth(detectedFromSpecs);
  const effectiveAuth = pickAuth(service, projectWideFallback);
  const authScheme: IDetectedAuthScheme =
    effectiveAuth !== undefined
      ? authSchemeFromEndpointAuth(effectiveAuth, service.match.framework)
      : detectedFromSpecs;
  const collection = buildCollection(specs, localConfig, authScheme);

  // The auth flow is part of the pipeline, not the script: if it
  // lived only in `generate.script.ts`, neither the tests nor the
  // gate would exercise it, which is exactly what was happening.
  const tokenResponsePath =
    localConfig.tokenResponsePath ?? (await detectLaravelTokenPath(projectRoot));
  const authFlow = applyAuthFlow(collection, {
    tokenResponsePath,
    loginEndpointName: localConfig.loginEndpointName,
  });
  // The variables to be filled depend on the scheme: an API key
  // needs `apiKey`, OAuth2 needs `clientId` and `clientSecret`, and
  // bearer needs the login credentials.
  const needed = [
    ...(authFlow ? authEnvironmentVariables() : []),
    ...authVariablesFor(authScheme),
  ];
  if (needed.length > 0) {
    const known = new Set(localConfig.variables.map((v) => v.key));
    localConfig.variables = [
      ...localConfig.variables,
      ...needed.filter((v) => {
        if (known.has(v.key)) return false;
        known.add(v.key);
        return true;
      }),
    ];
    collection.variable = localConfig.variables;
  }

  return {
    collection,
    specs,
    routes: service.endpoints,
    config: localConfig,
    match: discovery.match,
    // x00024: we propagate the descriptor's serviceId so the multi-
    // service branch of `generateCollection()` can report which
    // services it detected when constructing the error. Single-
    // service also carries it (the service identity: "default" or
    // the derived frameworkSearchRoot).
    serviceId: service.serviceId,
    origin: discovery.origin,
    authFlow,
    authScheme,
    context,
    warnings: discovery.warnings,
    frameworks: discovery.frameworks,
    project: discovery.project,
    ...(discovery.provenance ? { provenance: discovery.provenance } : {}),
    metrics: {
      // Per-service metrics. Before this slice they came from
      // `discovery.routes` / `discovery.withValidation` /
      // `discovery.withoutValidation` -- the **global** catalog --
      // and every collection in a multi-service project reported the
      // same total count. UI, stats, MCP, integrations and any
      // downstream tool that read `metrics.routes` saw the union of
      // every service's endpoints attributed to the wrong service.
      //
      // Audit 2026-09-06, section 3.1: the `IServiceDescriptor` is
      // the only authoritative source of "what belongs to this
      // service", so every count is recomputed against `specs` (the
      // per-service filtered list) and `service.endpoints` (the
      // per-service route list).
      routes: service.endpoints.length,
      specs: specs.length,
      withValidation: countWithValidation(specs),
      withoutValidation: specs.length - countWithValidation(specs),
      bodiesInferred: inference.bodiesAdded,
      queriesInferred: inference.queriesAdded,
    },
  };
}

/**
 * Counts how many specs have at least one validated field — a body,
 * a list of fields, query parameters or headers. This is the
 * per-service counterpart of `withFormRequest` in
 * `parsed-route-to-spec.adapter.ts`: that one is computed while
 * adapters attach FormRequest rules, and only knows the global
 * catalog. By the time `buildForService` runs, the rule attachment
 * has already happened and the spec carries the result; recomputing
 * from the spec is both correct and simpler.
 */
function countWithValidation(specs: ReadonlyArray<EndpointSpec>): number {
  let n = 0;
  for (const spec of specs) {
    if (spec.body !== undefined) {
      n += 1;
      continue;
    }
    if (spec.fields !== undefined && spec.fields.length > 0) {
      n += 1;
      continue;
    }
    if (spec.query !== undefined && spec.query.length > 0) {
      n += 1;
      continue;
    }
    if (spec.headers !== undefined && spec.headers.length > 0) {
      n += 1;
      continue;
    }
  }
  return n;
}

/**
 * Resolves the forced framework, or fails saying which ones exist.
 *
 * Fails **before** scanning: a bad id that is discovered at the end,
 * after walking the project and with zero endpoints, says nothing
 * about what happened.
 */
async function forcedDetection(
  options: IGenerationOptions,
  projectRoot: string,
): Promise<IDetectedFramework[]> {
  const forced = await options.orchestrator.forceFramework({
    projectRoot,
    framework: options.forceFramework!,
  });
  if (!forced) {
    const supported = options.orchestrator.supportedFrameworks().sort().join(", ");
    throw new Error(
      `No scanner for "${options.forceFramework}".\n` +
        `  Available frameworks: ${supported}`,
    );
  }
  return [forced];
}

/**
 * Resolves the `frameworkSearchRoot` and attaches it to every detected
 * match.
 *
 * The priority is documented in `IGenerationOptions.frameworkSearchRoot`:
 * the user's override wins over monorepo auto-detection, and auto-
 * detection only applies when there is **exactly one** workspace. With
 * several, it fills in nothing: the orchestrator prefers to stay put
 * over guessing wrong.
 *
 * Returns a copy of the input array with the `match`es reassigned.
 * `IProjectMatch` is `readonly`; what is returned is a new object with
 * `frameworkSearchRoot` added when needed. The remaining fields are
 * preserved by spread, so the rest of the pipeline does not have to
 * know that augmentation happened.
 *
 * f00011 S3. Detection lives in `monorepo-detector.helper.ts`; this
 * wrapper is the only thing the pipeline calls.
 */
/**
 * Reorients detection when the root is not where the framework lives.
 * See `discoverSpecs()` for the full context.
 *
 * Three cases:
 *   1. **User override** (`--framework-search-root=apps/api`):
 *      scans ONLY that workspace and discards what the root would
 *      have detected (a monorepo's root rarely holds frameworks).
 *      Returns the `match`es already with `frameworkSearchRoot`
 *      attached, so `applyFrameworkSearchRoot` does not duplicate the
 *      segment.
 *   2. **Auto multi-workspace**: appends each workspace's results to
 *      the root's (deduplicated by framework + workspace). Every
 *      `match` carries its own `frameworkSearchRoot` --
 *      `applyFrameworkSearchRoot` is a no-op when one is already set
 *      (its internal `frameworkSearchRoot` is `null`).
 *   3. **Auto single-workspace**: replaces the (empty) root detection
 *      with the workspace's, because the root only orchestrates.
 *
 * Without monorepo and without override: returns what the root
 * detected -- the legacy path intact.
 *
 * Audit 2026-09-04 (finding P1 #1).
 */
async function expandMonorepoDetection(
  orchestrator: IGenerationOptions["orchestrator"],
  projectRoot: string,
  rootDetected: ReadonlyArray<IDetectedFramework>,
  userOverride: string | undefined,
  forceFramework: string | undefined,
): Promise<ReadonlyArray<IDetectedFramework>> {
  // Case 0 (audit second review #5): `forceFramework` is active.
  // The user has explicitly decided "this project IS X", and
  // `rootDetected` already contains that framework (forced via
  // `forcedDetection`). We do NOT re-detect: the workspace's manifest
  // might not allow auto-detection, and the user's override is
  // authoritative. We only reorient `projectRoot` if the user also
  // asked for `frameworkSearchRoot`, so scanners read from the right
  // workspace.
  if (forceFramework && forceFramework.length > 0) {
    if (userOverride && userOverride.length > 0) {
      // Forced framework + forced workspace: we propagate both to
      // every match (typically one, but could be several if the
      // orchestrator returned several with the same identity).
      return rootDetected.map((c) => ({
        ...c,
        match: {
          ...c.match,
          projectRoot,
          frameworkSearchRoot: userOverride,
        },
      }));
    }
    // Forced framework without workspace: nothing to expand. We
    // return the `forcedDetection` result as-is.
    return rootDetected;
  }

  // Caso 1: override del usuario. Escaneamos solo el workspace que
  // expected. We attach `frameworkSearchRoot` to the match (relative
  // to the root) and leave `projectRoot` pointing at the root: the
  // scanners (a00012 S1.b) es que hacen `resolve(projectRoot,
  // frameworkSearchRoot)` para llegar al workspace. Si
  // `projectRoot` were already the workspace, `resolve(workspace,
  // workspace) = workspace/workspace` and scanners would not find
  // their sources.
  if (userOverride && userOverride.length > 0) {
    const workspaceRoot = join(projectRoot, userOverride);
    const perWorkspace = await orchestrator.detectAll(workspaceRoot);
    return perWorkspace.map((c) => ({
      ...c,
      match: {
        ...c.match,
        projectRoot,
        frameworkSearchRoot: userOverride,
      },
    }));
  }

  // Monorepo detection. If there is none, return what the root had.
  const detection = await detectMonorepo(projectRoot);
  if (!detection.isMonorepo || detection.workspaceDirs.length === 0) {
    return rootDetected;
  }

  // Dedup by (framework, frameworkSearchRoot) so we do not repeat the
  // same pair if two workspaces expose the same framework.
  const seen = new Set<string>(
    rootDetected.map(
      (d) => `${d.match.framework}@${d.match.frameworkSearchRoot ?? ""}`,
    ),
  );

  // Helper: reorients a match to the workspace. Same contract as
  // override -- `projectRoot` stays as the monorepo root and
  // `frameworkSearchRoot` is the segment to apply.
  const reorient = (
    c: IDetectedFramework,
    workspace: string,
  ): IDetectedFramework => ({
    ...c,
    match: {
      ...c.match,
      projectRoot,
      frameworkSearchRoot: workspace,
    },
  });

  // Case 3: single-workspace. The root alone detects nothing; we
  // replace it with the workspace's detection.
  if (detection.workspaceDirs.length === 1) {
    const workspace = detection.workspaceDirs[0]!;
    const workspaceRoot = join(projectRoot, workspace);
    const perWorkspace = await orchestrator.detectAll(workspaceRoot);
    return perWorkspace.map((c) => reorient(c, workspace));
  }

  // Case 2: multi-workspace. We append to what the root already
  // detected, pinning `frameworkSearchRoot` per entry.
  const merged: IDetectedFramework[] = [...rootDetected];
  for (const workspace of detection.workspaceDirs) {
    if (workspace === "" || workspace === ".") continue;
    const workspaceRoot = join(projectRoot, workspace);
    const perWorkspace = await orchestrator.detectAll(workspaceRoot);
    for (const candidate of perWorkspace) {
      const rewritten = reorient(candidate, workspace);
      const key = `${rewritten.match.framework}@${workspace}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(rewritten);
    }
  }
  return merged;
}

async function applyFrameworkSearchRoot(
  detected: ReadonlyArray<IDetectedFramework>,
  projectRoot: string,
  userOverride: string | undefined,
): Promise<{
  readonly augmented: ReadonlyArray<IDetectedFramework>;
  readonly detection: IMonorepoDetection | null;
}> {
  // Case 1: the user forced `--framework-search-root` or
  // `delendai.config.json#frameworkSearchRoot`. The value is validated
  // below (no leading slashes, no `..`); what arrives from the CLI has
  // already gone through `readFlag`, what arrives from the plugin has
  // already gone through zod. Here we keep it as it comes.
  if (userOverride && userOverride.length > 0) {
    if (!isSafeRelativeSubdir(userOverride)) {
      throw new Error(
        `--framework-search-root must be a subdirectory relative to projectRoot ` +
          `(no leading "/", no ".."). Received: "${userOverride}"`,
      );
    }
    return {
      augmented: detected.map((d) => augmentMatch(d, userOverride)),
      detection: null,
    };
  }

  // Case 2: auto-detection by monorepo. If the root is not a
  // monorepo, or it is but has multiple workspaces, we do nothing.
  const detection = await detectMonorepo(projectRoot);
  if (!detection.frameworkSearchRoot) {
    return { augmented: detected, detection };
  }
  return {
    augmented: detected.map((d) => augmentMatch(d, detection.frameworkSearchRoot!)),
    detection,
  };
}

/**
 * Converts the per-operation auth override (`spec.auth`) into an
 * `IDetectedAuthScheme` that the merger can compare piece by piece.
 *
 * Audit 2nd review #16: the `IEndpointAuth` contract has a
 * `kind: "none" | "scheme"` discriminator and `scheme: "bearer" |
 * "apiKey" | "oauth2"` as a sub-discriminator. The conversion must
 * respect ALL branches; otherwise an expression
 * `{ kind: "scheme", scheme: "apiKey" }` would collapse to
 * `type: "none"` (public), which is exactly the bug opposite to the
 * one the first audit fixed.
 *
 * Each branch also carries an `evidence` traceable to the source
 * framework: the merger exposes it in the CLI warning so the user can
 * audit why an endpoint is considered public / bearer / apiKey / oauth2.
 */
function authSchemeFromEndpointAuth(
  auth: IEndpointAuth,
  framework: string,
): IDetectedAuthScheme {
  switch (auth.kind) {
    case "none":
      return {
        type: "none",
        evidence: `per-op override (${framework}, public)`,
      };
    case "scheme": {
      // Maps the contract's sub-discriminator to the `type` the
      // merger already understands. If `scheme: "basic"` or another
      // appears in the future, this switch enumerates it explicitly
      // -- never invent a default `type`.
      switch (auth.scheme) {
        case "bearer":
          return {
            type: "bearer",
            evidence: `per-op override (${framework}, bearer)`,
          };
        case "apiKey":
          return {
            type: "apikey",
            keyIn: "header",
            evidence: `per-op override (${framework}, apiKey header)`,
          };
        case "oauth2":
          return {
            type: "oauth2",
            evidence: `per-op override (${framework}, oauth2)`,
          };
      }
    }
  }
}

/**
 * Builds an `IDetectedFramework` with the `frameworkSearchRoot`
 * attached to the `match`. The rest (score, evidence, scanner,
 * validation) is preserved by spread.
 */
function augmentMatch(
  detected: IDetectedFramework,
  frameworkSearchRoot: string,
): IDetectedFramework {
  const match: IProjectMatch = {
    framework: detected.match.framework,
    projectRoot: detected.match.projectRoot,
    artifacts: detected.match.artifacts,
    ...(detected.match.version !== undefined
      ? { version: detected.match.version }
      : {}),
    frameworkSearchRoot,
  };
  return {
    match,
    score: detected.score,
    evidence: detected.evidence,
    scanner: detected.scanner,
    validation: detected.validation,
  };
}

/**
 * Is it a safe relative segment to use as `frameworkSearchRoot`?
 *
 * The two traps it avoids:
 *  - Absolute (`/etc/passwd`, `C:\...`): never accepted; the root is
 *    pinned by the orchestrator and this field only adds a segment.
 *  - Escape (`..`, `apps/../../etc`): if the user types it and nobody
 *    stops it, a scanner may end up reading outside the project.
 *    Scanners already do
 *    `join(match.projectRoot, match.frameworkSearchRoot)`, and
 *    `path.join` collapses `..`, so the only defense is here.
 */
function isSafeRelativeSubdir(value: string): boolean {
  if (value.length === 0) return false;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  if (value.includes("..")) return false;
  if (value.includes("\0")) return false;
  return true;
}

interface IDiscovery {
  readonly specs: ReadonlyArray<EndpointSpec>;
  readonly routes: ReadonlyArray<ParsedRoute>;
  readonly config: ProjectConfig;
  readonly match: IProjectMatch | null;
  readonly origin: "scanner" | "legacy";
  readonly withValidation: number;
  readonly withoutValidation: number;
  readonly warnings: ReadonlyArray<string>;
  /** All frameworks that recognized the project. */
  readonly frameworks: ReadonlyArray<string>;
  readonly project: IGenerationResult["project"];
  /** Provenance per endpoint, present only when detection was hybrid. */
  readonly provenance?: ReadonlyArray<IEndpointProvenanceEntry>;
  /** Matches that survived the `scanner !== null` filter. a00013 S3. */
  readonly matches: ReadonlyArray<IProjectMatch>;
  /** Routes grouped by serviceId (a00013 S3, feeds `toServiceGraph`). */
  readonly routesByService: ReadonlyMap<string, ReadonlyArray<ParsedRoute>>;
  /** Result of `detectMonorepo`; `undefined` for flat projects. */
  readonly monorepoDetection: IMonorepoDetection | undefined;
}

/**
 * Step 1-3: detection, scanning and override merge.
 *
 * Every framework goes through its scanner, Laravel included. The
 * legacy path only kicks in when the orchestrator does not recognize
 * the project, and is a zero-config heuristic over `routes/`.
 */
async function discoverSpecs(
  context: IProjectContext,
  options: IGenerationOptions,
): Promise<IDiscovery> {
  // Base detection against the root (fast path: a single framework at
  // the project root -- the 21 examples fall here).
  const rootDetected = options.forceFramework
    ? await forcedDetection(options, context.projectRoot)
    : await options.orchestrator.detectAll(context.projectRoot);

  // In monorepos (even single-workspace) and when the user forces
  // `--framework-search-root`, the root detection usually returns
  // empty: the monorepo root only orchestrates, it does not contain
  // the frameworks. Previously the helper returned
  // `frameworkSearchRoot: null` and the pipeline silently ended with
  // 0 endpoints.
  //
  // `expandMonorepoDetection` rewrites detection when appropriate:
  // for override it scans ONLY the workspace the user asked for; for
  // auto-detection multi-workspace it scans each workspace and
  // appends; for single-workspace it replaces the (empty) root with
  // the workspace's. Without override or monorepo, it returns what
  // the root detected -- the legacy path.
  //
  // Audit 2026-09-04 (finding P1 #1) + second review: when
  // `forceFramework` is active, the root detection already contains
  // that specific framework. Expanding it toward
  // `detectAll(workspaceRoot)` would lose the force: the workspace's
  // manifest might not allow detection (typical case: dependencies
  // declared elsewhere, manifest generated at build time).
  // `expandMonorepoDetection` receives `forceFramework` to respect the
  // user's decision and reorient the existing match instead of
  // re-detecting.
  //
  // Audit 2026-09-04 (second review #5): --framework + monorepo
  // must keep forcing that framework, not auto-detect it in each
  // workspace.
  const expanded = await expandMonorepoDetection(
    options.orchestrator,
    context.projectRoot,
    rootDetected,
    options.frameworkSearchRoot,
    options.forceFramework,
  );
  const { augmented: detected, detection: monorepoDetection } =
    await applyFrameworkSearchRoot(
      expanded,
      context.projectRoot,
      options.frameworkSearchRoot,
    );
  // With `context`: the loader stops asking the singleton which
  // project this is. It was the only place in the pipeline that
  // still did that, and the reason the whole call had to be wrapped.
  //
  // `argv` is passed **explicitly and empty** by default: the core
  // does not read `process.argv` at runtime. Whoever invokes the
  // pipeline (CLI, MCP plugin, web UI, tests) decides what to pass.
  // If it is omitted, `loadProject` treats the absence as "no
  // `--config` flag" -- behavior documented in `a00012 S4` and
  // verified by `tests/core/process-argv-free.spec.ts`.
  const { config, manualEndpoints, configPath, zeroConfig } = await loadProject(
    options.argv ?? [],
    context,
  );
  const project = { zeroConfig, configPath, manualEndpoints: manualEndpoints.length };
  const usable = detected.filter((candidate) => candidate.scanner !== null);

  // If the root was a monorepo and auto-detection chose the only
  // workspace, we warn. The idea is that a user who runs the CLI
  // without knowing what `frameworkSearchRoot` is sees why the scan
  // concentrated on `apps/api` instead of the root.
  const warnings: string[] = [];
  if (
    monorepoDetection?.frameworkSearchRoot &&
    !options.frameworkSearchRoot
  ) {
    warnings.push(
      `Monorepo detectado por ${monorepoDetection.signal}: el escaneo se ` +
        `limita al workspace "${monorepoDetection.frameworkSearchRoot}". ` +
        `Si quieres escanear otro, pásalo con --framework-search-root.`,
    );
  }

  if (usable.length > 0) {
    // We scan ALL the ones that recognize the project, not just the
    // first. A repo with a legacy Express and new Next.js routes
    // matches two, and keeping the winner silently returned 1 of 3
    // endpoints. Single-framework projects -- the 12 examples --
    // match a single detector, so for them this changes nothing.
    const specs: EndpointSpec[] = [];
    const routes: ParsedRoute[] = [];
    let withValidation = 0;
    let withoutValidation = 0;
    /** What each scanner returns, with its framework and score, for the merger. */
    interface IPerScanner {
      readonly framework: string;
      readonly scannerScore: number;
      readonly scannerSpecs: ReadonlyArray<EndpointSpec>;
      /**
       * Identity of the workspace / service the specs come from.
       * Audit 2nd review #3: in multi-workspace monorepos, two
       * `GET /health` endpoints from different workspaces must NOT
       * be fused. The merger uses `serviceId` to keep them apart.
       * Empty string = flat project (not applicable).
       */
      readonly serviceId: string;
      /**
       * Routes this scanner actually emitted. x00025 S1: the helper
       * `accumulateRoutesByService` no longer re-derives attribution
       * from the global `routes` array using `(method, uri)` —
       * that identity is not stable across services. Each scanner
       * owns its own slices, so we pass them directly.
       */
      readonly scannerRoutes: ReadonlyArray<ParsedRoute>;
    }
    const perScanner: IPerScanner[] = [];

    for (const candidate of usable) {
      const result = await buildSpecsFromScanner(
        candidate.scanner!,
        candidate.match,
        candidate.validation,
      );
      specs.push(...result.specs);
      routes.push(...result.routes);
      withValidation += result.withFormRequest;
      withoutValidation += result.withoutFormRequest;
      perScanner.push({
        framework: candidate.match.framework,
        scannerScore: candidate.score,
        scannerSpecs: result.specs,
        // MUST go through `deriveServiceId`, not the raw
        // `frameworkSearchRoot`: `toServiceGraph` looks routes up by
        // the NORMALIZED id (`apps/api` → `apps_api`), so raw keys
        // silently missed every lookup and every descriptor ended up
        // with empty `endpoints` — which made `filterSpecsForService`
        // fall back to the full global catalog (x00028's isolation
        // became a no-op for real monorepos; the x00028 test fixture
        // only passed because its temp path carried no `/`).
        serviceId: deriveServiceId(candidate.match),
        scannerRoutes: result.routes,
      });

      // A failing validation provider does NOT abort the generation
      // -- an endpoint without rules is still a valid collection --
      // but it cannot pass silently either: it was indistinguishable
      // from an endpoint that legitimately has no validation, and
      // that way a broken parser degraded the entire collection
      // without anyone noticing.
      if (result.validationFailures.length > 0) {
        warnings.push(
          `${result.validationFailures.length} endpoint(s) of ` +
            `${candidate.match.framework} have validation rules that could not ` +
            `be read; their bodies come from the agnostic inference instead. ` +
            `First one: ${result.validationFailures[0]}`,
        );
      }
    }

    let provenance: ReadonlyArray<IEndpointProvenanceEntry> | undefined;

    if (usable.length > 1) {
      const names = usable.map((c) => `${c.match.framework} (${c.score})`).join(", ");
      warnings.push(
        `The project matches ${usable.length} frameworks: ${names}. ` +
          "All of them have been scanned and the endpoints fused. " +
          "If any one is extraneous, narrow the scan with `--project-root` to the right folder.",
      );

      // Hybrid merge: each scanner contributes its specs with its
      // framework. The merger groups by identity (method + uri +
      // name + serviceId) and chooses piece by piece (body, fields,
      // auth, description) the most trustworthy one, leaving
      // provenance of who contributed what. Previously it did "first
      // wins" on the already-mixed specs, which silently lost the
      // info from the rest.
      const candidates = perScanner.flatMap(({ framework, scannerScore, scannerSpecs, serviceId }) =>
        scannerSpecs.map((spec) => ({
          framework,
          scannerScore,
          serviceId,
          method: spec.method,
          uri: spec.uri,
          ...(spec.name !== undefined && spec.name !== ""
            ? { name: spec.name }
            : {}),
          ...(spec.body !== undefined ? { body: spec.body } : {}),
          ...(spec.fields ? { fields: spec.fields } : {}),
          ...(spec.description !== undefined
            ? { description: spec.description }
            : {}),
          // Audit 2026-09-04 P1 #6: the per-operation auth scheme
          // override (`spec.auth`) must survive the merge.
          // Previously the merger only saw `body / fields /
          // description` and lost `auth: { kind: "none" }` for
          // /auth/login -- the merged endpoint came out with the
          // global auth even though the scanner had explicitly
          // asked for "public". Audit 2nd review #16: the mapping
          // must be EXHAUSTIVE per discriminator -- before, every
          // `spec.auth` collapsed to `type: "none"`, which meant
          // that a future `{ kind: "scheme", scheme: "apiKey" }`
          // would land as a public endpoint. Now every union branch
          // maps to its corresponding `authScheme`.
          ...(spec.auth !== undefined
            ? { authScheme: authSchemeFromEndpointAuth(spec.auth, framework) }
            : {}),
        })),
      );

      const mergedOutcome = mergeEndpoints(candidates);
      const merged = mergedOutcome.specs.map(endpointSpecFromMerged);
      provenance = mergedOutcome.provenance;
      for (const w of mergedOutcome.warnings) warnings.push(w);

      const collisions = specs.length - merged.length;
      if (collisions > 0) {
        warnings.push(
          `${collisions} endpoint(s) were declared by more than one ` +
            "framework and have been fused piece by piece " +
            "(route + body + auth + description) with provenance.",
        );
      }

      return {
        specs: mergeWithManual(merged, [...manualEndpoints]),
        routes,
        config,
        match: usable[0]!.match,
        origin: "scanner",
        withValidation,
        withoutValidation,
        warnings,
        frameworks: usable.map((c) => c.match.framework),
        project,
        provenance,
        matches: usable.map((c) => c.match),
        routesByService: accumulateRoutesByService(
          perScanner.map(({ serviceId, scannerRoutes }) => {
            // x00025 S1: cada scanner YA sabe qué rutas emitió
            // (`scannerRoutes: result.routes` en el push de arriba). Lo
            // que antes pasaba aquí era reconstruir esa atribución
            // re-filtrando el array global `routes` por `(method,
            // uri)` — exactamente la identidad inestable entre
            // servicios que x00025 cerró como P1. Reactivar ese
            // filtrado es el motivo por el que el test e2e de x00028
            // veía dos `GET /health` por servicio: el filtro global
            // atribuiría los health de `apps/users` Y `apps/orders` a
            // AMBOS descriptores, y luego `filterSpecsForService`
            // ya no tenía con qué restringir.
            return { serviceId, scannerRoutes };
          }),
        ),
        monorepoDetection: monorepoDetection ?? undefined,
      };
    }

    const merged = dedupeSpecs(specs);
    if (merged.length < specs.length) {
      warnings.push(
        `${specs.length - merged.length} endpoint(s) were declared by more than one ` +
          "framework and have been fused by method + URI.",
      );
    }

    return {
      specs: mergeWithManual(merged, [...manualEndpoints]),
      routes,
      config,
      match: usable[0]!.match,
      origin: "scanner",
      withValidation,
      withoutValidation,
      warnings,
      frameworks: usable.map((c) => c.match.framework),
      project,
      matches: usable.map((c) => c.match),
      routesByService: new Map([
        [deriveServiceId(usable[0]!.match), routes],
      ]),
      monorepoDetection: monorepoDetection ?? undefined,
    };
  }

  if (!options.legacyFallback) {
    // Without fallback and without a scanner that recognizes it: zero
    // endpoints. It is preferable to inventing a heuristic that
    // returns noise.
    return {
      specs: [...manualEndpoints],
      routes: [],
      config,
      match: null,
      origin: "legacy",
      withValidation: 0,
      withoutValidation: 0,
      project,
      warnings: [
        "No scanner recognized this project and no legacy fallback " +
          "was injected: the collection comes out empty. " +
          "See docs/FRAMEWORKS.md for what each scanner looks for.",
      ],
      frameworks: [],
      matches: [],
      routesByService: new Map(),
      monorepoDetection: undefined,
    };
  }

  const legacy = await options.legacyFallback.discover(
    config,
    manualEndpoints,
    context,
  );
  return {
    specs: legacy.specs,
    routes: legacy.routes,
    config,
    match: null,
    origin: "legacy",
    withValidation: legacy.withValidation,
    withoutValidation: legacy.withoutValidation,
    project,
    warnings:
      legacy.routes.length === 0
        ? [
            "No scanner recognized the project and the legacy fallback " +
              "heuristic did not find any routes either.",
          ]
        : [],
    frameworks: [],
    matches: [],
    routesByService: new Map(),
    monorepoDetection: undefined,
  };
}

/**
 * Removes duplicate endpoints.
 *
 * In a hybrid project two frameworks can declare the same route (a
 * Next.js proxy in front of an Express, for example). The first one
 * wins, which comes from the most confident detector.
 *
 * The key includes the **name**, not just method and URI. With REST
 * the two are enough because the URL identifies the operation; with
 * GraphQL there is only **one** endpoint -- `POST /graphql` -- and
 * what distinguishes one query from another is the body. Deduplicating
 * by method + URI alone, a twenty-operation schema produced **one**
 * request.
 *
 * The same is true for any RPC-over-POST, which is a much more
 * common API shape than the hybrid case this was originally written
 * for.
 */
function dedupeSpecs(specs: ReadonlyArray<EndpointSpec>): EndpointSpec[] {
  const seen = new Set<string>();
  const out: EndpointSpec[] = [];
  for (const spec of specs) {
    const key = endpointKey({ method: spec.method, uri: spec.uri, name: spec.name });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec);
  }
  return out;
}
