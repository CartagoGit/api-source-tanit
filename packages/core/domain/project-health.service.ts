/**
 * Health of a project's documentation: percentages by category.
 *
 * The question it answers is not "how many endpoints are there?" —the
 * `routesInCode` and company already say that— but "how well documented
 * are they?" A summary that does not answer it forces the person inspecting
 * the project to manually count how many routes include a body or description.
 *
 * It is a **pure** function: it consumes the pipeline's final specs—the
 * same ones that feed the collection—and returns percentages. No disk I/O,
 * no new heuristics: each category is measured against a piece already
 * carried by the spec, so what the health says is what `generate` produces.
 */
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";
import type { IProjectHealth } from "../../contracts/interfaces/core/domain.interface.js";

/**
 * Computes the project's health from the final specs.
 *
 * With zero endpoints, all percentages are `0`: there is nothing to
 * document, and a `NaN` or a 100 without routes would be the two possible
 * lies. With routes, each percentage is the quotient of endpoints that
 * include the piece, rounded to an integer so the CLI and MCP tool display
 * it as-is.
 *
 * The body counts if the spec carries one—from resolved rules or from
 * agnostic inference, which has already run before this point. Examples
 * count when the body has a value or params have a value; these are the two
 * ways the collection teaches the user **one** valid value.
 */
export function computeProjectHealth(
  specs: ReadonlyArray<EndpointSpec>,
): IProjectHealth {
  const total = specs.length;
  if (total === 0) {
    return {
      withValidationPercent: 0,
      withBodySchemaPercent: 0,
      withExamplesPercent: 0,
      withDescriptionPercent: 0,
    };
  }

  const withValidation = specs.filter((s) => s.formRequest != null).length;
  const withBodySchema = specs.filter(hasBodyContent).length;
  const withExamples = specs.filter(hasExampleValues).length;
  const withDescription = specs.filter((s) => hasText(s.description)).length;

  return {
    withValidationPercent: percent(withValidation, total),
    withBodySchemaPercent: percent(withBodySchema, total),
    withExamplesPercent: percent(withExamples, total),
    withDescriptionPercent: percent(withDescription, total),
  };
}

/**
 * The body "counts" when it contains real content.
 *
 * An empty `body: {}` comes from rules whose example could not be
 * built; counting it as documented would inflate the score with a
 * gap. The empty object is also the default `body` for manual specs
 * without overrides, so the exclusion covers both.
 */
function hasBodyContent(spec: EndpointSpec): boolean {
  return (
    spec.body != null &&
    typeof spec.body === "object" &&
    !Array.isArray(spec.body) &&
    Object.keys(spec.body).length > 0
  );
}

/**
 * There are examples when the body contains a value or a param has one.
 *
 * These are the two ways the collection teaches the user **one** valid value:
 * the example body for what is sent, and query/headers with values
 * for what travels in the URL or headers.
 */
function hasExampleValues(spec: EndpointSpec): boolean {
  if (hasBodyContent(spec)) return true;
  const queryWithValue = spec.query?.some((q) => q.value !== "") ?? false;
  return queryWithValue;
}

function hasText(text: string | undefined): boolean {
  return text != null && text.trim() !== "";
}

/** Integer percentage, rounded. `0..100` guaranteed. */
function percent(part: number, total: number): number {
  return Math.round((part / total) * 100);
}
