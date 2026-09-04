/**
 * Tests del helper `toServiceGraph` (a00013 S2).
 *
 * El helper S2 es **adyacente**: no lo consume nadie todavía; vive
 * para que S3 y S4 lo enchufen sin tener que cambiar el contrato. Los
 * tests garantizan las dos invariantes que S2 deja sentadas:
 *
 *  1. Un proyecto plano (un solo match) produce un grafo con
 *     `services.length === 1` y `combined === false`. Es el camino
 *     del 100% de los ejemplos.
 *  2. Un monorepo multi-workspace produce un servicio por match,
 *     sin fusionar ni siquiera cuando las rutas son iguales. Es el
 *     P1 arquitectónico que cerraba a00013.
 *
 * `decorateServices` se prueba por separado porque su contrato es
 * ortogonal al de `toServiceGraph`.
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
  it("single-service produce un grafo con length 1 y combined false", () => {
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

  it("single-service sin frameworkSearchRoot cae a framework@projectRoot", () => {
    const m = match("nestjs", "/repo");
    const graph = toServiceGraph({ matches: [m], routesByService: new Map() });
    expect(graph.services).toHaveLength(1);
    expect(graph.services[0]?.serviceId).toBe("nestjs_repo");
  });

  it("multi-service mantiene identidad aunque las rutas sean iguales", () => {
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

  it("rellena entradas vacias cuando el caller omite rutas de un match", () => {
    const m = match("express", "/repo", "apps/api");
    const graph = toServiceGraph({
      matches: [m],
      routesByService: new Map(),
    });
    expect(graph.services).toHaveLength(1);
    expect(graph.services[0]?.endpoints).toHaveLength(0);
  });

  it("monorepo declarado sin matches devuelve grafo vacio (no inventa servicio)", () => {
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

  it("respeta el combined del caller (futuro --combine-services)", () => {
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

  it("propaga baseUrl y auth cuando el caller los pasa", () => {
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
  it("aplica baseUrl y auth solo donde el caller los da", () => {
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

  it("conserva combined del grafo original", () => {
    const m = match("express", "/repo", "apps/api");
    const graph = toServiceGraph({
      matches: [m],
      routesByService: new Map(),
      combined: true,
    });
    const decorated = decorateServices(graph, {});
    expect(decorated.combined).toBe(true);
  });

  it("variables por servicio se propagan vacias por defecto", () => {
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
