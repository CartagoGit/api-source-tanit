/**
 * Source of the validation rules of an endpoint.
 *
 * It replaces the legacy `EndpointSpec.formRequest: string` field,
 * which mixed the **provider** with the **artifact path** without
 * any structure. The contract now is:
 *
 *   - `provider`: the project-agnostic catalogue
 *     (`VALIDATION_PROVIDERS`). The adapter picks it based on the
 *     detected framework.
 *   - `reference`: the concrete identifier of the resource (FQCN,
 *     path to the file, schema name, …). Its format depends on
 *     **the provider** and is not interpreted outside its enricher.
 *
 * The adapter (a00012 S5) only fills in this field when the
 * resulting provider is `"laravel-form-request"`: the rest of the
 * frameworks either have no provider registered or have not migrated
 * yet. That is the invariant that closes S5: an Express project
 * never carries a `validationSource` even when its provider returns
 * rules.
 */
import type { ValidationProvider } from "../../constants/core/validation-provider.constant.js";

export interface IValidationSource {
  /** Project-agnostic provider (`"laravel-form-request"`, `"zod"`, …). */
  readonly provider: ValidationProvider;
  /** Concrete identifier that the enricher of the provider can resolve. */
  readonly reference: string;
}
