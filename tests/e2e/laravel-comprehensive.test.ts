/**
 * E2E test exhaustivo para el scanner Laravel.
 *
 * Cubre:
 * - `Route::apiResource(...)` → expansión a 5 verbos RESTful.
 * - `Route::prefix('api')->group(...)` como prefijo externo.
 * - Rutas extra (updateAddress, userOrders, cancel).
 * - FormRequests con `rules(): array` → body params tipados.
 * - Auth con login/refresh/logout (FormRequest en login y refresh).
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
  // a00010 / B-04: el `update` ahora produce PUT + PATCH (+1 por cada
  // resource con `update`). Con 2 apiResources (users, orders) pasamos
  // de 17 a 19.
  expectedRequests: 19,
  hasAuth: true,
});

describe("Laravel — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("laravel-comprehensive");
    // apiResource users (5) + extra (2) + apiResource orders (5) + cancel (1)
    // + auth login/refresh/logout (3) + health (1) = 17 mínimo
    expect(metrics.routes).toBeGreaterThanOrEqual(17);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("laravel-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra todos los endpoints por method+uri", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    // Health — el prefijo /api lo aplica el RouteServiceProvider al
    // registrar routes/api.php, aunque el código no lo escriba.
    expect(findEndpoint(collection, "GET", "/api/health")).not.toBeNull();
    // Users — apiResource (a00010 / B-03: path param es el singular del
    // recurso; a00010 / B-04: update produce PUT + PATCH).
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

  test("POST /api/users tiene body desde CreateUserRequest", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{user}/address tiene body desde UpdateAddressRequest", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{user}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postal_code");
  });

  test("POST /api/orders tiene body desde CreateOrderRequest", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customer_name");
    expect(body).toHaveProperty("customer_email");
    expect(body).toHaveProperty("amount");
    expect(body).toHaveProperty("currency");
  });

  test("POST /api/auth/login tiene body desde LoginRequest", async () => {
    const { collection } = await runGenerate("laravel-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("Route::apiResource genera exactamente 6 rutas para users (sin create/edit, + PATCH)", async () => {
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
    // apiResource NO genera /create ni /edit
    expect(findEndpoint(collection, "GET", "/api/users/create")).toBeNull();
    expect(findEndpoint(collection, "GET", "/api/users/{{user}}/edit")).toBeNull();
  });
});
