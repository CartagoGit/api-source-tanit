import type { IGenerationResult } from "../contracts/interfaces/core/discovery.interface.js";
import { normalizeForComparison } from "../core/helpers/uri.helper.js";
import { registerValidationEnricher } from "../core/validation/validation-enricher.service.js";
import {
  enrichCatalogWithFormRequests,
  enrichValidationSources,
  LARAVEL_FORM_REQUEST_ENRICHER,
} from "./laravel/catalog-enricher.service.js";

/** Prepare framework validation variants once for every consumer of the shared pipeline. */
export async function prepareFrameworkGeneration(result: IGenerationResult): Promise<IGenerationResult> {
  registerValidationEnricher(LARAVEL_FORM_REQUEST_ENRICHER);
  enrichValidationSources(result.specs);
  const index = new Map<string, string>();
  for (const spec of result.specs) {
    if (spec.formRequest && (
      result.frameworks.includes("laravel") || spec.validationSource?.provider === "laravel-form-request"
    )) {
      index.set(`${spec.method} ${normalizeForComparison(spec.uri.replace(/^\//, ""))}`, spec.formRequest);
    }
  }
  await enrichCatalogWithFormRequests(result.collection, index, result.context);
  return result;
}
