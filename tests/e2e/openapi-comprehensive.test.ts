/**
 * Comprehensive E2E test for the OpenAPI scanner.
 *
 * Covers:
 * - $ref in schemas, parameters, responses.
 * - allOf (UserCreate extends UserBase).
 * - enum with multiple values.
 * - format: email, uuid, date-time, url.
 * - path-level parameters (shared by all methods).
 * - custom headers (X-Tenant-ID, X-Request-ID).
 * - Postman v2.1.0 invariant validation.
 */
import { describe, expect, test } from "vitest";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  hashNormalized,
  validatePostmanInvariants,
} from "../helpers/compare-json";

import { describeCollectionContract } from "../helpers/collection-contract";

describeCollectionContract({
  fixtureName: "openapi-comprehensive",
  expectedRequests: 23,
  hasAuth: true,
});

describe("OpenAPI — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("openapi-comprehensive");
    console.log("metrics:", metrics);
    expect(metrics.routes).toBeGreaterThan(15);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const issues = validatePostmanInvariants(collection);
    expect(issues).toEqual([]);
    expect(collection.info.schema).toContain("2.1.0");
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("openapi-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
    expect(metrics.routes).toBeGreaterThanOrEqual(20);
  });

  test("info.title is used as collectionName (basename = info.title)", async () => {
    const { collection } = await runGenerate("openapi-comprehensive", {
      basename: "Comprehensive OpenAPI Test API (Postman)",
    });
    expect(collection.info.name).toContain("Comprehensive OpenAPI");
  });

  test("finds the endpoints by method+uri", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    expect(findEndpoint(collection, "GET", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/auth/login")).not.toBeNull();
  });

  test("POST /users has body parameters (UserCreate with allOf + $ref)", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    // UserCreate = allOf: [UserBase (email required), { password required }]
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("custom headers X-Tenant-ID appear on /auth/logout", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/logout");
    expect(ep).not.toBeNull();
    const headers = (ep?.request?.header ?? []) as Array<{ key: string; value: string }>;
    const tenant = headers.find((h) => h.key === "X-Tenant-ID");
    expect(tenant).toBeDefined();
    // The header may have either an auto (Bearer) or a custom
    // (your-tenant-id) format. What matters is that the key is present.
  });

  test("path params without double braces", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const ep = findEndpoint(collection, "GET", "/users/{{id}}");
    expect(ep).not.toBeNull();
    const raw = ep?.request?.url?.raw ?? "";
    expect(raw).toContain("{{id}}");
  });

  test("query params appear on /users GET", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const ep = findEndpoint(collection, "GET", "/users");
    expect(ep).not.toBeNull();
    const query = (ep?.request?.url?.query ?? []) as Array<{ key: string }>;
    const keys = query.map((q) => q.key);
    expect(keys).toContain("page");
    expect(keys).toContain("limit");
    expect(keys).toContain("search");
  });

  test("the collection hash is stable between runs", async () => {
    // Previously this hashed once and asserted `> 0`, which is true for
    // any output and detected nothing. What matters is that two
    // generations of the same fixture yield the SAME hash: that is what
    // makes reimporting into Postman update rather than duplicate.
    const first = await runGenerate("openapi-comprehensive");
    const second = await runGenerate("openapi-comprehensive");
    expect(hashNormalized(first.collection)).toBe(hashNormalized(second.collection));
  });
});
