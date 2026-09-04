/**
 * Registry of framework-agnostic validation enrichers.
 *
 * Replaces the global call to `enrichCatalogWithFormRequests` (Laravel
 * only) with a per-`ValidationProvider` dispatcher. The S5 migration
 * (a00012) has two rules:
 *
 *   1. The adapter only writes `spec.validationSource.provider` when
 *      the provider is registered. Today that is exclusively
 *      `"laravel-form-request"`; tomorrow also `"zod"`, `"joi"`, ...
 *   2. Each provider has ONE enricher. It is registered in the
 *      `generate` bootstrap (side-effect import) and made available to
 *      `runValidationEnrichers`.
 *
 * The enricher operates per **spec**, not per collection. The reason
 * is structural: the Postman collection mixes folders, requests,
 * scripts, and descriptions, and moving all of that to the
 * EndpointSpec level would require a `bodyVariants: PostmanItem[]`
 * field that nobody asked for. In Phase 1 enrichers are idempotent
 * — they return the spec unchanged — and the actual variant
 * generation still lives in `enrichCatalogWithFormRequests`, which is
 * now a wrapper that dispatches by provider. Moving the full logic to
 * the enricher is an explicit follow-up.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { ValidationProvider } from "../../contracts/constants/core/validation-provider.constant.js";
import type { IValidationEnricher } from "../../contracts/interfaces/core/validation-enricher.interface.js";

/**
 * Enricher contract.
 *
 * `provider` is the registry discriminator; `enrich` takes a spec and
 * returns a spec. Immutable: the enricher does not mutate the input,
 * it returns a new one if changes are needed. That is the condition
 * for the registry to be composable and for a failure in one enricher
 * not to contaminate the next.
 *
 * The declaration lives in
 * `packages/contracts/interfaces/core/validation-enricher.interface.ts`
 * to satisfy the `lint:contracts` invariant: the type must be
 * readable without importing this module (which drags the runtime Map).
 */
// Re-export so we don't break anyone who imported `IValidationEnricher`
// from here. New imports should go to contracts/.
export type { IValidationEnricher };

const registry = new Map<ValidationProvider, IValidationEnricher>();

/**
 * Registers (or replaces) an enricher for its provider.
 *
 * Idempotent: registering the same provider twice leaves the second
 * one active. The contract says "one enricher per provider", so
 * double registrations are a programming error — but the registry
 * does not complain because a test that registers a stub and then the
 * real one (or vice versa) is still useful as long as they behave the
 * same.
 */
export function registerValidationEnricher(e: IValidationEnricher): void {
  registry.set(e.provider, e);
}

/** Returns the registered enricher, or `undefined` if none. */
export function getValidationEnricher(
  p: ValidationProvider,
): IValidationEnricher | undefined {
  return registry.get(p);
}

/**
 * Runs the enricher registered for the spec's `provider`.
 *
 *   - No `validationSource` → nothing to enrich; returns the spec unchanged.
 *   - With `validationSource` but no registered enricher → not an
 *     error: it means that framework has not migrated yet. The spec
 *     comes back unchanged.
 *   - With a registered enricher → returns `enricher.enrich(spec)`.
 *
 * The function is pure and synchronous. Phase 1 only needs this;
 * moving I/O into the enrichers is follow-up for the next phase (each
 * provider already loads its rules when building the spec, in the
 * adapter).
 */
export function runValidationEnrichers(spec: EndpointSpec): EndpointSpec {
  const vs = spec.validationSource;
  if (!vs) return spec;
  const e = registry.get(vs.provider);
  if (!e) return spec;
  return e.enrich(spec);
}

/** Only for tests: empties the registry. Do not use in production code. */
export function _resetValidationEnrichersForTests(): void {
  registry.clear();
}
