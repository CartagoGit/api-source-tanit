/**
 * Per-service auth and baseUrl wiring — a00013 S4.
 *
 * The `IEndpointAuth` discriminant (`{ kind: "none" } | { kind: "scheme",
 * scheme: "bearer" | "apiKey" | "oauth2" }`) is exhaustive by type:
 * TypeScript rejects any assignment that does not fit one of its two branches.
 * A careless `{ kind: "scheme", scheme: "bearer" }` →
 * `{ kind: "none" }` conversion (documented as the "opposite bug" by the first
 * 2026-09-04 audit) is avoided **by construction** here: these helpers simply
 * return the objects they receive without rewriting `kind`. If someone adds a
 * shortcut that collapses branches, the discriminant stops protecting the
 * contract and this layer loses its only line of defense.
 *
 * Why this is a separate module from the merger and pipeline:
 *  - The merger side already has a private `authFromAuthScheme`
 *    (`endpoint-merger.service.ts:347`) that converts
 *    `IDetectedAuthScheme → IEndpointAuth`. It is the semantic inverse of
 *    `authSchemeFromEndpointAuth` in `generation.pipeline.ts`. DRY across all
 *    three conversions belongs to a later slice; S4 only needs the per-service
 *    path, which enters through `service.auth` and requires `pickAuth`.
 *  - The pipeline side needs a small `IDetectedAuthScheme → IEndpointAuth`
 *    adapter to feed `pickAuth` with a project-wide fallback. Export it here
 *    rather than as `authFromAuthScheme` to avoid colliding with the merger's
 *    name, and keep it in this module because S4's tests need both directions
 *    in one place.
 *
 * Pure: no I/O, no `process.cwd()`, no mutation.
 *
 * @see ./generation.pipeline.ts for the `buildForService` call site.
 * @see ./group-by-service.helper.ts for the `IServiceDescriptor` source passed
 *   to these helpers.
 * @see ../../contracts/interfaces/core/postman.interface.ts for the
 *   `IEndpointAuth` shape.
 */

import type { IEndpointAuth } from "../../contracts/interfaces/core/postman.interface.js";
import type { IDetectedAuthScheme } from "../../contracts/interfaces/core/discovery.interface.js";
import type { ProjectConfig } from "../../contracts/interfaces/core/project-config.interface.js";
import type { IServiceDescriptor } from "../../contracts/interfaces/core/service-graph.interface.js";

/**
 * Resolves service auth: the descriptor's override when present (as placed by
 * the graph), or the inherited project fallback.
 *
 * The return value preserves the discriminant: if `service.auth` is
 * `{ kind: "scheme", scheme: "bearer" }`, return it exactly; do not convert it
 * to `{ kind: "none" }` or `{ kind: "scheme", scheme: "apiKey" }`. The
 * function does not know—and does not need to know—how to handle each variant.
 * Its contract is "the first argument wins when defined; otherwise, the
 * second".
 *
 * Both arguments are `IEndpointAuth | undefined`. When both are `undefined`,
 * return `undefined`. This means there is no auth signal for the service and
 * lets the pipeline decide whether the per-spec detector should run or the
 * caller already supplied another mechanism.
 *
 * @param service The service descriptor. `service.auth` may be `undefined`
 *   (inherits from the project); `null` is invalid (`baseUrl` is `string | null`,
 *   but `auth` is strictly `IEndpointAuth | undefined`).
 * @param fallback The auth inherited from the project, typically the result of
 *   `toIEndpointAuth(detectedFromSpecs)`. It may be `undefined` when the project
 *   has no auth signal either.
 */
export function pickAuth(
  service: IServiceDescriptor,
  fallback: IEndpointAuth | undefined,
): IEndpointAuth | undefined {
  if (service.auth !== undefined) return service.auth;
  return fallback;
}

/**
 * Exhaustive `IDetectedAuthScheme` → `IEndpointAuth` conversion, semantically
 * inverse to `authSchemeFromEndpointAuth` in `generation.pipeline.ts`.
 *
 * Exported separately so S4 tests can cover all four discriminant cases
 * (`none`, `bearer`, `apiKey`, `oauth2`) without threading a fake
 * IDetectedAuthScheme through the pipeline.
 *
 * The switch is exhaustive by type: if a variant is added to `AuthSchemeType`
 * without being mapped here, TypeScript marks the switch as non-exhaustive
 * (TS7030 with `noImplicitReturns`). `authSchemeFromEndpointAuth` uses the
 * same pattern in the opposite direction.
 */
export function toIEndpointAuth(detected: IDetectedAuthScheme): IEndpointAuth {
  switch (detected.type) {
    case "bearer":
      return { kind: "scheme", scheme: "bearer" };
    case "apikey":
      return { kind: "scheme", scheme: "apiKey" };
    case "oauth2":
      return { kind: "scheme", scheme: "oauth2" };
    case "none":
      return { kind: "none" };
  }
}

/**
 * Applies per-service overrides to `ProjectConfig` **without mutating the
 * original**. Returns a shallow copy with:
 *   - `baseUrl`: the service's value when declared and non-null; otherwise,
 *     the project's value. This is what `inferCollectionVariables` and
 *     `buildCollection` consume in `buildForService`.
 *   - `variables`: an array copy whose `baseUrl` entry is replaced with the
 *     effective value so the collection variable (`{{baseUrl}}`) reflects the
 *     per-service override.
 *
 * Pure: does not touch `config`. Each iteration of the multi-service loop in
 * `buildFor` is independent—the next iteration receives the original
 * `discovery.config` with no baseUrl contaminated by the previous service
 * (S4 acceptance #3: `buildForService` does not mutate `config.baseUrl`
 * between iterations).
 *
 * @see `IProjectContext` for the root context. If more per-service overrides are
 * added in the future (global auth, extra headers, URI prefixes, etc.), this
 * helper is the natural place to extend them.
 */
export function buildServiceConfig(
  config: ProjectConfig,
  service: IServiceDescriptor,
): ProjectConfig {
  const baseUrl = service.baseUrl ?? config.baseUrl;
  const variables = config.variables.map((v) =>
    v.key === "baseUrl" ? { ...v, value: baseUrl } : v,
  );
  return {
    ...config,
    baseUrl,
    variables,
  };
}
