/**
 * E2E test exhaustivo para el scanner Next.js (App Router).
 *
 * Cubre:
 * - App Router: `app/api/<segment>/route.ts` con `export async function GET/POST/...`.
 * - Path params `[id]` → `{{id}}`.
 * - zod inline: `z.object({...})` en el mismo archivo del handler.
 * - Múltiples métodos HTTP exportados por archivo.
 * - Detección de framework por `package.json` con dep `next`.
 */
import { describe, expect, test } from "bun:test";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

describe("Next.js — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("nextjs-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(10);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("nextjs-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra los endpoints por method+uri", async () => {
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

  test("POST /api/users tiene body desde zod createUserSchema", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("age");
    expect(body).toHaveProperty("role");
  });

  test("PUT /api/users/{id} tiene body desde zod updateUserSchema", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("name");
    expect(body).toHaveProperty("email");
  });

  test("POST /api/orders tiene body desde zod createOrderSchema", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/orders");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("customerName");
    expect(body).toHaveProperty("customerEmail");
    expect(body).toHaveProperty("amount");
    expect(body).toHaveProperty("currency");
  });

  test("PATCH /api/orders/{id}/status tiene body desde zod updateStatusSchema", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "PATCH", "/api/orders/{{id}}/status");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("status");
  });

  test("endpoints con path param [id] → {{id}} en la URI", async () => {
    const { collection } = await runGenerate("nextjs-comprehensive");
    const ep = findEndpoint(collection, "GET", "/api/users/{{id}}");
    expect(ep).not.toBeNull();
    const rawUrl: string = ep?.request?.url?.raw ?? "";
    expect(rawUrl).toContain("{{id}}");
    expect(rawUrl).not.toContain("[id]");
  });
});
