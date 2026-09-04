/**
 * Tests del helper `accumulateRoutesByService` (x00025 S1).
 *
 * Tres casos del proposal:
 *  1. Dos scanners con el mismo `serviceId` -> union de rutas, no
 *     solo las del ultimo.
 *  2. Mismo scanner emitiendo la misma ruta dos veces -> dedupe a
 *     una sola entrada.
 *  3. Hibrido Express + GraphQL bajo el mismo `serviceId` -> ambas
 *     colecciones presentes en el array resultante.
 *
 * El helper es puro: no toca disco, no lee `process.*`. Asi que el
 * test no necesita bootstrap, solo construir las fixtures a mano.
 */
import { describe, expect, it } from "vitest";

import { accumulateRoutesByService } from "../../packages/core/discovery/accumulate-routes-by-service.helper.js";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface.js";
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

function spec(method: "GET" | "POST", uri: string): EndpointSpec {
  return { method, uri, name: `${method} ${uri}` };
}

describe("accumulateRoutesByService (x00025)", () => {
  it("dos scanners con el mismo serviceId acumulan (no sobrescriben)", () => {
    const routes: ParsedRoute[] = [
      route("GET", "/users", "src/users.routes.ts", "express"),
      route("POST", "/graphql", "src/graphql.routes.ts", "graphql"),
    ];
    const perScanner = [
      { serviceId: "apps_api", scannerSpecs: [spec("GET", "/users")] },
      { serviceId: "apps_api", scannerSpecs: [spec("POST", "/graphql")] },
    ];

    const out = accumulateRoutesByService(perScanner, routes);

    const merged = out.get("apps_api") ?? [];
    expect(merged).toHaveLength(2);
    const uris = merged.map((r) => r.uri).sort();
    expect(uris).toEqual(["/graphql", "/users"]);
  });

  it("dedupe: misma tupla (method, uri, sourceFile) dos veces -> una entrada", () => {
    // Mismo scanner emitiendo la misma ruta dos veces via el mismo
    // `scannerSpecs`. Antes del fix esto era imposible porque cada
    // scanner se llamaba una vez, pero con dos scanners que ambos
    // reconocen la misma operacion (caso real: OpenAPI + framework
    // detector sobre el mismo endpoint) la duplicacion aparecia.
    const routes: ParsedRoute[] = [
      route("GET", "/health", "openapi.yaml"),
      route("GET", "/health", "openapi.yaml"),
    ];
    const perScanner = [
      { serviceId: "apps_api", scannerSpecs: [spec("GET", "/health")] },
      { serviceId: "apps_api", scannerSpecs: [spec("GET", "/health")] },
    ];

    const out = accumulateRoutesByService(perScanner, routes);

    const merged = out.get("apps_api") ?? [];
    expect(merged).toHaveLength(1);
    expect(merged[0]?.uri).toBe("/health");
    expect(merged[0]?.sourceFile).toBe("openapi.yaml");
  });

  it("hibrido Express + GraphQL: ambas colecciones presentes bajo mismo serviceId", () => {
    // Caso que cerro x00025: Express y GraphQL bajo el mismo
    // `frameworkSearchRoot` (apps/api) producen dos scanners con
    // `serviceId: "apps_api"`. Antes el segundo scanner sobrescribia
    // las rutas del primero.
    const routes: ParsedRoute[] = [
      route("GET", "/users", "src/routes/users.ts", "express"),
      route("POST", "/orders", "src/routes/orders.ts", "express"),
      route("POST", "/graphql", "src/graphql/server.ts", "graphql"),
    ];
    const perScanner = [
      {
        serviceId: "apps_api",
        scannerSpecs: [
          spec("GET", "/users"),
          spec("POST", "/orders"),
        ],
      },
      { serviceId: "apps_api", scannerSpecs: [spec("POST", "/graphql")] },
    ];

    const out = accumulateRoutesByService(perScanner, routes);

    const merged = out.get("apps_api") ?? [];
    expect(merged).toHaveLength(3);
    const byMethod = new Map(merged.map((r) => [`${r.method} ${r.uri}`, r.framework]));
    expect(byMethod.get("GET /users")).toBe("express");
    expect(byMethod.get("POST /orders")).toBe("express");
    expect(byMethod.get("POST /graphql")).toBe("graphql");
  });

  it("serviceIds distintos se mantienen separados", () => {
    // Cada scanner tiene sus propios `scannerSpecs` (no solapados),
    // asi que cada serviceId recibe solo las rutas que su scanner vio.
    // Sin accumulation por key, esto siempre funciono; el test
    // documenta que la fix de x00025 no lo rompe.
    const routes: ParsedRoute[] = [
      route("GET", "/health", "src/a.ts", "express"),
      route("POST", "/login", "src/b.ts", "nestjs"),
    ];
    const perScanner = [
      { serviceId: "apps_api", scannerSpecs: [spec("GET", "/health")] },
      { serviceId: "apps_web", scannerSpecs: [spec("POST", "/login")] },
    ];

    const out = accumulateRoutesByService(perScanner, routes);

    expect(out.get("apps_api")?.[0]?.sourceFile).toBe("src/a.ts");
    expect(out.get("apps_web")?.[0]?.sourceFile).toBe("src/b.ts");
  });

  it("scanner sin specs coincidentes no aporta rutas", () => {
    // Un scanner puede estar en `perScanner` pero no reconocer ninguna
    // ruta (todos los specs tienen method/uri que no existen en
    // `routes`). El serviceId aparece con array vacio, no se ignora.
    const routes: ParsedRoute[] = [route("GET", "/users", "src/users.ts")];
    const perScanner = [
      { serviceId: "apps_api", scannerSpecs: [spec("GET", "/users")] },
      { serviceId: "apps_api", scannerSpecs: [spec("GET", "/missing")] },
    ];

    const out = accumulateRoutesByService(perScanner, routes);

    expect(out.get("apps_api")).toHaveLength(1);
    expect(out.get("apps_api")?.[0]?.uri).toBe("/users");
  });
});
