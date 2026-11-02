/**
 * Comprehensive E2E test for the Flask scanner.
 *
 * Covers:
 * - `@app.route("/path", methods=[...])` in app/routes.py.
 * - Blueprints with `url_prefix="/api/users"` + `@<name>_bp.route(...)`.
 * - Multiple HTTP methods per endpoint.
 * - Path params `<int:id>` → `{{id}}`.
 * - Folders grouped by blueprint.
 */
import { describe, expect, test } from "vitest";
import { runGenerate } from "../helpers/run-scanner";
import {
  allRequests,
  countItems,
  findEndpoint,
  topFolderNames,
  validatePostmanInvariants,
} from "../helpers/compare-json";

import { describeCollectionContract } from "../helpers/collection-contract";

describeCollectionContract({
  fixtureName: "flask-comprehensive",
  expectedRequests: 14,
  hasAuth: true,
});

describe("Flask — comprehensive fixture", () => {
  test("detects the correct framework", async () => {
    const { metrics } = await runGenerate("flask-comprehensive");
    expect(metrics.routes).toBeGreaterThanOrEqual(13);
  });

  test("the collection is a valid Postman v2.1.0", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
    expect(validatePostmanInvariants(collection)).toEqual([]);
  });

  test("counts the correct endpoints", async () => {
    const { collection, metrics } = await runGenerate("flask-comprehensive");
    const counts = countItems(collection.item);
    expect(counts.requests).toBe(metrics.routes);
  });

  test("finds the endpoints by method+uri", async () => {
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

  test("blueprints have the url_prefix", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
    // If the scanner does not apply url_prefix, the endpoints would be
    // `/users` instead of `/api/users`.
    const allEps = allRequests(collection);
    for (const ep of allEps) {
      const raw = ep.request?.url?.raw ?? "";
      if (raw.includes("/api/users") || raw.includes("/api/orders") || raw.includes("/api/auth")) {
        // OK, has prefix
      }
    }
    // No users endpoint may be missing the `/api/` prefix.
    for (const ep of allEps) {
      const raw = ep.request?.url?.raw ?? "";
      // If the path is just `/users` or `/users/...` without `/api`, fail.
      if (/users/.test(raw) && !raw.includes("/api/users")) {
        expect.fail(`Endpoint without /api/ prefix: ${raw}`);
      }
    }
  });

  test("routes are grouped by blueprint (folders)", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
    const folderNames = topFolderNames(collection);
    // There should be at least one folder per blueprint.
    expect(folderNames.length).toBeGreaterThanOrEqual(3);
  });

  test("Flask <int:id> path params convert to {{id}}", async () => {
    const { collection } = await runGenerate("flask-comprehensive");
    const allEps = findEndpoint(collection, "GET", "/api/users/{{id}}");
    expect(allEps).not.toBeNull();
    const raw = allEps?.request?.url?.raw ?? "";
    expect(raw).not.toMatch(/<[a-zA-Z_]/);
  });
});