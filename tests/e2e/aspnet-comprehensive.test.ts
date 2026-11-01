/**
 * Comprehensive E2E test for the ASP.NET Core (C#) scanner.
 *
 * Covers:
 * - [ApiController] + [Route("api/X")] (class prefix).
 * - [HttpGet]/[HttpPost]/[HttpPut]/[HttpDelete]/[HttpPatch].
 * - [FromBody] <DtoType> body.
 * - DTOs with System.ComponentModel.DataAnnotations.*
 *   ([Required], [EmailAddress], [StringLength], [Range],
 *    [RegularExpression]).
 * - Enums via [RegularExpression("^(a|b|c)$")].
 * - Multi-controller: UsersController, OrdersController, AuthController.
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
  fixtureName: "aspnet-comprehensive",
  expectedRequests: 17,
  hasAuth: true,
});

describe("ASP.NET — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("aspnet-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(11);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("aspnet-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("finds the endpoints by method+uri", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    // Users
    expect(findEndpoint(collection, "GET", "/api/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/api/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/api/users/{{id}}")).not.toBeNull();
    // Orders
    expect(findEndpoint(collection, "GET", "/api/orders")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/orders")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/api/orders/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status")).not.toBeNull();
    // Auth
    expect(findEndpoint(collection, "POST", "/api/auth/login")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/logout")).not.toBeNull();
  });

  test("POST /api/users has body from DTO User", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("Name");
    expect(body).toHaveProperty("Email");
    expect(body).toHaveProperty("Age");
    expect(body).toHaveProperty("Role");
  });

  test("PUT /api/users/{id} has body from DTO User", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("Name");
    expect(body).toHaveProperty("Email");
  });

  test("POST /api/orders has body from DTO Order", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("CustomerName");
    expect(body).toHaveProperty("CustomerEmail");
    expect(body).toHaveProperty("Amount");
    expect(body).toHaveProperty("Currency");
  });

  // Each endpoint resolves ITS OWN DTO. Previously the first `[FromBody]`
  // in the file was picked, so this one ended up with the order-create
  // fields instead of its own.
  test("PATCH /api/orders/{id}/status uses UpdateOrderStatusRequest, not Order", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("Status");
    expect(body).not.toHaveProperty("CustomerName");
  });

  test("POST /api/products (minimal API) has body from CreateProductRequest", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/products");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("Name");
    expect(body).toHaveProperty("Price");
  });

  test("POST /api/auth/login has email + password (DTO LoginRequest)", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("Email");
    expect(body).toHaveProperty("Password");
  });

  test("role is enum (RegularExpression admin|user|guest)", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(["admin", "user", "guest"]).toContain(body.Role);
  });
});