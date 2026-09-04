/**
 * Contract of the project-agnostic validation enricher (S5 / a00012).
 *
 * An `IValidationEnricher` receives an `IEndpointSpec` and returns
 * another `IEndpointSpec` with whatever modifications its provider
 * needs.
 *
 *   - `provider` is the discriminator: the registry
 *     (`packages/core/validation/validation-enricher.service.ts`)
 *     dispatches on it, so two enrichers sharing the same `provider`
 *     collide.
 *   - `enrich` is **pure**: it does not mutate the input, it returns
 *     a new one. That allows composing several enrichers in the
 *     future without a failure in one contaminating the next.
 *
 * The contract is per-spec on purpose: the Postman collection mixes
 * folders, requests, scripts and descriptions, and moving all of
 * that into an `IEndpointSpec` would force fields such as
 * `bodyVariants: PostmanItem[]` nobody asked for. Phase 1 (S5)
 * keeps the enrichers idempotent; the actual variant generation
 * stays in `enrichCatalogWithFormRequests`, which is now a wrapper
 * that dispatches by provider.
 *
 * The interface lives in `contracts/` and not next to the registry
 * to honour the repo's invariant: reading an enricher's type must
 * never cost importing the registry (which drags in runtime logic).
 */
import type { EndpointSpec } from "./postman.interface.js";
import type { ValidationProvider } from "../../constants/core/validation-provider.constant.js";

export interface IValidationEnricher {
  readonly provider: ValidationProvider;
  enrich(spec: EndpointSpec): EndpointSpec;
}
