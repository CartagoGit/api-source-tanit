/**
 * Catalog of framework-agnostic validation providers.
 *
 * Replaces the old implicit flag that lived in
 * `EndpointSpec.formRequest`, where the adapter mixed the
 * **framework name** with the **artifact path**
 * (`"laravel:app/Http/..."`). The result was that any framework
 * could end up with a `formRequest` that only Laravel's enricher
 * understood — a silent cross-dependency.
 *
 * This lists the providers the orchestrator knows how to route to
 * a specific enricher. The rule is:
 *
 *   1. If an endpoint has `validationSource.provider === X`, the
 *      registry MUST have an enricher for X.
 *   2. Otherwise, the endpoint stays **without enrichment** (not an
 *      error: "this framework contributes no rules" — what S5 wants
 *      preserved).
 *
 * "manual" represents the catalog declared by hand in
 * `endpoints.constant.ts`: the user provides the rules, there is no
 * automatic enricher. The adapter should NEVER assign this provider —
 * it is only a valid value for hosts that fill `validationSource` in
 * by hand.
 *
 * S5 (a00012). The old `formRequest: string` is kept in
 * `EndpointSpec` for backwards compatibility, but new providers
 * declare their contract through this catalog.
 */
export const VALIDATION_PROVIDERS = [
  "zod",
  "joi",
  "json-schema",
  "express-validator",
  "nest-pipes",
  "laravel-form-request",
  "manual",
] as const;

/** Stable id of a validation provider. */
export type ValidationProvider = (typeof VALIDATION_PROVIDERS)[number];
