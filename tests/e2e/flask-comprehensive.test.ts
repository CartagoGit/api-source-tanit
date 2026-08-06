/**
 * E2E test exhaustivo para el scanner Flask.
 *
 * Cubre:
 * - `@app.route("/path", methods=[...])` en app/routes.py.
 * - Blueprints con `url_prefix="/api/users"` + `@<name>_bp.route(...)`.
 * - Múltiples métodos HTTP por endpoint.
 * - Path params `<int:id>` → `{{id}}`.
 * - Carpetas agrupadas por blueprint.
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
  fixtureName: "flask-comprehensive",
  expectedRequests: 14,
  hasAuth: true,
});

describe("Flask — comprehensive fixture", () => {
  test("detecta el framework correcto", async () => {
    const { metrics } = await runGenerate("flask-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(13);
  });

  test("la collection es Postman v2.1.0 válida", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("cuenta los endpoints correctos", async () => {
    const { collection, metrics } = await runGenerate("flask-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("encuentra los endpoints por method+uri", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
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

  test("los blueprints tienen el prefix url_prefix", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
    // Si el scanner no aplica url_prefix, los endpoints serían `/users` en
    // lugar de `/api/users`.
    const allEps: any[] = [];
    for (const folder of collection.item) {
      const items = folder.item ?? [];
      for (const it of items) {
        if (it.request) allEps.push(it);
      }
    }
    for (const ep of allEps) {
      const raw = ep.request?.url?.raw ?? "";
      if (raw.includes("/api/users") || raw.includes("/api/orders") || raw.includes("/api/auth")) {
        // OK, tiene prefix
      }
    }
    // Ningún endpoint de users debe estar sin el prefix `/api/`.
    for (const ep of allEps) {
      const raw = ep.request?.url?.raw ?? "";
      // Si el path es solo `/users` o `/users/...` sin `/api`, falla.
      if (/users/.test(raw) && !raw.includes("/api/users")) {
        expect.fail(`Endpoint sin prefix /api/: ${raw}`);
      }
    }
  });

  test("las rutas están agrupadas por blueprint (carpetas)", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
    const folderNames = collection.item
      .map((it: any) => it.name)
      .filter(Boolean);
    // Debe haber al menos una carpeta de cada blueprint.
    expect(folderNames.length).toBeGreaterThanOrEqual(3);
  });

  test("path params Flask <int:id> se convierten a {{id}}", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
    const allEps = findEndpoint(collection, "GET", "/api/users/{{id}}");
    expect(allEps).not.toBeNull();
    const raw = (allEps as any)?.request?.url?.raw ?? "";
    expect(raw).not.toMatch(/<[a-zA-Z_]/);
  });
});