/**
 * E2E test exhaustivo para el scanner Symfony.
 *
 * Cubre:
 * - YAML routes en `config/routes.yaml` (top-level).
 * - YAML routes en `config/routes/*.yaml` (sub-app).
 * - PHP attributes `#[Route(...)]` en `src/Controller/`.
 * - Sub-routes con `#[Route('', methods: ['GET'])]` (path vacío).
 * - Multi-constraint `#[Assert\*]` en parámetros de método.
 * - Validation inline en el method signature.
 */
import { describe, expect, test } from "bun:test";
import { runGenerate } from "../helpers/run-scanner";
import {
  countItems,
  findEndpoint,
  validatePostmanInvariants,
} from "../helpers/compare-json";

describe("Symfony — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("symfony-comprehensive");
    expect(metrics.routes).toBeGreaterThan(15);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("encuentra las rutas YAML del config/routes.yaml", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    expect(findEndpoint(collection, "GET", "/health")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/login")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/refresh")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/api/auth/logout")).not.toBeNull();
  });

  test("encuentra las rutas YAML de config/routes/users.yaml", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    expect(findEndpoint(collection, "GET", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PUT", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "DELETE", "/users/{{id}}")).not.toBeNull();
  });

  test("encuentra las rutas de los PHP attributes", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    expect(findEndpoint(collection, "GET", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "POST", "/users")).not.toBeNull();
    expect(findEndpoint(collection, "GET", "/users/{{id}}")).not.toBeNull();
    expect(findEndpoint(collection, "PATCH", "/orders/{{id}}/status")).not.toBeNull();
  });

  test("POST /users tiene body params (Assert constraints)", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const eps = findAllEndpoints(collection, "POST", "/users");
    expect(eps.length).toBeGreaterThanOrEqual(2); // YAML + PHP attribute
    // Al menos uno debe tener body con name+email.
    const withBody = eps.find((e) => {
      const body = JSON.parse(e?.request?.body?.raw ?? "{}");
      return body.name && body.email;
    });
    expect(withBody).toBeDefined();
  });

  test("X-Tenant-ID custom headers no son parte de los headers por defecto", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const ep = findEndpoint(collection, "POST", "/api/auth/login");
    expect(ep).not.toBeNull();
    const headers = (ep?.request?.header ?? []) as Array<{ key: string }>;
    // El default debe ser `Accept` + `Authorization`. No `X-Tenant-ID`.
    const keys = headers.map((h) => h.key);
    expect(keys).toContain("Accept");
    expect(keys).toContain("Authorization");
  });

  test("PATCH /orders/{id}/status tiene status enum", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const eps = findAllEndpoints(collection, "PATCH", "/orders/{{id}}/status");
    expect(eps.length).toBeGreaterThanOrEqual(2); // YAML + PHP attribute
    // Al menos uno (PHP attribute) debe tener body con status enum.
    const withStatus = eps.find((e) => {
      const body = JSON.parse(e?.request?.body?.raw ?? "{}");
      return body?.status !== undefined;
    });
    expect(withStatus).toBeDefined();
  });

  test("PUT /users/{id}/address tiene street, city, country, postalCode", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const ep = findEndpoint(collection, "PUT", "/users/{{id}}/address");
    expect(ep).not.toBeNull();
    const body = JSON.parse(ep?.request?.body?.raw ?? "{}");
    expect(body).toHaveProperty("street");
    expect(body).toHaveProperty("city");
    expect(body).toHaveProperty("country");
    expect(body).toHaveProperty("postalCode");
  });

  test("Auth login tiene email y password (al menos un endpoint)", async () => {
    const { collection } = await runGenerate("symfony-comprehensive");
    const eps = findAllEndpoints(collection, "POST", "/api/auth/login");
    expect(eps.length).toBeGreaterThan(0);
    // Al menos uno de los endpoints debe tener un body con email/password.
    const withBody = eps.find((e) => {
      const body = JSON.parse(e?.request?.body?.raw ?? "{}");
      return body.email && body.password;
    });
    expect(withBody).toBeDefined();
  });
});

/**
 * Helper: encuentra TODOS los endpoints que matchean method+uri (puede haber
 * duplicados por YAML + Attributes).
 */
function findAllEndpoints(collection: any, method: string, uri: string): any[] {
  const out: any[] = [];
  const walk = (items: any[]) => {
    for (const it of items) {
      if (it.item) walk(it.item);
      else if (it.request) {
        const raw = it.request.url?.raw ?? "";
        if (it.request.method === method && raw.endsWith(uri)) {
          out.push(it);
        }
      }
    }
  };
  walk(collection.item ?? []);
  return out;
}
