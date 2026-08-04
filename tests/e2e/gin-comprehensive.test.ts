/**
 * E2E test exhaustivo para el scanner Gin (Go).
 *
 * Cubre:
 * - `gin.Default()` + `RouterGroup.GET/POST/PUT/PATCH/DELETE`.
 * - Structs Go con binding tags (`required`, `email`, `oneof`, `min`, `max`, etc.).
 * - json tags para nombres wire.
 * - Path params `:id`.
 * - Multi-file (internal/users.go, internal/orders.go, internal/auth.go).
 */
import { describe, expect, test } from "bun:test";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

describe("Gin — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("gin-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(13);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("gin-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra los endpoints por method+uri", async () => {
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

  test("POST /api/users tiene body desde struct User", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{id}/address usa struct Address", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postal_code");
  });

  test("POST /api/orders tiene body desde struct Order", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customer_name");
    expect(body).toHaveProperty("customer_email");
    expect(body).toHaveProperty("amount");
  });

  test("POST /api/auth/login tiene email + password (struct Login)", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /api/auth/refresh tiene refresh_token (struct RefreshToken)", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/refresh");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("refresh_token");
  });

  test("role es enum (oneof=admin user guest)", async () => {
    const { collection } = await runGenerate("gin-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(["admin", "user", "guest"]).toContain(body.role);
  });
});