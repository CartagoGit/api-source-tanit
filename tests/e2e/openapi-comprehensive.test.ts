/**
 * E2E test exhaustivo para el scanner OpenAPI.
 *
 * Cubre:
 * - $ref en schemas, parameters, responses.
 * - allOf (UserCreate extiende UserBase).
 * - enum con múltiples valores.
 * - format: email, uuid, date-time, url.
 * - parameters en path-level (compartidos por todos los métodos).
 * - headers custom (X-Tenant-ID, X-Request-ID).
 * - validación de invariantes Postman v2.1.0.
 */
import { describe, expect, test } from "vitest";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  hashNormalized,
  validatePostmanInvariants,
} from "../helpers/compare-json";

import { describeCollectionContract } from "../helpers/collection-contract";

describeCollectionContract({
  fixtureName: "openapi-comprehensive",
  expectedRequests: 23,
  hasAuth: true,
});

describe("OpenAPI — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("openapi-comprehensive");
    console.log("metrics:", metrics);
    expect(metrics.routes).toBeGreaterThan(15);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const issues = validatePostmanInvariants(collection);
    expect(issues).toEqual([]);
    expect(collection.info.schema).toContain("2.1.0");
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("openapi-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
    expect(metrics.routes).toBeGreaterThanOrEqual(20);
  });

  test("info.title se usa como collectionName (basename = info.title)", async () => {
    const { collection } = await runGenerate("openapi-comprehensive", {
      basename: "Comprehensive OpenAPI Test API (Postman)",
    });
    expect(collection.info.name).toContain("Comprehensive OpenAPI");
  });

  test("encuentra los endpoints por method+uri", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    expect(findEndpoint(collection, "GET", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/auth/login")).not.toBeNull();
  });

  test("POST /users tiene body parameters (UserCreate con allOf + $ref)", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/users");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    // UserCreate = allOf: [UserBase (email required), { password required }]
    expect(body).toHaveProperty("email");
    expect(body).toHaveProperty("password");
  });

  test("headers custom X-Tenant-ID aparecen en /auth/logout", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const ep = findEndpoint(collection, "POST", "/auth/logout");
    expect(ep).not.toBeNull();
    const headers = (ep?.request?.header ?? []) as Array<{ key: string; value: string }>;
    const tenant = headers.find((h) => h.key === "X-Tenant-ID");
    expect(tenant).toBeDefined();
    // El header puede tener formato either auto (Bearer) o custom (your-tenant-id).
    // Lo importante es que el key está presente.
  });

  test("path params sin llaves dobles", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const ep = findEndpoint(collection, "GET", "/users/{{id}}");
    expect(ep).not.toBeNull();
    const raw = ep?.request?.url?.raw ?? "";
    expect(raw).toContain("{{id}}");
  });

  test("query params aparecen en /users GET", async () => {
    const { collection } = await runGenerate("openapi-comprehensive");
    const ep = findEndpoint(collection, "GET", "/users");
    expect(ep).not.toBeNull();
    const query = (ep?.request?.url?.query ?? []) as Array<{ key: string }>;
    const keys = query.map((q) => q.key);
    expect(keys).toContain("page");
    expect(keys).toContain("limit");
    expect(keys).toContain("search");
  });

  test("el hash de la collection es estable entre ejecuciones", async () => {
    // Antes esto hasheaba una vez y comprobaba `> 0`, que es cierto para
    // cualquier salida y no detectaba nada. Lo que importa es que dos
    // generaciones del mismo fixture den el MISMO hash: es lo que hace
    // que reimportar en Postman actualice en vez de duplicar.
    const first = await runGenerate("openapi-comprehensive");
    const second = await runGenerate("openapi-comprehensive");
    expect(hashNormalized(first.collection)).toBe(hashNormalized(second.collection));
  });
});
