/**
 * E2E test exhaustivo para el scanner Express.
 *
 * Cubre:
 * - app.METHOD(path, handler) en src/server.ts.
 * - router.METHOD con `app.use('/prefix', router)`.
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
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("express-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(13);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("express-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra los endpoints por method+uri", async () => {
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

  test("POST /api/users tiene body params (zod createUserSchema)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("PUT /api/users/{id} tiene body params (zod updateUserSchema)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("PUT /api/users/{id}/address tiene street, city, country, postalCode", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postalCode");
  });

  test("POST /api/orders tiene body params (Joi createOrderSchema)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customerName");
    expect(body).toHaveProperty("customerEmail");
  });

  test("PATCH /api/orders/{id}/status tiene status enum (Joi)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("status");
    expect(["pending", "paid", "shipped", "cancelled"]).toContain(body.status);
  });

  test("POST /api/auth/login tiene email + password (zod)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /api/auth/refresh tiene refreshToken (zod)", async () => {
    const { collection } = await runGenerate("express-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/refresh");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("refreshToken");
  });

  test("las rutas de zod y Joi se detectan como specs", async () => {
    const { metrics } = await runGenerate("express-comprehensive");
    // 13 specs (rutas con zod o Joi). 1 sin FR (logout sin body).
    expect(metrics.conFR).toBeGreaterThanOrEqual(12);
  });
});