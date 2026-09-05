/**
 * a00012 S5 — `IValidationSource` + `runValidationEnrichers` registry.
 *
 * Three minimal tests to fix the agnostic contract:
 *
 *   1. A spec with `provider: "zod"` (registrable in the future) is NOT
 *      affected by the Laravel enricher: the registry returns the same
 *      object when the provider has no enricher registered.
 *   2. A spec with `provider: "laravel-form-request"` DOES go through
 *      the registered enricher. Phase 1 leaves it idempotent, so the
 *      assertion is that it returns intact, but **having passed**
 *      through the enricher (we demonstrate it by registering a stub
 *      that changes the `description` and seeing the change appear).
 *   3. A spec without `validationSource` is not touched: the registry
 *      is a no-op for endpoints the adapter left without a provider.
 *
 * The stub for test 2 is local and is unregistered at the end; that
 * way it does not pollute global state between tests.
 */
import { afterEach, describe, expect, test } from "vitest";

import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";
import {
  _resetValidationEnrichersForTests,
  getValidationEnricher,
  registerValidationEnricher,
  runValidationEnrichers,
} from "../../packages/core/validation/validation-enricher.service";
import type { IValidationEnricher } from "../../packages/core/validation/validation-enricher.service";

/** Helper to build minimal specs in tests. */
function spec(partial: Partial<EndpointSpec>): EndpointSpec {
  return {
    name: "x",
    method: "POST",
    uri: "/x",
    ...partial,
  };
}

afterEach(() => {
  _resetValidationEnrichersForTests();
});

describe("runValidationEnrichers — agnostic contract", () => {
  test("a provider without a registered enricher does NOT affect the spec", () => {
    // We register nothing: `getValidationEnricher("zod")` returns
    // `undefined`. The S5 invariant is that any provider without an
    // enricher (zod, joi, json-schema, …) lets the spec pass through
    // unchanged. An Express project must never end up mutated by a
    // wrong enricher.
    const before = spec({
      validationSource: { provider: "zod", reference: "OrderSchema" },
    });
    const after = runValidationEnrichers(before);
    expect(after).toBe(before); // same reference: no copy is built.
  });

  test("a registered provider DOES run its enricher", () => {
    // Phase 1: `LARAVEL_FORM_REQUEST_ENRICHER` is idempotent. To
    // demonstrate that the registry really dispatches, we register a
    // stub that mutates the description and check that the change
    // appears. Keeping it local to the test is important: if the
    // registry leaked state across tests, this would break.
    const stub: IValidationEnricher = {
      provider: "laravel-form-request",
      enrich: (s) => ({
        ...s,
        description: `${s.description ?? ""}\n[enriched-by-stub]`,
      }),
    };
    registerValidationEnricher(stub);

    const before = spec({
      validationSource: {
        provider: "laravel-form-request",
        reference: "app/Http/Requests/StoreUserRequest.php",
      },
    });
    const after = runValidationEnrichers(before);
    expect(after.description).toContain("[enriched-by-stub]");
  });

  test("a spec without validationSource is NOT affected", () => {
    // Without `validationSource` there is nothing to route: the
    // registry returns the same spec. This is the basis of "a project
    // the adapter did not mark as Laravel stays unenriched".
    const before = spec({});
    const after = runValidationEnrichers(before);
    expect(after).toBe(before);
  });
});

describe("registry helpers", () => {
  test("getValidationEnricher returns undefined when there is no enricher", () => {
    expect(getValidationEnricher("joi")).toBeUndefined();
  });

  test("getValidationEnricher returns the registered enricher", () => {
    const stub: IValidationEnricher = {
      provider: "joi",
      enrich: (s) => s,
    };
    registerValidationEnricher(stub);
    expect(getValidationEnricher("joi")).toBe(stub);
  });
});
