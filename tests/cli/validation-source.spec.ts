/**
 * a00012 S5 — `generate` against an Express project.
 *
 * Assertion: the adapter no longer writes `validationSource` on
 * endpoints whose framework is not Laravel. The invariant to close:
 *
 *   "an Express project NEVER enters via `enrichCatalogWithFormRequests`"
 *
 * We prove that by loading `example-express`, asking the universal
 * adapter for specs, and checking that none of them carries
 * `validationSource.provider === "laravel-form-request"` — not even
 * when the configured provider returns rules.
 *
 * It is a short integration test: it uses the adapter's public API
 * (`buildSpecsFromScanner`) plus a synthetic scanner that claims to be
 * express but exposes a provider that ALWAYS returns rules. Before
 * S5 that ended with `formRequest: "express:..."` and an unnecessary
 * trip through the Laravel enricher; now the adapter discards the
 * provider because `laravelFormRequestProvider("express")` returns
 * `undefined`.
 */
import { describe, expect, test } from "vitest";

import { buildSpecsFromScanner } from "../../packages/core/adapters/parsed-route-to-spec.adapter";
import type {
  IProjectMatch,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../packages/contracts/interfaces/core/scanner.interface";

/** A synthetic `IProjectMatch` for an Express project. */
const MATCH_EXPRESS: IProjectMatch = {
  framework: "express",
  projectRoot: "/tmp/express",
  artifacts: [],
};

/** Scanner that returns the only route we care about. */
function expressScanner(route: ParsedRoute): IRouteScanner {
  return {
    framework: "express",
    matches: () => true,
    scan: async () => ({ routes: [route] }),
  };
}

/**
 * "Friendly" provider that ALWAYS returns rules for any route.
 * Before S5 this caused the adapter to assign
 * `formRequest: "express:..."` even though the detected framework
 * was not Laravel. After S5 the adapter discards this result.
 */
const friendlyProvider: IValidationSpecProvider = {
  framework: "express",
  supports: async () => true,
  resolve: async (r) => ({
    endpointKey: `${r.method} ${r.uri}`,
    fields: [
      {
        fieldName: "name",
        location: "body",
        type: "string",
        required: true,
      } satisfies IValidationSpec,
    ],
  }),
};

const route = (overrides: Partial<ParsedRoute>): ParsedRoute => ({
  method: "POST",
  uri: "/users",
  rawUri: "/users",
  sourceFile: "src/routes.ts",
  lineNumber: 1,
  prefixChain: [],
  ...overrides,
});

describe("a00012 S5 — generate against an Express project", () => {
  test("the adapter does NOT assign validationSource to an Express endpoint", async () => {
    const result = await buildSpecsFromScanner(
      expressScanner(route({ method: "POST", uri: "/users" })),
      MATCH_EXPRESS,
      friendlyProvider,
    );
    // The adapter returned a spec, which confirms the provider ran
    // and returned rules. That is what would have BEFORE activated
    // the Laravel enricher (incorrectly).
    expect(result.specs).toHaveLength(1);
    const ep = result.specs[0];
    expect(ep).toBeDefined();
    // The S5 invariant: `validationSource` stays undefined for
    // frameworks whose provider is not Laravel. The legacy
    // `formRequest` field may still be there (it is not the target
    // of this slice), but `validationSource` must be `undefined`.
    expect(ep?.validationSource).toBeUndefined();
  });

  test("the adapter DOES assign validationSource to a Laravel endpoint", async () => {
    // The opposite case: a Laravel project with friendly provider.
    // Here the adapter MUST write `validationSource.provider ===
    // "laravel-form-request"` and let `enrichCatalogWithFormRequests`
    // do its job.
    const MATCH_LARAVEL: IProjectMatch = {
      framework: "laravel",
      projectRoot: "/tmp/laravel",
      artifacts: [],
    };
    const result = await buildSpecsFromScanner(
      expressScanner(route({ method: "POST", uri: "/users" })),
      MATCH_LARAVEL,
      friendlyProvider,
    );
    expect(result.specs).toHaveLength(1);
    const ep = result.specs[0];
    expect(ep?.validationSource?.provider).toBe("laravel-form-request");
    expect(ep?.validationSource?.reference).toContain("laravel");
  });

  test("an endpoint without provider does NOT receive validationSource", async () => {
    // Without a provider, the adapter should not assign
    // validationSource (nor formRequest) — these are projects where
    // the scanner simply does not know how to validate. The S5
    // invariant remains "only Laravel carries validationSource".
    const result = await buildSpecsFromScanner(
      expressScanner(route({ method: "POST", uri: "/users" })),
      MATCH_EXPRESS,
      null,
    );
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.validationSource).toBeUndefined();
    expect(result.specs[0]?.formRequest).toBeUndefined();
  });
});
