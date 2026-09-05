/**
 * Tests for the `toServiceGraph` helper (a00013 S2).
 *
 * The S2 helper is **adjacent**: nobody it uses it yet; it exists so
 * that S3 and S4 can plug it in without changing the contract. The
 * tests guarantee the two invariants S2 lays down:
 *
 *  1. A flat project (single match) produces a graph with
 *     `services.length === 1` and `combined === false`. This is the
 *     path of 100% of the examples.
 *  2. A multi-workspace monorepo produces one service per match,
 *     without merging even when the routes are identical. This is
 *     the architectural P1 that a00013 closed.
 *
 * `decorateServices` is tested separately because its contract is
 * orthogonal to `toServiceGraph`'s.
 */
import { describe, expect, it } from "vitest";

import { decorateServices, toServiceGraph } from "../../packages/core/discovery/to-service-graph.helper.js";
import type {
  IEndpointAuth,
} from "../../packages/contracts/interfaces/core/postman.interface.js";
import type {
  IProjectMatch,
  ParsedRoute,
} from "../../packages/contracts/interfaces/core/scanner.interface.js";
import type { IMonorepoDetection } from "../../packages/contracts/interfaces/core/discovery.interface.js";

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

const monorepoMulti: IMonorepoDetection = {
  isMonorepo: true,
  signal: "package.json#workspaces",
  workspaceDirs: ["apps/users-api", "apps/payments-api"],
  frameworkSearchRoot: null,
};

describe("toServiceGraph", () => {
  it("single-service produces a graph with length 1 and combined false", () => {
    const m = match("express", "/repo/apps/api", "apps/api");
    const routes = new Map<string, ReadonlyArray<ParsedRoute>>([
      ["apps_api", [route("GET", "/health")]],
    ]);
    const graph = toServiceGraph({ matches: [m], routesByService: routes });
    expect(graph.services).toHaveLength(1);
    expect(graph.combined).toBe(false);
    expect(graph.services[0]?.serviceId).toBe("apps_api");
    expect(graph.services[0]?.endpoints).toHaveLength(1);
  });

  it("single-service without frameworkSearchRoot falls back to framework@projectRoot", () => {
    const m = match("nestjs", "/repo");
    const graph = toServiceGraph({ matches: [m], routesByService: new Map() });
    expect(graph.services).toHaveLength(1);
    expect(graph.services[0]?.serviceId).toBe("nestjs_repo");
  });

  it("multi-service preserves identity even when the routes are identical", () => {
    const users = match("express", "/repo", "apps/users-api");
    const payments = match("nestjs", "/repo", "apps/payments-api");
    const routes = new Map<string, ReadonlyArray<ParsedRoute>>([
      ["apps_users-api", [route("GET", "/health")]],
      ["apps_payments-api", [route("GET", "/health")]],
    ]);
    const graph = toServiceGraph({
      matches: [users, payments],
      routesByService: routes,
      monorepoDetection: monorepoMulti,
    });
    expect(graph.services).toHaveLength(2);
    expect(graph.services[0]?.serviceId).toBe("apps_users-api");
    expect(graph.services[1]?.serviceId).toBe("apps_payments-api");
    expect(graph.services[0]?.endpoints[0]?.uri).toBe("/health");
    expect(graph.services[1]?.endpoints[0]?.uri).toBe("/health");
  });

  it("fills empty entries when the caller omits routes for a match", () => {
    const m = match("express", "/repo", "apps/api");
    const graph = toServiceGraph({
      matches: [m],
      routesByService: new Map(),
    });
    expect(graph.services).toHaveLength(1);
    expect(graph.services[0]?.endpoints).toHaveLength(0);
  });

  it("a declared monorepo with no matches returns an empty graph (no invented service)", () => {
    const graph = toServiceGraph({
      matches: [],
      routesByService: new Map(),
      monorepoDetection: {
        isMonorepo: true,
        signal: "turbo.json",
        workspaceDirs: [],
        frameworkSearchRoot: null,
      },
    });
    expect(graph.services).toEqual([]);
    expect(graph.combined).toBe(false);
  });

  it("respects the caller's combined (future --combine-services)", () => {
    const m1 = match("express", "/repo", "a");
    const m2 = match("nestjs", "/repo", "b");
    const graph = toServiceGraph({
      matches: [m1, m2],
      routesByService: new Map(),
      combined: true,
    });
    expect(graph.combined).toBe(true);
    expect(graph.services).toHaveLength(2);
  });

  it("propagates baseUrl and auth when the caller passes them", () => {
    const m = match("express", "/repo", "apps/api");
    const auth: IEndpointAuth = { kind: "scheme", scheme: "bearer" };
    const graph = toServiceGraph({
      matches: [m],
      routesByService: new Map(),
      baseUrlByService: new Map([["apps_api", "http://localhost:3001"]]),
      authByService: new Map([["apps_api", auth]]),
    });
    expect(graph.services[0]?.baseUrl).toBe("http://localhost:3001");
    expect(graph.services[0]?.auth).toEqual(auth);
  });
});

describe("decorateServices", () => {
  it("applies baseUrl and auth only where the caller provides them", () => {
    const m = match("express", "/repo", "apps/api");
    const graph = toServiceGraph({
      matches: [m],
      routesByService: new Map(),
    });
    const decorated = decorateServices(graph, {
      baseUrlByService: new Map([["apps_api", "http://x"]]),
    });
    expect(decorated.services[0]?.baseUrl).toBe("http://x");
    expect(decorated.services[0]?.auth).toBeUndefined();
  });

  it("preserves the original graph's combined", () => {
    const m = match("express", "/repo", "apps/api");
    const graph = toServiceGraph({
      matches: [m],
      routesByService: new Map(),
      combined: true,
    });
    const decorated = decorateServices(graph, {});
    expect(decorated.combined).toBe(true);
  });

  it("variables per service default to an empty array", () => {
    const m = match("express", "/repo", "apps/api");
    const graph = toServiceGraph({
      matches: [m],
      routesByService: new Map(),
    });
    const decorated = decorateServices(graph, {
      variablesByService: new Map([
        ["apps_api", [{ key: "PORT", value: "3001" }]],
      ]),
    });
    expect(decorated.services[0]?.variables).toEqual([
      { key: "PORT", value: "3001" },
    ]);
  });
});
