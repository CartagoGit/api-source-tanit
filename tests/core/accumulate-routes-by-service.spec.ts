/**
 * Tests for the helper `accumulateRoutesByService` (x00025 S1).
 *
 * Five cases the proposal covers:
 *  1. Two scanners with the same `serviceId` -> union of routes, not
 *     just the ones from the last scanner.
 *  2. Same scanner emitting the same route twice -> dedupe to a single
 *     entry.
 *  3. Hybrid Express + GraphQL under the same `serviceId` -> both
 *     frameworks present in the resulting array.
 *  4. Two different `serviceId`s with the same `(method, uri)` (e.g.
 *     `GET /health` in `apps/users` and `apps/orders`) -> each key
 *     gets **only** the route its own scanner emitted. This is the
 *     original bug x00025 was opened for; before the fix, the
 *     `(method, uri)`-based filter attributed both routes to both
 *     serviceIds, mixing the collections.
 *  5. Two scanners with different `serviceId`s whose routes do not
 *     collide -> each key keeps its own routes, no cross-talk.
 *
 * The helper is pure: no disk, no `process.*`. The test needs no
 * bootstrap, only hand-built fixtures.
 */
import { describe, expect, it } from "vitest";

import { accumulateRoutesByService } from "../../packages/core/discovery/accumulate-routes-by-service.helper.js";
import type { ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface.js";

function route(
  method: string,
  uri: string,
  sourceFile: string,
  framework?: string,
): ParsedRoute {
  return {
    framework: framework ?? "express",
    method,
    uri,
    rawUri: uri,
    sourceFile,
    lineNumber: 1,
    prefixChain: [],
  };
}

describe("accumulateRoutesByService (x00025)", () => {
  it("dos scanners con el mismo serviceId acumulan (no sobrescriben)", () => {
    // Two scanners share `serviceId: "apps_api"`. Each contributed
    // a route that the other did not. The merged array must contain
    // both, in insertion order.
    const perScanner = [
      {
        serviceId: "apps_api",
        scannerRoutes: [route("GET", "/users", "src/users.routes.ts", "express")],
      },
      {
        serviceId: "apps_api",
        scannerRoutes: [route("POST", "/graphql", "src/graphql/server.ts", "graphql")],
      },
    ];

    const out = accumulateRoutesByService(perScanner);

    const merged = out.get("apps_api") ?? [];
    expect(merged).toHaveLength(2);
    const uris = merged.map((r) => r.uri);
    expect(uris).toEqual(["/users", "/graphql"]);
  });

  it("dedupe: misma tupla (method, uri, sourceFile) dos veces -> una entrada", () => {
    // Real case: two scanners that both recognise the same operation
    // (e.g. OpenAPI + framework detector on the same endpoint) each
    // emit a `ParsedRoute` for `GET /health`. The merged array must
    // contain one entry, not two.
    const perScanner = [
      {
        serviceId: "apps_api",
        scannerRoutes: [route("GET", "/health", "openapi.yaml", "openapi")],
      },
      {
        serviceId: "apps_api",
        scannerRoutes: [route("GET", "/health", "openapi.yaml", "openapi")],
      },
    ];

    const out = accumulateRoutesByService(perScanner);

    const merged = out.get("apps_api") ?? [];
    expect(merged).toHaveLength(1);
    expect(merged[0]?.uri).toBe("/health");
    expect(merged[0]?.sourceFile).toBe("openapi.yaml");
  });

  it("hibrido Express + GraphQL: ambas colecciones presentes bajo mismo serviceId", () => {
    // Case that originally closed x00025: Express and GraphQL under
    // the same `frameworkSearchRoot` (apps/api) produce two scanners
    // with `serviceId: "apps_api"`. Before the fix the second
    // scanner overwrote the first scanner's routes via `new Map`.
    const perScanner = [
      {
        serviceId: "apps_api",
        scannerRoutes: [
          route("GET", "/users", "src/routes/users.ts", "express"),
          route("POST", "/orders", "src/routes/orders.ts", "express"),
        ],
      },
      {
        serviceId: "apps_api",
        scannerRoutes: [route("POST", "/graphql", "src/graphql/server.ts", "graphql")],
      },
    ];

    const out = accumulateRoutesByService(perScanner);

    const merged = out.get("apps_api") ?? [];
    expect(merged).toHaveLength(3);
    const byMethod = new Map(
      merged.map((r) => [`${r.method} ${r.uri}`, r.framework] as const),
    );
    expect(byMethod.get("GET /users")).toBe("express");
    expect(byMethod.get("POST /orders")).toBe("express");
    expect(byMethod.get("POST /graphql")).toBe("graphql");
  });

  it("dos serviceIds distintos con el mismo (method, uri): NO se mezclan (bug original x00025)", () => {
    // The bug x00025 was opened for: `apps/users` and `apps/orders`
    // each define `GET /health` from their own scanner. Before the
    // fix, `routes.filter(r => scannerSpecs.some(s => s.method ===
    // r.method && s.uri === r.uri))` matched the cross-service route
    // too, so both `apps_users` and `apps_orders` ended up with both
    // routes -- the collections were mixed.
    //
    // After the fix, each scanner brings its own `scannerRoutes`,
    // so attribution is identity-free: `apps_users` keeps only its
    // `health.ts`, `apps_orders` keeps only its `health.ts`.
    const perScanner = [
      {
        serviceId: "apps_users",
        scannerRoutes: [route("GET", "/health", "apps/users/src/health.ts", "express")],
      },
      {
        serviceId: "apps_orders",
        scannerRoutes: [route("GET", "/health", "apps/orders/src/health.ts", "express")],
      },
    ];

    const out = accumulateRoutesByService(perScanner);

    const usersRoutes = out.get("apps_users") ?? [];
    const ordersRoutes = out.get("apps_orders") ?? [];

    // Each service has exactly one route, its own.
    expect(usersRoutes).toHaveLength(1);
    expect(ordersRoutes).toHaveLength(1);
    expect(usersRoutes[0]?.sourceFile).toBe("apps/users/src/health.ts");
    expect(ordersRoutes[0]?.sourceFile).toBe("apps/orders/src/health.ts");

    // And they are NOT the same object reference -- they came from
    // different scanners (cheap belt-and-suspenders against a
    // regression where both keys share an array by mistake).
    expect(usersRoutes[0]).not.toBe(ordersRoutes[0]);
  });

  it("serviceIds distintos con specs disjuntos se mantienen separados", () => {
    // Documents that the x00025 fix does not regress the basic
    // multi-service case: scanners that emit different routes into
    // different serviceIds stay cleanly separated.
    const perScanner = [
      {
        serviceId: "apps_api",
        scannerRoutes: [route("GET", "/health", "src/a.ts", "express")],
      },
      {
        serviceId: "apps_web",
        scannerRoutes: [route("POST", "/login", "src/b.ts", "nestjs")],
      },
    ];

    const out = accumulateRoutesByService(perScanner);

    expect(out.get("apps_api")?.[0]?.sourceFile).toBe("src/a.ts");
    expect(out.get("apps_web")?.[0]?.sourceFile).toBe("src/b.ts");
  });

  it("scanner sin rutas no aporta nada pero el serviceId queda presente", () => {
    // A scanner can appear in `perScanner` while contributing no
    // routes (e.g. detect() matched but the source had no
    // operations). The `serviceId` stays in the map with an empty
    // array, not removed -- downstream code may rely on the key being
    // present even when empty.
    const perScanner = [
      {
        serviceId: "apps_api",
        scannerRoutes: [route("GET", "/users", "src/users.ts")],
      },
      { serviceId: "apps_empty", scannerRoutes: [] },
    ];

    const out = accumulateRoutesByService(perScanner);

    expect(out.get("apps_api")).toHaveLength(1);
    expect(out.get("apps_api")?.[0]?.uri).toBe("/users");
    expect(out.get("apps_empty")).toEqual([]);
  });
});
