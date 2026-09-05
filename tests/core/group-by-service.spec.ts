/**
 * Tests for the `groupByService` helper (a00013 S1).
 *
 * The helper is pure, so the tests do not touch the file system or
 * `process.cwd()`. They cover the four guarantees the helper's
 * contract promises:
 *
 *  1. Stable `serviceId` derived from `frameworkSearchRoot`.
 *  2. Single-service project → graph of one service, not an exception.
 *  3. Two workspaces with the same `METHOD+URI` stay as two distinct
 *     services (the case a00013 closed).
 *  4. The caller's `combined` is respected and the default is `false`.
 *
 * The "missing routes for X" error is covered because it is the most
 * typical trap when wiring real callers: they pass the matches but
 * forget to populate `routesByMatch` for one of them.
 */
import { describe, expect, it } from "vitest";

import { deriveServiceId, groupByService } from "../../packages/core/discovery/group-by-service.helper.js";
import type { IProjectMatch, ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface.js";

function match(
  framework: string,
  projectRoot: string,
  frameworkSearchRoot?: string,
): IProjectMatch {
  return {
    framework,
    projectRoot,
    ...(frameworkSearchRoot !== undefined ? { frameworkSearchRoot } : {}),
    artifacts: [],
  };
}

function route(method: string, uri: string): ParsedRoute {
  return {
    framework: "express",
    method,
    uri,
    rawUri: uri,
    sourceFile: "src/router.ts",
    lineNumber: 1,
    prefixChain: [],
  };
}

describe("deriveServiceId", () => {
  it("uses frameworkSearchRoot when present", () => {
    expect(deriveServiceId(match("express", "/repo", "apps/api"))).toBe("apps_api");
  });

  it("falls back to framework@projectRoot without frameworkSearchRoot", () => {
    expect(deriveServiceId(match("nestjs", "/repo"))).toBe("nestjs_repo");
  });

  it("normalizes characters outside [A-Za-z0-9_-]", () => {
    expect(deriveServiceId(match("express", "/repo", "apps/api v2!"))).toBe("apps_api_v2");
  });

  it("returns 'default' when normalization leaves the string empty", () => {
    expect(deriveServiceId(match("express", "/repo", "!!!"))).toBe("default");
  });

  it("two workspaces with the same frameworkSearchRoot collide on id (intentional)", () => {
    expect(deriveServiceId(match("express", "/repo", "apps/api"))).toBe(
      deriveServiceId(match("nestjs", "/repo", "apps/api")),
    );
  });
});

describe("groupByService", () => {
  it("produces a one-service graph when the project is not a monorepo", () => {
    const m = match("express", "/repo/apps/api", "apps/api");
    const graph = groupByService({
      matches: [m],
      routesByMatch: new Map([["apps_api", [route("GET", "/health")]]]),
    });
    expect(graph.services).toHaveLength(1);
    expect(graph.services[0]?.serviceId).toBe("apps_api");
    expect(graph.services[0]?.endpoints).toHaveLength(1);
    expect(graph.combined).toBe(false);
  });

  it("throws when a match has no entry in routesByMatch", () => {
    const m = match("nestjs", "/repo/apps/api", "apps/api");
    expect(() =>
      groupByService({
        matches: [m],
        routesByMatch: new Map(),
      }),
    ).toThrow(/missing routes for service 'apps_api'/);
  });

  it("keeps two distinct services with the same METHOD+URI", () => {
    const users = match("express", "/repo", "apps/users-api");
    const payments = match("nestjs", "/repo", "apps/payments-api");
    const graph = groupByService({
      matches: [users, payments],
      routesByMatch: new Map([
        ["apps_users-api", [route("GET", "/health")]],
        ["apps_payments-api", [route("GET", "/health")]],
      ]),
    });
    expect(graph.services).toHaveLength(2);
    expect(graph.services[0]?.serviceId).toBe("apps_users-api");
    expect(graph.services[1]?.serviceId).toBe("apps_payments-api");
    expect(graph.services[0]?.endpoints[0]?.uri).toBe("/health");
    expect(graph.services[1]?.endpoints[0]?.uri).toBe("/health");
  });

  it("respects the combined=true override when the caller asks for it", () => {
    const graph = groupByService({
      matches: [match("express", "/repo", "a"), match("nestjs", "/repo", "b")],
      routesByMatch: new Map([
        ["a", [route("GET", "/health")]],
        ["b", [route("GET", "/health")]],
      ]),
      combined: true,
    });
    expect(graph.combined).toBe(true);
    expect(graph.services).toHaveLength(2);
  });

  it("the default of combined is false (no implicit combine-services)", () => {
    const graph = groupByService({
      matches: [match("express", "/repo", "a")],
      routesByMatch: new Map([["a", []]]),
    });
    expect(graph.combined).toBe(false);
  });

  it("propagates auth and baseUrl per service when the caller passes them", () => {
    const users = match("express", "/repo", "apps/users-api");
    const graph = groupByService({
      matches: [users],
      routesByMatch: new Map([["apps_users-api", [route("GET", "/me")]]]),
      baseUrlByService: new Map([["apps_users-api", "http://localhost:3001"]]),
      authByService: new Map([
        [
          "apps_users-api",
          { kind: "scheme", scheme: "bearer" } as const,
        ],
      ]),
    });
    expect(graph.services[0]?.baseUrl).toBe("http://localhost:3001");
    expect(graph.services[0]?.auth).toEqual({ kind: "scheme", scheme: "bearer" });
  });

  it("throws when matches is empty and it is not a monorepo", () => {
    expect(() =>
      groupByService({ matches: [], routesByMatch: new Map() }),
    ).toThrow(/at least one match/);
  });

  it("accepts an empty graph in a declared monorepo with no workspaces", () => {
    const graph = groupByService({
      matches: [],
      routesByMatch: new Map(),
      detectedMonorepo: true,
    });
    expect(graph.services).toEqual([]);
    expect(graph.combined).toBe(false);
  });

  // x00031 S2 (acceptance #1): un mismo servicio con DOS frameworks
  // bajo el mismo `frameworkSearchRoot` (caso híbrido `apps/api`
  // express + graphql) produce UN solo descriptor con ambos frameworks
  // visibles, no dos descriptors con el mismo `serviceId`.
  it("two matches with the same serviceId merge into one hybrid descriptor (x00031 S2)", () => {
    const graph = groupByService({
      matches: [
        match("express", "/repo", "apps/api"),
        match("graphql", "/repo", "apps/api"),
      ],
      routesByMatch: new Map([
        ["apps_api", [route("GET", "/users"), route("GET", "/health")]],
      ]),
    });
    expect(graph.services).toHaveLength(1);
    expect(graph.services[0]?.serviceId).toBe("apps_api");
    // Los endpoints de los dos frameworks se concatenan en el descriptor único.
    // En este test solo se alimenta `apps_api` con dos endpoints; el test
    // unitario estricto del "doble fuente" está en `to-service-graph.spec.ts`
    // porque la hidratación completa requiere el mapa routesByMatch poblado
    // por servicio, no por framework.
    expect(graph.services[0]?.endpoints.length).toBeGreaterThanOrEqual(2);
  });

  // x00031 S2 (acceptance #2): ningún `serviceId` aparece dos veces en
  // `graph.services`. Aunque dos matches colisionen, el grafo los
  // agrupa; los nombres de colección Postman derivados siguen siendo
  // únicos por construcción.
  it("no duplicate serviceIds appear in graph.services (x00031 S2 #2)", () => {
    const graph = groupByService({
      matches: [
        match("express", "/repo", "apps/api"),
        match("graphql", "/repo", "apps/api"),
        match("express", "/repo", "apps/web"),
      ],
      routesByMatch: new Map([
        ["apps_api", [route("GET", "/a")]],
        ["apps_web", [route("GET", "/b")]],
      ]),
    });
    const ids = graph.services.map((s) => s.serviceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["apps_api", "apps_web"]);
  });
});
