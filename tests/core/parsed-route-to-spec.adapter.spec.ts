import { describe, expect, test } from "vitest";
import { buildSpecsFromScanner, toPostmanUri } from "../../packages/core/adapters/parsed-route-to-spec.adapter";
import { SUPPORTED_METHODS } from "../../packages/contracts/constants/core/postman.constant";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface";
import type {
  IProjectMatch,
  IRouteScanner,
  IValidationSpec,
  IValidationSpecProvider,
  ParsedRoute,
} from "../../packages/contracts/interfaces/core/scanner.interface";

const MATCH: IProjectMatch = {
  framework: "demo",
  projectRoot: "/tmp/demo",
  artifacts: [],
};

/**
 * An `EndpointSpec`'s `body` is `unknown` on purpose: the adapter
 * emits arbitrary JSON. To assert on a specific field, TypeScript has
 * to be told it is read as an object.
 */
function bodyOf(spec: { body?: unknown } | undefined): Record<string, unknown> {
  return (spec?.body ?? {}) as Record<string, unknown>;
}

function route(partial: Partial<ParsedRoute>): ParsedRoute {
  return {
    method: "GET",
    uri: "/items",
    rawUri: "/items",
    sourceFile: "src/routes.ts",
    lineNumber: 1,
    prefixChain: [],
    ...partial,
  };
}

function scannerOf(routes: ParsedRoute[]): IRouteScanner {
  return {
    framework: "demo",
    matches: () => true,
    scan: async () => ({ routes }),
  };
}

function providerOf(
  fields: IValidationSpec[],
  options: { throws?: boolean } = {},
): IValidationSpecProvider {
  return {
    framework: "demo",
    supports: async () => true,
    resolve: async (r) => {
      if (options.throws) throw new Error("provider roto");
      return { endpointKey: `${r.method} ${r.uri}`, fields };
    },
  };
}

const field = (partial: Partial<IValidationSpec>): IValidationSpec => ({
  fieldName: "name",
  location: "body",
  type: "string",
  required: true,
  ...partial,
});

describe("toPostmanUri — parameter normalization", () => {
  test.each([
    ["/users/{id}", "/users/{{id}}"],
    ["/users/:id", "/users/{{id}}"],
    ["/users/<id>", "/users/{{id}}"],
    ["/users/<int:id>", "/users/{{id}}"],
    ["/users/<str:slug>", "/users/{{slug}}"],
    ["/users/<uuid:token>", "/users/{{token}}"],
  ])("%s → %s", (input, expected) => {
    expect(toPostmanUri(input)).toBe(expected);
  });

  // `<int:id>` must be processed BEFORE `:param`, otherwise the inner
  // `:id` would break the token into `<int{{id}}>`.
  test("a Django converter does not break on the Express pattern", () => {
    expect(toPostmanUri("/api/<int:id>/edit")).toBe("/api/{{id}}/edit");
  });

  test("a variable that is already {{x}} is not duplicated", () => {
    expect(toPostmanUri("/users/{{id}}")).toBe("/users/{{id}}");
  });

  test("adds the leading slash if missing", () => {
    expect(toPostmanUri("users")).toBe("/users");
  });

  test("collapses repeated slashes", () => {
    expect(toPostmanUri("/api//users")).toBe("/api/users");
  });

  // Django declares the trailing slash on purpose (APPEND_SLASH).
  test("keeps the trailing slash", () => {
    expect(toPostmanUri("/users/")).toBe("/users/");
  });

  test("several parameters on the same uri", () => {
    expect(toPostmanUri("/users/{userId}/posts/{postId}")).toBe(
      "/users/{{userId}}/posts/{{postId}}",
    );
  });

  test("does not touch a path without parameters", () => {
    expect(toPostmanUri("/health")).toBe("/health");
  });
});

/**
 * A validation provider that **fails**.
 *
 * Previously it swallowed the exception and returned `null`, so the
 * endpoint looked exactly like one that legitimately has no rules. A
 * broken parser —a framework syntax change, a file that can no
 * longer be read— degraded the whole collection in silence: the only
 * thing that changed was a counter no one looks at.
 */
