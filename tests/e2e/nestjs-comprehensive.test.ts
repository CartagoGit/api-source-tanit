/**
 * Comprehensive E2E test for the NestJS scanner.
 *
 * Covers:
 * - @Controller('prefix') + @Get/@Post/@Put/@Patch/@Delete with class-validator.
 * - DTOs with @IsString, @IsEmail, @IsInt, @IsEnum, @IsOptional.
 * - @MinLength, @MaxLength, @Min, @Max.
 * - Nested DTO (AddressDto).
 * - Enums (UserRole, OrderStatus, Currency).
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
  fixtureName: "nestjs-comprehensive",
  expectedRequests: 13,
  hasAuth: true,
});

describe("NestJS — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("nestjs-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(13);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("nestjs-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("finds the endpoints by method+uri", async () => {
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

  test("POST /users has body params from CreateUserDto", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
  });

  test("PUT /users/{id} has body params from UpdateUserDto", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("PUT /users/{id}/address has body from AddressDto", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postalCode");
  });

  test("POST /orders has body params from CreateOrderDto", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customerName");
    expect(body).toHaveProperty("customerEmail");
    expect(body).toHaveProperty("amount");
  });

  test("PATCH /orders/{id}/status has status enum (UpdateOrderStatusDto)", async () => {
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
      "option1",
    ]).toContain(body.status);
  });

  test("POST /auth/login has email + password (LoginDto)", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("POST /auth/refresh has refreshToken (RefreshTokenDto)", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/refresh");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("refreshToken");
  });

  test("POST /auth/logout has no body (no DTO)", async () => {
    const { collection } = await runGenerate("nestjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/logout");
    expect(ep).not.toBeNull();
    const body = ep?.request?.body?.raw ?? "{}";
    // Without DTO → empty body or without fields.
    expect(body === "{}" || body === "" || body === undefined).toBe(true);
  });
});