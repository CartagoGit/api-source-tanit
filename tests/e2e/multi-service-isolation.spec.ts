/**
 * x00028 S3 — Multi-service spec isolation end-to-end.
 *
 * The fixture has two services (`apps/users-api` and `apps/orders-api`)
 * that each declare `GET /health`. Before x00028 the global catalog
 * held both routes and every service's collection ended up with TWO
 * `GET /health` entries (one from each scanner), because both saw the
 * same `[...discovery.specs]`.
 *
 * After x00028 each service's collection has exactly ONE `GET /health`
 * (its own). The test verifies that the generated items do not cross
 * services.
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { FIXTURES_DIR } from "../../scripts/helpers/root.helper.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { generateCollections } from "../../packages/core/discovery/generation.pipeline.js";
import type { IGenerationOptions } from "../../packages/contracts/interfaces/core/discovery.interface.js";

const PROJECT = join(FIXTURES_DIR, "multi-service-isolation");

function methodsByUri(collection: { item: ReadonlyArray<unknown> }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  function walk(items: ReadonlyArray<unknown>): void {
    for (const it of items as Array<{
      item?: unknown;
      request?: { method?: string; url?: { raw?: string } };
      name?: string;
    }>) {
      if (it.item && Array.isArray(it.item)) {
        walk(it.item);
        continue;
      }
      const method = it.request?.method;
      const rawUrl = it.request?.url?.raw ?? "";
      // La url viene como {{baseUrl}}/api/...; nos quedamos con el
      // path para emparejar.
      const path = rawUrl.replace(/^\{\{baseUrl\}\}/, "");
      if (method && path) {
        const list = out.get(path) ?? [];
        list.push(method);
        out.set(path, list);
      }
    }
  }
  walk(collection.item);
  return out;
}

describe("x00028 S3 — multi-service isolation (apps/users + apps/orders)", () => {
  test("cada servicio expone SOLO sus propios endpoints", async () => {
    // generateCollections devuelve un IGenerationResult por servicio
    // (uno por `serviceId`). Si la spec isolation estuviera rota,
    // todos los servicios contendrían las rutas de los demás.
    const options: IGenerationOptions = {
      combineServices: false,
      orchestrator: defaultOrchestrator(),
    };
    const results = await generateCollections(PROJECT, options);
    expect(results.length).toBeGreaterThanOrEqual(2);

    for (const result of results) {
      const methods = methodsByUri(result.collection);
      const health = methods.get("/health") ?? [];
      expect(
        health,
        `${result.serviceId ?? "?"} should have exactly one GET /health, got ${JSON.stringify(health)}`,
      ).toEqual(["GET"]);
    }
  });

  test("los endpoints únicos de cada servicio no se cruzan", async () => {
    const options: IGenerationOptions = {
      combineServices: false,
      orchestrator: defaultOrchestrator(),
    };
    const results = await generateCollections(PROJECT, options);
    // Buscamos los resultados que mencionan "users" y "orders".
    const usersResult = results.find((r) => /users/i.test(r.serviceId ?? ""));
    const ordersResult = results.find((r) => /orders/i.test(r.serviceId ?? ""));

    expect(usersResult, "users result exists").toBeDefined();
    expect(ordersResult, "orders result exists").toBeDefined();

    const usersMethods = methodsByUri(usersResult!.collection);
    const ordersMethods = methodsByUri(ordersResult!.collection);

    // /api/users es del servicio users — orders NO debe verlo.
    expect(usersMethods.get("/api/users")).toBeDefined();
    expect(ordersMethods.has("/api/users")).toBe(false);

    // /api/orders es del servicio orders — users NO debe verlo.
    expect(ordersMethods.get("/api/orders")).toBeDefined();
    expect(usersMethods.has("/api/orders")).toBe(false);
  });
});
