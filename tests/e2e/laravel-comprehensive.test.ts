/**
 * Comprehensive E2E test for the Laravel scanner.
 *
 * Covers:
 * - `Route::apiResource(...)` → expansion to 5 RESTful verbs.
 * - `Route::prefix('api')->group(...)` as an outer prefix.
 * - Extra routes (updateAddress, userOrders, cancel).
 * - FormRequests with `rules(): array` → typed body params.
 * - Auth with login/refresh/logout (FormRequest on login and refresh).
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
  fixtureName: "laravel-comprehensive",
  // a00010 / B-04: `update` now produces PUT + PATCH (+1 for each
  // resource with `update`). With 2 apiResources (users, orders) we
  // go from 17 to 19.
  expectedRequests: 19,
  hasAuth: true,
});

describe("Laravel — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("laravel-comprehensive");
    // apiResource users (5) + extra (2) + apiResource orders (5) + cancel (1)
    // + auth login/refresh/logout (3) + health (1) = 17 minimum
    expect(metrics.routes).toBeGreaterThanOrEqual(17);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("laravel-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("finds every endpoint by method+uri", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    // Health — the /api prefix is applied by RouteServiceProvider when
    // registering routes/api.php, even though the code does not write it.
    expect(findEndpoint(collection, "GET", "/api/health")).not.toBeNull();
    // Users — apiResource (a00010 / B-03: path param is the singular of
    // the resource; a00010 / B-04: update produces PUT + PATCH).
    expect(findEndpoint(collection, "GET", "/api/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/users/{{user}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/api/users/{{user}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/users/{{user}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/api/users/{{user}}")).not.toBeNull();
    // Users — extras
    expect(findEndpoint(collection, "PUT", "/api/users/{{user}}/address")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/users/{{user}}/orders")).not.toBeNull();
    // Orders — apiResource
    expect(findEndpoint(collection, "GET", "/api/orders")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/orders")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/orders/{{order}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/api/orders/{{order}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/api/orders/{{order}}")).not.toBeNull();
    // Orders — action
    expect(findEndpoint(collection, "POST", "/api/orders/{{order}}/cancel")).not.toBeNull();
    // Auth
    expect(findEndpoint(collection, "POST", "/api/auth/login")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/refresh")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/logout")).not.toBeNull();
  });

  test("POST /api/users has body from CreateUserRequest", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{user}/address has body from UpdateAddressRequest", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{user}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postal_code");
  });

  test("POST /api/orders has body from CreateOrderRequest", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customer_name");
    expect(body).toHaveProperty("customer_email");
    expect(body).toHaveProperty("amount");
    expect(body).toHaveProperty("currency");
  });

  test("POST /api/auth/login has body from LoginRequest", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("Route::apiResource generates exactly 6 routes for users (no create/edit, + PATCH)", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const userUris = [
      "GET /api/users",
      "POST /api/users",
      "GET /api/users/{{user}}",
      "PUT /api/users/{{user}}",
      "PATCH /api/users/{{user}}",
      "DELETE /api/users/{{user}}",
    ];
    for (const ref of userUris) {
      const [method, uri] = ref.split(" ") as [string, string];
      expect(findEndpoint(collection, method, uri)).not.toBeNull();
    }
    // apiResource does NOT generate /create or /edit
    expect(findEndpoint(collection, "GET", "/api/users/create")).toBeNull();
    expect(findEndpoint(collection, "GET", "/api/users/{{user}}/edit")).toBeNull();
  });
});
