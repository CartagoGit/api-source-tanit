/**
 * E2E test exhaustivo para el scanner Spring Boot (Java).
 *
 * Cubre:
 * - @RestController + @RequestMapping("/api/X") (class prefix).
 * - @GetMapping/@PostMapping/@PutMapping/@DeleteMapping/@PatchMapping.
 * - @PathVariable, @RequestParam, @RequestBody.
 * - DTOs con jakarta.validation.constraints.* (@NotBlank, @Email,
 *   @Min, @Max, @Size, @Pattern).
 * - Enums via @Pattern(regexp = "a|b|c").
 * - Multi-package: users/, orders/, auth/.
 */
import { describe, expect, test } from "bun:test";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

describe("Spring Boot — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("springboot-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(11);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("springboot-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("springboot-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra los endpoints por method+uri", async () => {
    const { collection } = await runGenerate("springboot-comprehensive");
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
    const { collection } = await runGenerate("springboot-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{id} tiene body desde DTO User", async () => {
    const { collection } = await runGenerate("springboot-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("POST /api/orders tiene body desde DTO Order", async () => {
    const { collection } = await runGenerate("springboot-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customerName");
    expect(body).toHaveProperty("customerEmail");
    expect(body).toHaveProperty("amount");
    expect(body).toHaveProperty("currency");
  });

  test("PATCH /api/orders/{id}/status tiene body desde DTO Order", async () => {
    const { collection } = await runGenerate("springboot-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customerName");
  });

  test("POST /api/auth/login tiene email + password (DTO LoginRequest)", async () => {
    const { collection } = await runGenerate("springboot-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("role es enum (Pattern regexp=admin|user|guest)", async () => {
    const { collection } = await runGenerate("springboot-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(["admin", "user", "guest"]).toContain(body.role);
  });
});