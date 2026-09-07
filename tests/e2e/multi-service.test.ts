/**
 * c00010 S3 — multi-service fixture e2e (NestJS users-api + FastAPI billing-api).
 *
 * The fixture at `tests/fixtures/multi-service/` hosts two services in
 * separate workspaces (`apps/users-api/` — NestJS, `apps/billing-api/`
 * — FastAPI). The pipeline must:
 *
 *   1. Detect BOTH frameworks via the monorepo detector.
 *   2. Emit one `IGenerationResult` per service (one per `serviceId`),
 *      so spec isolation holds — neither collection should see the
 *      other's routes.
 *   3. Keep each route under its own prefix. `users-api` exposes
 *      `/api/users[/:id]`, `billing-api` exposes `/api/invoices[/:id]`.
 *      A regression that maps FastAPI paths into the NestJS collection
 *      (or vice-versa) trips this test.
 *
 * The deeper fix for per-endpoint baseUrl/auth (audit 2026-09-06 §18
 * priority 6, `r00019` phase-2) is tracked separately. This slice
 * only asserts route isolation, which is the precondition that makes
 * the deeper fix observable: once a regression here trips, the
 * per-endpoint fix has nothing to read.
 */
import { describe, expect, test } from "vitest";
import { join } from "node:path";
import { FIXTURES_DIR } from "../../scripts/helpers/root.helper.js";
import { defaultOrchestrator } from "../../packages/frameworks/index.js";
import { generateCollections } from "../../packages/core/discovery/generation.pipeline.js";
import type { IGenerationOptions } from "../../packages/contracts/interfaces/core/discovery.interface.js";
import type { PostmanItem } from "../../packages/contracts/interfaces/core/postman.interface";

const PROJECT = join(FIXTURES_DIR, "multi-service");

interface IItemShape {
  readonly name?: string;
  readonly item?: ReadonlyArray<IItemShape>;
  readonly request?: { readonly method?: string; readonly url?: { readonly raw?: string } };
}

function methodsByUri(collection: { item: ReadonlyArray<unknown> }): Map<string, string[]> {
  const out = new Map<string, string[]>();
  function walk(items: ReadonlyArray<unknown>): void {
    for (const it of items as IItemShape[]) {
      if (it.item && Array.isArray(it.item)) {
        walk(it.item);
        continue;
      }
      const method = it.request?.method;
      const rawUrl = it.request?.url?.raw ?? "";
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

function findResultByServiceId(
  results: ReadonlyArray<{ readonly serviceId?: string; readonly collection: { item: ReadonlyArray<unknown> } }>,
  needle: RegExp,
): { readonly serviceId?: string; readonly collection: { item: ReadonlyArray<unknown> } } | undefined {
  return results.find((r) => needle.test(r.serviceId ?? ""));
}

function asPostmanItem(value: unknown): PostmanItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { name?: unknown; item?: unknown; request?: unknown };
  if (typeof candidate.name !== "string") return null;
  if (candidate.item === undefined && candidate.request === undefined) return null;
  return value as PostmanItem;
}

describe("c00010 S3 — multi-service monorepo (NestJS users-api + FastAPI billing-api)", () => {
  test("el detector descubre ambos workspaces (users + invoices)", async () => {
    const options: IGenerationOptions = {
      combineServices: false,
      orchestrator: defaultOrchestrator(),
    };
    const results = await generateCollections(PROJECT, options);
    expect(results.length).toBeGreaterThanOrEqual(2);

    const usersResult = findResultByServiceId(results, /users/i);
    const billingResult = findResultByServiceId(results, /billing|invoices/i);
    expect(usersResult, "users-api result exists").toBeDefined();
    expect(billingResult, "billing-api result exists").toBeDefined();
  });

  test("cada servicio expone SOLO sus rutas; los prefijos no se cruzan", async () => {
    const options: IGenerationOptions = {
      combineServices: false,
      orchestrator: defaultOrchestrator(),
    };
    const results = await generateCollections(PROJECT, options);

    const usersResult = findResultByServiceId(results, /users/i);
    const billingResult = findResultByServiceId(results, /billing|invoices/i);
    expect(usersResult).toBeDefined();
    expect(billingResult).toBeDefined();

    const usersMethods = methodsByUri(usersResult!.collection);
    const billingMethods = methodsByUri(billingResult!.collection);

    // users-api: GET/POST /api/users + GET /api/users/{{id}} (Postman
    // template syntax for the NestJS path param `:id`).
    expect(usersMethods.get("/api/users")).toEqual(["GET", "POST"]);
    expect(usersMethods.get("/api/users/{{id}}")).toEqual(["GET"]);

    // billing-api: GET/POST /api/invoices + GET /api/invoices/{{invoice_id}}.
    expect(billingMethods.get("/api/invoices")).toEqual(["GET", "POST"]);
    expect(billingMethods.get("/api/invoices/{{invoice_id}}")).toEqual(["GET"]);

    // Cross-contamination: users NO debe llevar rutas de billing ni
    // vicerversa. Esto es la condición que `combineServices` NO
    // debe romper — el fix de r00019 (per-endpoint baseUrl/auth) se
    // construye sobre esta garantía.
    expect(usersMethods.get("/api/invoices")).toBeUndefined();
    expect(usersMethods.get("/api/invoices/{{invoice_id}}")).toBeUndefined();
    expect(billingMethods.get("/api/users")).toBeUndefined();
    expect(billingMethods.get("/api/users/{{id}}")).toBeUndefined();
  });

  test("no hay duplicados METHOD+uri entre los dos servicios", async () => {
    const options: IGenerationOptions = {
      combineServices: true,
      orchestrator: defaultOrchestrator(),
    };
    const results = await generateCollections(PROJECT, options);
    const flat = results.flatMap((r) => r.collection.item);

    const seen = new Map<string, number>();
    function walk(items: ReadonlyArray<unknown>): void {
      for (const it of items as IItemShape[]) {
        if (it.item && Array.isArray(it.item)) {
          walk(it.item);
          continue;
        }
        const method = it.request?.method ?? "";
        const rawUrl = it.request?.url?.raw ?? "";
        if (!method || !rawUrl) continue;
        const key = `${method} ${rawUrl.replace(/^\{\{baseUrl\}\}/, "")}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    walk(flat);

    const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicates, `expected no duplicate endpoints, got ${JSON.stringify(duplicates)}`).toEqual([]);
  });

  test("los items devueltos son postman items bien formados", async () => {
    const options: IGenerationOptions = {
      combineServices: false,
      orchestrator: defaultOrchestrator(),
    };
    const results = await generateCollections(PROJECT, options);

    const usersResult = findResultByServiceId(results, /users/i);
    expect(usersResult).toBeDefined();
    for (const item of usersResult!.collection.item) {
      // cada item de primer nivel debe ser folder o request, no `unknown`
      const candidate = asPostmanItem(item);
      expect(candidate, `item ${JSON.stringify(item)} is not a postman item`).not.toBeNull();
    }
  });
});