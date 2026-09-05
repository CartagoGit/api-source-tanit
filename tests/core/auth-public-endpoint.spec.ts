/**
 * a00012 S3.b — Auth per operation.
 *
 * `defaultHeaders()` injects `Authorization: Bearer {{token}}` when
 * the global scheme is bearer. It used to do that for **all**
 * requests, including login — which is precisely the endpoint that
 * issues the token. Result: 401 on the first Send, with the blame
 * pointing at a request that is actually the one that fills the
 * variable.
 *
 * The per-operation override (`EndpointSpec.auth: { kind: "none" }`)
 * lets us mark public endpoints (login, /health, /register) so the
 * builder skips that header without touching the global scheme.
 *
 * These tests are the guarantee of that rule: with a global `bearer`,
 * an endpoint declared public comes out without `Authorization` while
 * any other one in the same project does carry it.
 */
import { describe, expect, test } from "vitest";

import {
  buildCollection,
} from "../../packages/core/domain/collection-builder.service";
import type {
  EndpointSpec,
} from "../../packages/contracts/interfaces/core/postman.interface";
import type { ProjectConfig } from "../../packages/contracts/interfaces/core/project-config.interface";

const baseConfig: ProjectConfig = {
  name: "auth-public",
  collectionName: "Auth Public",
  collectionDescription: "test",
  baseUrl: "http://x",
  variables: [{ key: "baseUrl", value: "http://x", type: "string" }],
  filePrefixes: {},
  zones: [],
  zoneOrder: [],
  defaultZone: "Other",
  authDescriptions: {},
  loginEndpointName: "Login",
};

function spec(partial: Partial<EndpointSpec>): EndpointSpec {
  return {
    method: "GET",
    uri: "/x",
    headers: [],
    query: [],
    body: null,
    formRequest: null,
    ...partial,
  } as EndpointSpec;
}

/** Global bearer scheme (same as what the detector infers when there is login). */
const bearerScheme = { type: "bearer" as const, evidence: "test" };

/**
 * Returns the headers of an item by name. Zero nesting: with
 * `buildCollection` + two endpoints at the root, a flat walk is
 * enough.
 */
function headersOf(collection: ReturnType<typeof buildCollection>, itemName: string) {
  for (const folder of collection.item) {
    for (const child of folder.item ?? []) {
      if (child.name === itemName) {
        return child.request?.header ?? [];
      }
    }
  }
  throw new Error(`Item "${itemName}" was not found in the collection`);
}

function hasAuthHeader(headers: Array<{ key: string; value?: string }>): boolean {
  return headers.some(
    (h) => h.key.toLowerCase() === "authorization" && (h.value ?? "").includes("Bearer"),
  );
}

describe("auth-public-endpoint — override por operación (a00012 S3.b)", () => {
  test("a public endpoint does not carry Authorization even when the global is bearer", () => {
    const col = buildCollection(
      [
        spec({
          name: "Login",
          method: "POST",
          uri: "/auth/login",
          // Explicit override: this endpoint is public.
          auth: { kind: "none" },
        }),
        spec({
          name: "ListUsers",
          method: "GET",
          uri: "/users",
        }),
      ],
      baseConfig,
      bearerScheme,
    );

    expect(hasAuthHeader(headersOf(col, "Login"))).toBe(false);
    expect(hasAuthHeader(headersOf(col, "ListUsers"))).toBe(true);
  });

  test("the override only affects the endpoint that declares it", () => {
    // Three endpoints: one public, two protected. The `Authorization`
    // header appears on the protected ones and NOT on the public one.
    const col = buildCollection(
      [
        spec({
          name: "Health",
          method: "GET",
          uri: "/health",
          auth: { kind: "none" },
        }),
        spec({
          name: "GetProfile",
          method: "GET",
          uri: "/me",
        }),
        spec({
          name: "ListOrders",
          method: "GET",
          uri: "/orders",
        }),
      ],
      baseConfig,
      bearerScheme,
    );

    expect(hasAuthHeader(headersOf(col, "Health"))).toBe(false);
    expect(hasAuthHeader(headersOf(col, "GetProfile"))).toBe(true);
    expect(hasAuthHeader(headersOf(col, "ListOrders"))).toBe(true);
  });

  test("without an override, all endpoints inherit the global scheme", () => {
    // The default behavior is preserved: an endpoint that does not
    // declare an override keeps receiving the header as before.
    const col = buildCollection(
      [
        spec({ name: "A", method: "GET", uri: "/a" }),
        spec({ name: "B", method: "GET", uri: "/b" }),
      ],
      baseConfig,
      bearerScheme,
    );

    expect(hasAuthHeader(headersOf(col, "A"))).toBe(true);
    expect(hasAuthHeader(headersOf(col, "B"))).toBe(true);
  });

  test("with a global scheme other than bearer, the override changes nothing visible", () => {
    // The `none` override applies to the `Authorization` header that
    // the builder injects; with global `none` scheme that header is
    // never injected in the first place, so the override is a no-op.
    const col = buildCollection(
      [
        spec({
          name: "Health",
          method: "GET",
          uri: "/health",
          auth: { kind: "none" },
        }),
        spec({ name: "Me", method: "GET", uri: "/me" }),
      ],
      baseConfig,
      { type: "none", evidence: "test" },
    );

    expect(hasAuthHeader(headersOf(col, "Health"))).toBe(false);
    expect(hasAuthHeader(headersOf(col, "Me"))).toBe(false);
  });
});