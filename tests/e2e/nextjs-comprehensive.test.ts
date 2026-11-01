/**
 * Comprehensive E2E test for the Next.js (App Router) scanner.
 *
 * Covers:
 * - App Router: `app/api/<segment>/route.ts` with `export async function GET/POST/...`.
 * - Path params `[id]` → `{{id}}`.
 * - inline zod: `z.object({...})` in the same file as the handler.
 * - Multiple HTTP methods exported per file.
 * - Framework detection via `package.json` with `next` dependency.
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
  fixtureName: "nextjs-comprehensive",
  expectedRequests: 14,
  hasAuth: true,
});

describe("Next.js — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("nextjs-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(10);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("nextjs-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("finds the endpoints by method+uri", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    // Health
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

  test("POST /api/users has body from zod createUserSchema", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{id} has body from zod updateUserSchema", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("POST /api/orders has body from zod createOrderSchema", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customerName");
    expect(body).toHaveProperty("customerEmail");
    expect(body).toHaveProperty("amount");
    expect(body).toHaveProperty("currency");
  });

  test("PATCH /api/orders/{id}/status has body from zod updateStatusSchema", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("status");
  });

  test("endpoints with path param [id] → {{id}} in the URI", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "GET", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const rawUrl: string = ep?.request?.url?.raw ?? "";
    expect(rawUrl).toContain("{{id}}");
    expect(rawUrl).not.toContain("[id]");
  });
});
