/**
 * `computeProjectHealth` — the health of the documentation, in
 * percentages.
 *
 * The contract fixed here is the one consumed by the CLI (`summary`
 * in text), the MCP tool (`summary.health`), and, since f00010 S3, the
 * UI cards. Three properties are worth more than ten cases:
 *
 *   · With zero endpoints, everything is `0` — never `NaN`, never
 *     `100` without routes.
 *   · Each percentage counts **final specs**: what it says is what
 *     `generate` would write, no more and no less.
 *   · Rounding is to integer, so the number is shown as-is across the
 *     three surfaces.
 */
import { describe, expect, test } from "vitest";

import { computeProjectHealth } from "../../packages/core/domain/project-health.service";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";

/** Helper to build a minimal EndpointSpec in tests. */
function spec(partial: Partial<EndpointSpec>): EndpointSpec {
  return {
    name: "Get users",
    method: "GET",
    uri: "/users",
    ...partial,
  };
}

describe("computeProjectHealth", () => {
  test("with 0 routes, all percentages are 0", () => {
    expect(computeProjectHealth([])).toEqual({
      withValidationPercent: 0,
      withBodySchemaPercent: 0,
      withExamplesPercent: 0,
      withDescriptionPercent: 0,
    });
  });

  test("with all routes validated, validation is 100", () => {
    const specs = [
      spec({ formRequest: "laravel:App\\\\Http\\\\Requests\\\\UserRequest" }),
      spec({ formRequest: "laravel:App\\\\Http\\\\Requests\\\\OrderRequest" }),
    ];
    const health = computeProjectHealth(specs);
    expect(health.withValidationPercent).toBe(100);
  });

  test("mix: each category is counted by its own piece, not by the others", () => {
    // Four endpoints, each one covers a part of the board:
    //   1. validated, with rule body, with examples, with description.
    //   2. validated, with rule body, without description.
    //   3. not validated, with inferred body and examples.
    //   4. not validated, no body, no description.
    const specs = [
      spec({
        method: "POST",
        formRequest: "laravel:App\\\\Http\\\\Requests\\\\UserRequest",
        body: { email: "user@example.com" },
        description: "Crea un usuario.",
      }),
      spec({
        method: "POST",
        formRequest: "laravel:App\\\\Http\\\\Requests\\\\OrderRequest",
        body: { total: 1 },
      }),
      spec({
        method: "POST",
        body: { page: 1 },
        query: [{ key: "page", value: "1" }],
      }),
      spec({ method: "DELETE", uri: "/users/{{id}}" }),
    ];
    const health = computeProjectHealth(specs);

    // Validation: 2 of 4. Body: 3 of 4 (the DELETE has none). Examples:
    // 3 of 4 (the same three: all carry body with values).
    // Description: 1 of 4.
    expect(health.withValidationPercent).toBe(50);
    expect(health.withBodySchemaPercent).toBe(75);
    expect(health.withExamplesPercent).toBe(75);
    expect(health.withDescriptionPercent).toBe(25);
  });

  test("an empty body does not count as documented body", () => {
    // `body: {}` is the gap left by rules whose example could not be
    // built; counting it would inflate the score with an empty.
    const health = computeProjectHealth([spec({ method: "POST", body: {} })]);
    expect(health.withBodySchemaPercent).toBe(0);
    expect(health.withExamplesPercent).toBe(0);
  });

  test("params with a value count as examples even without a body", () => {
    const health = computeProjectHealth([
      spec({ query: [{ key: "page", value: "1" }] }),
    ]);
    expect(health.withExamplesPercent).toBe(100);
  });

  test("a whitespace-only description does not count as description", () => {
    const health = computeProjectHealth([spec({ description: "   " })]);
    expect(health.withDescriptionPercent).toBe(0);
  });

  test("percentages are rounded to integer", () => {
    // 1 of 3 = 33.33…% → 33. A number with decimals here would end up
    // split between the CLI and the tool.
    const health = computeProjectHealth([
      spec({ formRequest: "laravel:x" }),
      spec({}),
      spec({}),
    ]);
    expect(health.withValidationPercent).toBe(33);
  });
});
