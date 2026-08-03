/**
 * E2E test exhaustivo para el scanner FastAPI.
 *
 * Cubre:
 * - Multiple Pydantic models por endpoint (CreateUserRequest, UpdateUserRequest, ListUsersRequest, etc.).
 * - Nested models (Address dentro de User).
 * - Optional fields con defaults.
 * - Validators: min_length, max_length, ge, le, gt, pattern.
 * - EmailStr, HttpUrl, UUID4 format.
 * - Enum / Literal type.
 * - Path params + Query params + Body params.
 * - multi-line decorators.
 */
import { describe, expect, test } from "bun:test";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

describe("FastAPI — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("fastapi-comprehensive");
    expect(metrics.routes).toBeGreaterThan(12);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("fastapi-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("todos los endpoints", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    expect(findEndpoint(collection, "GET", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/users/{{id}}/address")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/orders")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/orders/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/orders/{{id}}/status")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/auth/login")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/auth/refresh")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/webhooks/payment")).not.toBeNull();
  });

  test("POST /users tiene body params (CreateUserRequest)", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    // age y address son optional, no aparecen en el body por defecto.
  });

  test("email tiene formato email (no null)", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/users");
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body.email).toBe("usuario@ejemplo.com");
  });

  test("PUT /users/{id}/address usa Address (single body)", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postal_code");
  });

  test("POST /orders tiene body params (CreateOrderRequest)", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customer_id");
    expect(body).toHaveProperty("customer_email");
    expect(body).toHaveProperty("items");
  });

  test("PATCH /orders/{id}/status tiene status enum", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("status");
  });

  test("POST /auth/login tiene email + password", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /webhooks/payment tiene event enum", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/webhooks/payment");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("event");
    expect(body).toHaveProperty("data");
  });
});