describe("a validation provider that blows up", () => {
  const proveedorRoto = {
    framework: "test",
    supports: async () => true,
    resolve: async () => {
      throw new Error("el parser no supo leer el fichero");
    },
  };

  test("does not break generation: the endpoint comes out the same", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST", uri: "/users" })]),
      MATCH,
      proveedorRoto,
    );
    expect(result.specs).toHaveLength(1);
  });

  /** THE test: the failure is recorded instead of disappearing. */
  test("but it is recorded, with the endpoint and the reason", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST", uri: "/users" })]),
      MATCH,
      proveedorRoto,
    );
    expect(result.validationFailures).toHaveLength(1);
    expect(result.validationFailures[0]).toContain("POST /users");
    expect(result.validationFailures[0]).toContain("no supo leer");
  });

  test("and is not confused with an endpoint without rules", async () => {
    const sinReglas = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST", uri: "/users" })]),
      MATCH,
      null,
    );
    expect(sinReglas.validationFailures).toEqual([]);
    expect(sinReglas.withoutFormRequest).toBe(1);
  });
});

describe("buildSpecsFromScanner — route conversion", () => {
  test("converts each route into a spec", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET", uri: "/users" })]),
      MATCH,
      null,
    );
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]).toMatchObject({ method: "GET", uri: "/users" });
  });

  // a00012 S3.c added TRACE to the catalog and the union: previously
  // the adapter dropped it even though the OpenAPI scanner detected
  // it. CONNECT stays a verb Postman does not support, so it remains
  // the discard example.
  test("drops the verbs Postman will not use (CONNECT)", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([
        route({ method: "GET" }),
        route({ method: "TRACE" }),
        route({ method: "CONNECT" }),
      ]),
      MATCH,
      null,
    );
    expect(result.specs.map((s) => s.method)).toEqual(["GET", "TRACE"]);
  });

  test("normalizes the method to uppercase", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "post" })]),
      MATCH,
      null,
    );
    expect(result.specs[0]?.method).toBe("POST");
  });

  test("the first tag becomes the folder", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ tags: ["Usuarios", "Admin"] })]),
      MATCH,
      null,
    );
    expect(result.specs[0]?.folder).toBe("Usuarios");
  });

  test("propagates the route description", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ description: "Lista de usuarios" })]),
      MATCH,
      null,
    );
    expect(result.specs[0]?.description).toBe("Lista de usuarios");
  });

  // A path param in `query` would yield `/users/{{id}}?id=1`, which is
  // not the declared route. They are resolved as collection variables.
  test("path parameters are NOT emitted as query string", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ uri: "/users/{id}" })]),
      MATCH,
      null,
    );
    expect(result.specs[0]?.query ?? []).toEqual([]);
    expect(result.specs[0]?.uri).toBe("/users/{{id}}");
  });

  test("an empty list produces zero specs", async () => {
    const result = await buildSpecsFromScanner(scannerOf([]), MATCH, null);
    expect(result.specs).toEqual([]);
    expect(result.routes).toEqual([]);
  });
});

