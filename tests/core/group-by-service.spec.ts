/**
 * Tests del helper `groupByService` (a00013 S1).
 *
 * El helper es puro, así que los tests no tocan el sistema de
 * archivos ni `process.cwd()`. Cubren las cuatro garantías que el
 * contrato del helper promete:
 *
 *  1. `serviceId` estable y derivado de `frameworkSearchRoot`.
 *  2. Proyecto de un solo servicio → grafo de un servicio, no
 *     una excepción.
 *  3. Dos workspaces con misma `METHOD+URI` se mantienen como dos
 *     servicios distintos (el caso que cerraba a00013).
 *  4. `combined` del caller se respeta y el default es `false`.
 *
 * El error de "faltan rutas para X" se cubre porque es la trampa
 * más típica al cablear callers reales: pasan los matches pero
 * olvidan poblar `routesByMatch` para alguno.
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
  it("usa frameworkSearchRoot cuando existe", () => {
    expect(deriveServiceId(match("express", "/repo", "apps/api"))).toBe("apps_api");
  });

  it("cae a framework@projectRoot sin frameworkSearchRoot", () => {
    expect(deriveServiceId(match("nestjs", "/repo"))).toBe("nestjs_repo");
  });

  it("normaliza caracteres fuera de [A-Za-z0-9_-]", () => {
    expect(deriveServiceId(match("express", "/repo", "apps/api v2!"))).toBe("apps_api_v2");
  });

  it("devuelve 'default' cuando la normalización deja la cadena vacía", () => {
    expect(deriveServiceId(match("express", "/repo", "!!!"))).toBe("default");
  });

  it("dos workspaces con mismo frameworkSearchRoot colisionan en id (intencional)", () => {
    expect(deriveServiceId(match("express", "/repo", "apps/api"))).toBe(
      deriveServiceId(match("nestjs", "/repo", "apps/api")),
    );
  });
});

describe("groupByService", () => {
  it("produce un grafo de un servicio cuando el proyecto no es monorepo", () => {
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

  it("lanza cuando un match no tiene entrada en routesByMatch", () => {
    const m = match("nestjs", "/repo/apps/api", "apps/api");
    expect(() =>
      groupByService({
        matches: [m],
        routesByMatch: new Map(),
      }),
    ).toThrow(/missing routes for service 'apps_api'/);
  });

  it("mantiene dos services distintos con misma METHOD+URI", () => {
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

  it("respeta el override combined=true cuando el caller lo pide", () => {
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

  it("el default de combined es false (no combine-services implícito)", () => {
    const graph = groupByService({
      matches: [match("express", "/repo", "a")],
      routesByMatch: new Map([["a", []]]),
    });
    expect(graph.combined).toBe(false);
  });

  it("propaga auth y baseUrl por servicio cuando el caller los pasa", () => {
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

  it("lanza cuando matches está vacío y no es monorepo", () => {
    expect(() =>
      groupByService({ matches: [], routesByMatch: new Map() }),
    ).toThrow(/at least one match/);
  });

  it("acepta grafo vacío en monorepo declarado sin workspaces", () => {
    const graph = groupByService({
      matches: [],
      routesByMatch: new Map(),
      detectedMonorepo: true,
    });
    expect(graph.services).toEqual([]);
    expect(graph.combined).toBe(false);
  });
});
