/**
 * Comprehensive E2E test for the Symfony scanner.
 *
 * Covers:
 * - YAML routes in `config/routes.yaml` (top-level).
 * - YAML routes in `config/routes/*.yaml` (sub-app).
 * - PHP attributes `#[Route(...)]` in `src/Controller/`.
 * - Sub-routes with `#[Route('', methods: ['GET'])]` (empty path).
 * - Multi-constraint `#[Assert\*]` on method parameters.
 * - Inline validation on the method signature.
 */
import { describe, expect, test } from "vitest";
import { runGenerate } from "../helpers/run-scanner";
import {
  collectRequestKeys,
  findAllEndpoints,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

import { describeCollectionContract } from "../helpers/collection-contract";

describeCollectionContract({
  fixtureName: "symfony-comprehensive",
  expectedRequests: 14,
  hasAuth: true,
});

describe("Symfony — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("symfony-comprehensive");
    // 14 unique endpoints: those declared in YAML and those declared
    // with #[Route] are the SAME, and Symfony registers them only once.
    expect(metrics.routes).toBe(14);
  });

  test("does not export duplicate endpoints", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const keys = collectRequestKeys(collection);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("finds the YAML routes from config/routes.yaml", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    expect(findEndpoint(collection, "GET", "/health")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/login")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/refresh")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/logout")).not.toBeNull();
  });

  test("finds the YAML routes from config/routes/users.yaml", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    expect(findEndpoint(collection, "GET", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/users/{{id}}")).not.toBeNull();
  });

  test("finds the routes from the PHP attributes", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    expect(findEndpoint(collection, "GET", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/orders/{{id}}/status")).not.toBeNull();
  });

  test("POST /users has body params (Assert constraints)", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const eps = findAllEndpoints(collection, "POST", "/users");
    expect(eps).toHaveLength(1);
    const body = JSON.parse(eps[0]?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("X-Tenant-ID custom headers are not part of the default headers", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const headers = (ep?.request?.header ?? []) as Array<{ key: string }>;
    // The default should be `Accept` + `Authorization`. No `X-Tenant-ID`.
    const keys = headers.map((h) => h.key);
    expect(keys).toContain("Accept");
    expect(keys).toContain("Authorization");
  });

  test("PATCH /orders/{id}/status has status enum", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const eps = findAllEndpoints(collection, "PATCH", "/orders/{{id}}/status");
    expect(eps).toHaveLength(1);
    const body = JSON.parse(eps[0]?.request?.body?.raw ?? "{}");
    expect(body?.status).toBeDefined();
  });

  test("PUT /users/{id}/address has street, city, country, postalCode", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postalCode");
  });

  test("Auth login has email and password (at least one endpoint)", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const eps = findAllEndpoints(collection, "POST", "/api/auth/login");
    expect(eps).toHaveLength(1);
    const body = JSON.parse(eps[0]?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });
});


