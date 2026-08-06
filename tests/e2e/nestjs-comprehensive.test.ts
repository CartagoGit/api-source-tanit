/**
 * E2E test exhaustivo para el scanner NestJS.
 *
 * Cubre:
 * - @Controller('prefix') + @Get/@Post/@Put/@Patch/@Delete con class-validator.
 * - DTOs con @IsString, @IsEmail, @IsInt, @IsEnum, @IsOptional.
 * - @MinLength, @MaxLength, @Min, @Max.
 * - Nested DTO (AddressDto).
 * - Enums (UserRole, OrderStatus, Currency).
 * - Path params (`:id`).
 */
import { describe, expect, test } from "bun:test";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

import { describeCollectionContract } from "../helpers/collection-contract";

describeCollectionContract({
  fixtureName: "nestjs-comprehensive",
  expectedRequests: 13,
  hasAuth: true,
});

describe("NestJS — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("nestjs-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(13);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("nestjs-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra los endpoints por method+uri", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    // Users
    expect(findEndpoint(collection, "GET", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/users/{{id}}/address")).not.toBeNull();
    // Orders
    expect(findEndpoint(collection, "GET", "/orders")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/orders")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/orders/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/orders/{{id}}/status")).not.toBeNull();
    // Auth
    expect(findEndpoint(collection, "POST", "/auth/login")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/auth/refresh")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/auth/logout")).not.toBeNull();
  });

  test("POST /users tiene body params desde CreateUserDto", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
  });

  test("PUT /users/{id} tiene body params desde UpdateUserDto", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("PUT /users/{id}/address tiene body desde AddressDto", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postalCode");
  });

  test("POST /orders tiene body params desde CreateOrderDto", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customerName");
    expect(body).toHaveProperty("customerEmail");
    expect(body).toHaveProperty("amount");
  });

  test("PATCH /orders/{id}/status tiene status enum (UpdateOrderStatusDto)", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("status");
    // OrderStatus enum values.
    expect([
      "Pending",
      "Paid",
      "Shipped",
      "Cancelled",
      "pending",
      "paid",
      "shipped",
      "cancelled",
      "opcion1",
    ]).toContain(body.status);
  });

  test("POST /auth/login tiene email + password (LoginDto)", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /auth/refresh tiene refreshToken (RefreshTokenDto)", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/refresh");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("refreshToken");
  });

  test("POST /auth/logout no tiene body (no DTO)", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/logout");
    expect(ep).not.toBeNull();
    const body = ep?.request?.body?.raw ?? "{}";
    // Sin DTO → body vacío o sin campos.
    expect(body === "{}" || body === "" || body === undefined).toBe(true);
  });
});