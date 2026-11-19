/**
 * Comprehensive E2E test for the Express scanner.
 *
 * Covers:
 * - app.METHOD(path, handler) in src/server.ts.
 * - router.METHOD with `app.use('/prefix', router)`.
 * - zod schemas (inline + referenced).
 * - Joi schemas.
 * - Nested schemas (addressSchema).
 * - Enums (role, status, currency).
 * - Path params (`:id`).
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
  fixtureName: "express-comprehensive",
  expectedRequests: 14,
  hasAuth: true,
});

describe("Express — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("express-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(13);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("express-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("finds the endpoints by method+uri", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    // Health
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

  test("POST /api/users has body params (zod createUserSchema)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("PUT /api/users/{id} has body params (zod updateUserSchema)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("PUT /api/users/{id}/address has street, city, country, postalCode", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postalCode");
  });

  test("POST /api/orders has body params (Joi createOrderSchema)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customerName");
    expect(body).toHaveProperty("customerEmail");
  });

  test("PATCH /api/orders/{id}/status has status enum (Joi)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("status");
    expect(["pending", "paid", "shipped", "cancelled"]).toContain(body.status);
  });

  test("POST /api/auth/login has email + password (zod)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /api/auth/refresh has refreshToken (zod)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/refresh");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("refreshToken");
  });

  test("zod and Joi routes are detected as specs", async () => {
    const { metrics } = await runGenerate("express-comprehensive");
    // 13 specs (routes with zod or Joi). 1 without FR (logout with no body).
    expect(metrics.conFR).toBeGreaterThanOrEqual(12);
  });
});