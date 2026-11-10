/**
 * Comprehensive E2E test for the Gin (Go) scanner.
 *
 * Covers:
 * - `gin.Default()` + `RouterGroup.GET/POST/PUT/PATCH/DELETE`.
 * - Go structs with binding tags (`required`, `email`, `oneof`, `min`, `max`, etc.).
 * - json tags for wire names.
 * - Path params `:id`.
 * - Multi-file (internal/users.go, internal/orders.go, internal/auth.go).
 */
import { describe, expect, test } from "vitest";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

import { describeCollectionContract } from "../helpers/collection-contract";

describeCollectionContract({
  fixtureName: "gin-comprehensive",
  expectedRequests: 14,
  hasAuth: true,
});

describe("Gin — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("gin-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(13);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("gin-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("finds the endpoints by method+uri", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    expect(findEndpoint(collection, "GET", "/health")).not.toBeNull();
    // Users
    expect(findEndpoint(collection, "GET", "/api/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/api/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/api/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/api/users/{{id}}/address")).not.toBeNull();
    // Orders
    expect(findEndpoint(collection, "GET", "/api/orders")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/orders")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/orders/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status")).not.toBeNull();
    // Auth
    expect(findEndpoint(collection, "POST", "/api/auth/login")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/refresh")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/logout")).not.toBeNull();
  });

  test("POST /api/users has body from struct User", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{id}/address uses struct Address", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postal_code");
  });

  test("POST /api/orders has body from struct Order", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customer_name");
    expect(body).toHaveProperty("customer_email");
    expect(body).toHaveProperty("amount");
  });

  test("POST /api/auth/login has email + password (struct Login)", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /api/auth/refresh has refresh_token (struct RefreshToken)", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/refresh");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("refresh_token");
  });

  test("role is enum (oneof=admin user guest)", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(["admin", "user", "guest"]).toContain(body.role);
  });
});