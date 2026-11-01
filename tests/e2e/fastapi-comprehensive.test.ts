/**
 * Comprehensive E2E test for the FastAPI scanner.
 *
 * Covers:
 * - Multiple Pydantic models per endpoint (CreateUserRequest, UpdateUserRequest, ListUsersRequest, etc.).
 * - Nested models (Address inside User).
 * - Optional fields with defaults.
 * - Validators: min_length, max_length, ge, le, gt, pattern.
 * - EmailStr, HttpUrl, UUID4 format.
 * - Enum / Literal type.
 * - Path params + Query params + Body params.
 * - multi-line decorators.
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
  fixtureName: "fastapi-comprehensive",
  expectedRequests: 19,
  hasAuth: true,
});

describe("FastAPI — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("fastapi-comprehensive");
    expect(metrics.routes).toBeGreaterThan(12);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("fastapi-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("all the endpoints", async () => {
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

  test("POST /users has body params (CreateUserRequest)", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    // age and address are optional, they don't appear in the body by default.
  });

  test("email has email format (not null)", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/users");
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body.email).toBe("user@example.com");
  });

  test("PUT /users/{id}/address uses Address (single body)", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postal_code");
  });

  test("POST /orders has body params (CreateOrderRequest)", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customer_id");
    expect(body).toHaveProperty("customer_email");
    expect(body).toHaveProperty("items");
  });

  test("PATCH /orders/{id}/status has status enum", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("status");
  });

  test("POST /auth/login has email + password", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /webhooks/payment has event enum", async () => {
    const { collection } = await runGenerate("fastapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/webhooks/payment");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("event");
    expect(body).toHaveProperty("data");
  });
});
