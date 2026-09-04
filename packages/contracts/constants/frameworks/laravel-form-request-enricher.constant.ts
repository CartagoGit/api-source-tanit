/**
 * Default instance of the enricher for `provider: "laravel-form-request"`.
 *
 * Phase 1 (S5 / a00012): the enricher is **idempotent** — it returns
 * the `EndpointSpec` as is. The actual generation of body and query
 * variants still lives in `enrichCatalogWithFormRequests`, a legacy
 * function in `packages/frameworks/laravel/catalog-enricher.service.ts`
 * that operates on the whole Postman collection, not on individual
 * specs.
 *
 * Moving that logic into the enricher is an explicit follow-up: the
 * per-spec contract is complete once `IEndpointSpec` can carry its
 * variants (next phase of the stabilization plan). Until then,
 * registering this enricher accomplishes two things:
 *
 *   1. It makes `runValidationEnrichers` not return `undefined` for
 *      Laravel specs (the provider is covered).
 *   2. It lets `generate` add the side-effect import
 *      (`registerValidationEnricher(LARAVEL_FORM_REQUEST_ENRICHER)`)
 *      without `core` having to know about Laravel.
 *
 * The enricher lives here (in `contracts/constants/`) and NOT next to
 * the registry so that the `lint:contracts` invariant stays green:
 * declaring the contract and its default instance where there is
 * only data means `frameworks/laravel/catalog-enricher.service.ts`
 * can import `LARAVEL_FORM_REQUEST_ENRICHER` without dragging the
 * registry along for whoever only wants the name.
 */
import type { EndpointSpec } from "../../interfaces/core/postman.interface.js";
import type { IValidationEnricher } from "../../interfaces/core/validation-enricher.interface.js";

export const LARAVEL_FORM_REQUEST_ENRICHER: IValidationEnricher = {
  provider: "laravel-form-request",
  enrich: (spec: EndpointSpec): EndpointSpec => spec,
};
