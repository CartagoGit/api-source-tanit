/**
 * E2E test exhaustivo para el scanner ASP.NET Core (C#).
 *
 * Cubre:
 * - [ApiController] + [Route("api/X")] (class prefix).
 * - [HttpGet]/[HttpPost]/[HttpPut]/[HttpDelete]/[HttpPatch].
 * - [FromBody] <DtoType> body.
 * - DTOs con System.ComponentModel.DataAnnotations.*
 *   ([Required], [EmailAddress], [StringLength], [Range],
 *    [RegularExpression]).
 * - Enums via [RegularExpression("^(a|b|c)$")].
 * - Multi-controller: UsersController, OrdersController, AuthController.
 */
import { describe, expect, test } from "bun:test";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

describe("ASP.NET — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("aspnet-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(11);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("aspnet-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra los endpoints por method+uri", async () => {
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

  test("POST /api/users tiene body desde DTO User", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("Name");
    expect(body).toHaveProperty("Email");
    expect(body).toHaveProperty("Age");
    expect(body).toHaveProperty("Role");
  });

  test("PUT /api/users/{id} tiene body desde DTO User", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("Name");
    expect(body).toHaveProperty("Email");
  });

  test("POST /api/orders tiene body desde DTO Order", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("CustomerName");
    expect(body).toHaveProperty("CustomerEmail");
    expect(body).toHaveProperty("Amount");
    expect(body).toHaveProperty("Currency");
  });

  test("PATCH /api/orders/{id}/status tiene body desde DTO Order", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("CustomerName");
  });

  test("POST /api/auth/login tiene email + password (DTO LoginRequest)", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("Email");
    expect(body).toHaveProperty("Password");
  });

  test("role es enum (RegularExpression admin|user|guest)", async () => {
    const { collection } = await runGenerate("aspnet-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(["admin", "user", "guest"]).toContain(body.Role);
  });
});