describe("buildSpecsFromScanner — validation rules", () => {
  test("required fields form the body of a POST", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST", uri: "/users" })]),
      MATCH,
      providerOf([field({ fieldName: "name" }), field({ fieldName: "email" })]),
    );
    expect(Object.keys(result.specs[0]?.body ?? {})).toEqual(["name", "email"]);
  });

  test("optional fields stay out of the example body", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([
        field({ fieldName: "name" }),
        field({ fieldName: "nota", required: false }),
      ]),
    );
    expect(Object.keys(result.specs[0]?.body ?? {})).toEqual(["name"]);
  });

  test("a GET does not get a body even when there are rules", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET" })]),
      MATCH,
      providerOf([field({})]),
    );
    expect(result.specs[0]?.body).toBeUndefined();
  });

  test("header fields come out as headers", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "X-Api-Key", location: "header" })]),
    );
    expect(result.specs[0]?.headers?.map((h) => h.key)).toEqual(["X-Api-Key"]);
  });

  test("query fields are added to the query", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET" })]),
      MATCH,
      providerOf([field({ fieldName: "page", location: "query", type: "integer" })]),
    );
    expect(result.specs[0]?.query?.map((q) => q.key)).toContain("page");
  });

  // a00010 / B-01: rules with `location: "path"` MUST NOT end up in
  // `spec.query` — the path param already travels in the URI and is
  // documented via `spec.fields` with `location: "path"`.
  test("path fields are NOT added to query (B-01 a00010)", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET", uri: "/users/{{id}}" })]),
      MATCH,
      providerOf([
        field({ fieldName: "id", location: "path", type: "string", required: true }),
      ]),
    );
    const spec = result.specs[0];
    expect(spec?.query ?? []).toEqual([]);
    const pathFields = (spec?.fields ?? []).filter((f) => f.location === "path");
    expect(pathFields.map((f) => f.fieldName)).toEqual(["id"]);
  });

  // Combined: a route with one path param and one real query param.
  // Only the query param must reach `spec.query`.
  test("mix of path and query: only query reaches spec.query", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "GET", uri: "/users/{{id}}" })]),
      MATCH,
      providerOf([
        field({ fieldName: "id", location: "path", type: "string", required: true }),
        field({ fieldName: "include", location: "query", type: "string", required: false }),
      ]),
    );
    const spec = result.specs[0];
    expect(spec?.query?.map((q) => q.key)).toEqual(["include"]);
    expect((spec?.fields ?? []).filter((f) => f.location === "path").map((f) => f.fieldName)).toEqual(["id"]);
  });

  test("counts endpoints with and without rules", async () => {
    const withRules = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({})]),
    );
    expect(withRules.withFormRequest).toBe(1);
    expect(withRules.withoutFormRequest).toBe(0);

    const withoutRules = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([]),
    );
    expect(withoutRules.withFormRequest).toBe(0);
    expect(withoutRules.withoutFormRequest).toBe(1);
  });

  // A provider that throws must not bring down the whole generation.
  test("a provider that throws does not break the scan", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([], { throws: true }),
    );
    expect(result.specs).toHaveLength(1);
    expect(result.withoutFormRequest).toBe(1);
  });
});

describe("buildSpecsFromScanner — example values", () => {
  test("an email uses an email-formatted example", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "email", format: "email" })]),
    );
    expect(String(bodyOf(result.specs[0])["email"])).toContain("@");
  });

  test("an enum uses its first value", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "role", type: "enum", enumValues: ["admin", "user"] })]),
    );
    expect(bodyOf(result.specs[0])["role"]).toBe("admin");
  });

  test("a boolean uses true", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "activo", type: "boolean" })]),
    );
    expect(bodyOf(result.specs[0])["activo"]).toBe(true);
  });

  test("an Authorization header points at {{token}}", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "POST" })]),
      MATCH,
      providerOf([field({ fieldName: "Authorization", location: "header" })]),
    );
    expect(result.specs[0]?.headers?.[0]?.value).toBe("{{token}}");
  });
});

// a00012 S3.c — TRACE in the contract.
//
// The `EndpointSpec["method"]` union and the `SUPPORTED_METHODS`
// catalog did not include "TRACE". The OpenAPI scanner did recognize
// it (`paths./y.trace`), but the adapter filtered it out. This slice
// materializes the fix in code and tests.
describe("a00012 S3.c — TRACE in the contract", () => {
  test("the runtime catalog contains TRACE", () => {
    expect(SUPPORTED_METHODS).toContain("TRACE");
  });

  // If "TRACE" stops being in the union, this file does NOT compile
  // and `bun run typecheck` fails. The runtime assertion is trivial;
  // the real value lies in the compile-time check.
  test('the EndpointSpec["method"] union accepts "TRACE" as a literal', () => {
    type IncludesTrace = "TRACE" extends EndpointSpec["method"] ? true : false;
    const _check: IncludesTrace = true;
    expect(_check).toBe(true);
  });

  test("the adapter lets a route with method=TRACE through (does not filter it)", async () => {
    const result = await buildSpecsFromScanner(
      scannerOf([route({ method: "TRACE", uri: "/debug" })]),
      MATCH,
      null,
    );
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.method).toBe("TRACE");
    expect(result.specs[0]?.uri).toBe("/debug");
  });
});
