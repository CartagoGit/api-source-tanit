/**
 * Tests for `filterSpecsForService` (x00028 S1).
 *
 * Six cases the proposal covers:
 *  1. Single-service path (`service.endpoints` empty) -> full catalog.
 *  2. Two services with disjoint routes -> each gets only its own.
 *  3. Two services with the same `(method, uri)` (e.g. `apps/users`
 *     and `apps/orders` both `GET /health`) -> both descriptors see
 *     the spec; the merger is responsible for not double-emitting
 *     (this helper does not deduplicate).
 *  4. Empty endpoints but non-empty `discovery.specs` -> full
 *     catalog returned (legacy path).
 *  5. Order preserved (callers rely on it for folder grouping).
 *  6. Specs with `name` / `body` overrides survive filtering.
 *
 * The helper is pure. No disk, no bootstrap.
 */
import { describe, expect, it } from "vitest";

import { filterSpecsForService } from "../../packages/core/discovery/filter-specs-for-service.helper.js";
import type { EndpointSpec } from "../../packages/contracts/interfaces/core/postman.interface.js";
import type { IServiceDescriptor } from "../../packages/contracts/interfaces/core/service-graph.interface.js";
import type { ParsedRoute } from "../../packages/contracts/interfaces/core/scanner.interface.js";
import type { IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface.js";

function spec(
  method: EndpointSpec["method"],
  uri: string,
  extras: Partial<EndpointSpec> = {},
): EndpointSpec {
  return { method, uri, name: `${method} ${uri}`, ...extras };
}

function route(method: string, uri: string, sourceFile = "src/routes.ts"): ParsedRoute {
  return {
    framework: "express",
    method,
    uri,
    rawUri: uri,
    sourceFile,
    lineNumber: 1,
    prefixChain: [],
  };
}

const dummyMatch: IProjectMatch = {
  framework: "express",
  projectRoot: "/project",
  artifacts: [],
};

function service(
  serviceId: string,
  endpoints: ReadonlyArray<ParsedRoute>,
): IServiceDescriptor {
  return {
    serviceId,
    match: dummyMatch,
    // x00031 S1: los tests fabrican servicios sintéticos con un solo
    // framework y sin secondary matches.
    additionalMatches: [],
    frameworks: [dummyMatch.framework],
    endpoints,
    baseUrl: null,
    auth: undefined,
    variables: [],
  };
}

describe("filterSpecsForService (x00028)", () => {
  it("single-service: full catalog returned (legacy path)", () => {
    const catalog: EndpointSpec[] = [
      spec("GET", "/users"),
      spec("POST", "/orders"),
      spec("GET", "/health"),
    ];
    const svc = service("default", []);

    const out = filterSpecsForService(catalog, svc);

    expect(out).toEqual(catalog);
    expect(out).toHaveLength(3);
  });

  it("two services disjoint: each gets only its own specs", () => {
    const catalog: EndpointSpec[] = [
      spec("GET", "/users", { name: "List users" }),
      spec("POST", "/orders"),
      spec("GET", "/health"),
    ];
    const users = service("apps_users", [route("GET", "/users"), route("GET", "/health")]);
    const orders = service("apps_orders", [route("POST", "/orders")]);

    const usersOut = filterSpecsForService(catalog, users);
    const ordersOut = filterSpecsForService(catalog, orders);

    expect(usersOut).toHaveLength(2);
    expect(usersOut.map((s) => s.uri).sort()).toEqual(["/health", "/users"]);

    expect(ordersOut).toHaveLength(1);
    expect(ordersOut[0]?.uri).toBe("/orders");
  });

  it("two services with same (method, uri): each gets the spec (merger deduplicates later)", () => {
    // The bug x00028 was opened for: `apps/users` and `apps/orders`
    // both expose `GET /health` from their own scanner. Before the
    // fix, the catalog had ONE spec for `GET /health` (the merger
    // deduped by `(method, uri)` globally) and `buildForService`
    // returned it to BOTH services. After the fix, both descriptors
    // see the spec — the caller's job is to attribute correctly via
    // the descriptor's `endpoints`.
    //
    // Note: this helper does NOT deduplicate, because deduplication
    // belongs to the merger. What this helper guarantees is that
    // `service.endpoints` is the authoritative source of "what
    // belongs to this service", so the caller can pick the right
    // shape per service without re-deriving attribution.
    const catalog: EndpointSpec[] = [spec("GET", "/health")];
    const users = service("apps_users", [route("GET", "/health", "apps/users/src/health.ts")]);
    const orders = service("apps_orders", [route("GET", "/health", "apps/orders/src/health.ts")]);

    const usersOut = filterSpecsForService(catalog, users);
    const ordersOut = filterSpecsForService(catalog, orders);

    expect(usersOut).toHaveLength(1);
    expect(ordersOut).toHaveLength(1);
    expect(usersOut[0]?.uri).toBe("/health");
    expect(ordersOut[0]?.uri).toBe("/health");
  });

  it("service.endpoints vacio pero discovery.specs no vacio: full catalog returned", () => {
    // Defensive case: a misconfigured caller passes an empty
    // `endpoints` array but the catalog has content. We return the
    // catalog unchanged — better than returning nothing (which would
    // produce an empty collection and look like a real bug).
    const catalog: EndpointSpec[] = [spec("GET", "/x"), spec("POST", "/y")];
    const svc = service("default", []);

    const out = filterSpecsForService(catalog, svc);

    expect(out).toHaveLength(2);
  });

  it("order preserved", () => {
    // The collection folder grouping (topGroupFor) relies on spec
    // order. If we ever sort the filtered output, the user-visible
    // folder structure changes. Document the order preservation.
    const catalog: EndpointSpec[] = [
      spec("GET", "/z"),
      spec("GET", "/a"),
      spec("GET", "/m"),
    ];
    const svc = service("svc", [
      route("GET", "/z"),
      route("GET", "/a"),
      route("GET", "/m"),
    ]);

    const out = filterSpecsForService(catalog, svc);

    expect(out.map((s) => s.uri)).toEqual(["/z", "/a", "/m"]);
  });

  it("parameterized routes survive: route `:id` (raw) matches spec `{{id}}` (Postman)", () => {
    // Regression caught the same day x00028 shipped: the identity set
    // was built from the RAW uri strings, but `ParsedRoute.uri` and
    // `EndpointSpec.uri` travel in different formats — the scanner
    // emits the framework syntax (`/users/:id`) and the adapter
    // converts to Postman form (`/users/{{id}}`). Comparing raw
    // strings dropped every parameterized route from the filtered
    // catalog: the express example lost `GET/PUT/DELETE /users/:id`
    // and the CLI aborted with "3 in the routes but NOT in the
    // collection". The identity must be normalized on BOTH sides
    // (`:id`, `{id}` and `{{id}}` all collapse to `:p`).
    const catalog: EndpointSpec[] = [
      spec("GET", "/api/users"),
      spec("GET", "/api/users/{{id}}"),
      spec("PUT", "/api/users/{{id}}"),
      spec("DELETE", "/api/users/{{id}}"),
    ];
    const svc = service("default", [
      route("GET", "/api/users"),
      route("GET", "/api/users/:id"),
      route("PUT", "/api/users/:id"),
      route("DELETE", "/api/users/:id"),
    ]);

    const out = filterSpecsForService(catalog, svc);

    expect(out).toHaveLength(4);
    expect(out.map((s) => s.uri)).toEqual([
      "/api/users",
      "/api/users/{{id}}",
      "/api/users/{{id}}",
      "/api/users/{{id}}",
    ]);
  });

  it("specs with name/body overrides survive filtering (no accidental strip)", () => {
    // The filter is on `(method, uri)` only. Specs that came back
    // from the merger with `name`, `body`, `fields` or `auth`
    // overrides must survive untouched — the caller needs the full
    // shape for `buildCollection()`.
    const catalog: EndpointSpec[] = [
      spec("POST", "/login", {
        name: "User login",
        body: { username: "string", password: "string" },
        fields: [{ fieldName: "username", location: "body", type: "string", required: false }],
      }),
    ];
    const svc = service("apps_auth", [route("POST", "/login")]);

    const out = filterSpecsForService(catalog, svc);

    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("User login");
    expect(out[0]?.body).toEqual({ username: "string", password: "string" });
    expect(out[0]?.fields).toEqual([
      { fieldName: "username", location: "body", type: "string", required: false },
    ]);
  });

  it("specs whose (method, uri) is not in service.endpoints are dropped", () => {
    // Negative case: a spec that does NOT match any route in the
    // service's `endpoints` must be filtered out. Otherwise the
    // helper would silently include orphan specs (e.g. a leftover
    // from a scanner that the merger should have deduplicated).
    const catalog: EndpointSpec[] = [
      spec("GET", "/real"),
      spec("GET", "/orphan"),
    ];
    const svc = service("svc", [route("GET", "/real")]);

    const out = filterSpecsForService(catalog, svc);

    expect(out).toHaveLength(1);
    expect(out[0]?.uri).toBe("/real");
  });

  it("x00028 S3: when two services share (method, uri), the spec's serviceId wins (one per service, no crossing)", () => {
    // Production scenario (post-fix): the merger stamps every spec
    // with `serviceId` via `deriveServiceId(match)`. Two workspaces
    // emitting `GET /health` end up with TWO specs in the catalog,
    // each tagged with its own `serviceId`. The filter MUST route
    // each spec to its own service descriptor; otherwise the
    // multi-service isolation that x00028 is built on collapses.
    const catalog: EndpointSpec[] = [
      spec("GET", "/users", { serviceId: "apps_users" }),
      spec("GET", "/health", { serviceId: "apps_users" }),
      spec("GET", "/health", { serviceId: "apps_orders" }),
      spec("GET", "/orders", { serviceId: "apps_orders" }),
    ];
    const users = service("apps_users", [
      route("GET", "/users"),
      route("GET", "/health"),
    ]);
    const orders = service("apps_orders", [
      route("GET", "/orders"),
      route("GET", "/health"),
    ]);

    const usersOut = filterSpecsForService(catalog, users);
    const ordersOut = filterSpecsForService(catalog, orders);

    expect(usersOut).toHaveLength(2);
    expect(usersOut.every((s) => s.serviceId === "apps_users")).toBe(true);
    expect(ordersOut).toHaveLength(2);
    expect(ordersOut.every((s) => s.serviceId === "apps_orders")).toBe(true);
  });

  it("x00028 S3: a spec without serviceId is still routed by (method, uri) — handles un-stamped callers", () => {
    // Belt-and-braces contract: when the descriptor HAS a serviceId
    // but the catalog spec DOES NOT (e.g. legacy data, a hand-crafted
    // test fixture, or an adapter that hasn't been migrated), the
    // (method, uri) match still wins. Treating the missing field as
    // `""` keeps the legacy single-workspace behaviour without
    // silently including orphan specs that happen to share
    // (method, uri) with this service.
    const catalog: EndpointSpec[] = [
      spec("GET", "/health"), // no serviceId — legacy shape
      spec("GET", "/only-orders", { serviceId: "apps_orders" }),
    ];
    const users = service("apps_users", [route("GET", "/health")]);

    const out = filterSpecsForService(catalog, users);

    expect(out).toHaveLength(1);
    expect(out[0]?.uri).toBe("/health");
  });

  // x00039 S2: en flat-hybrid el descriptor tiene
  // `additionalMatches.length > 0` y su `serviceId` es
  // `normalizeServiceId(projectRoot)`, mientras los specs conservan
  // su `serviceId` derivado por framework. Una comprobación
  // estricta `spec.serviceId === service.serviceId` rechazaría
  // CADA spec. La solución correcta: en flat-hybrid la igualdad de
  // `(method, uri)` ya basta porque solo hay un projectRoot.
  it("x00039: flat-hybrid ignores spec.serviceId vs service.serviceId mismatch", () => {
    const hybrid: IServiceDescriptor = {
      serviceId: "repo",
      match: { framework: "express", projectRoot: "/repo", artifacts: [] },
      additionalMatches: [
        { framework: "graphql", projectRoot: "/repo", artifacts: [] },
      ],
      frameworks: ["express", "graphql"],
      endpoints: [
        route("GET", "/users"),
        route("POST", "/graphql"),
      ],
      baseUrl: null,
      auth: undefined,
      variables: [],
    };
    const catalog: EndpointSpec[] = [
      // Cada spec conserva su serviceId derivado por framework.
      // El descriptor los acepta aunque los serviceIds no coincidan.
      spec("GET", "/users", { serviceId: "express_repo" }),
      spec("POST", "/graphql", { serviceId: "graphql_repo" }),
      // Spec ajeno al híbrido: NO debe entrar.
      spec("GET", "/other", { serviceId: "fastify_other" }),
    ];

    const out = filterSpecsForService(catalog, hybrid);

    expect(out).toHaveLength(2);
    expect(out.map((s) => s.uri).sort()).toEqual(["/graphql", "/users"]);
  });

  // x00039 S2: en flat-hybrid los specs SIN serviceId también
  // pasan (compatibilidad con callers que aún no estampean), igual
  // que en el camino legacy.
  it("x00039: flat-hybrid accepts specs without serviceId (legacy compat)", () => {
    const hybrid: IServiceDescriptor = {
      serviceId: "repo",
      match: { framework: "express", projectRoot: "/repo", artifacts: [] },
      additionalMatches: [{ framework: "graphql", projectRoot: "/repo", artifacts: [] }],
      frameworks: ["express", "graphql"],
      endpoints: [route("GET", "/users")],
      baseUrl: null,
      auth: undefined,
      variables: [],
    };
    const catalog: EndpointSpec[] = [spec("GET", "/users")];

    const out = filterSpecsForService(catalog, hybrid);

    expect(out).toHaveLength(1);
  });

  // x00039 S2: en flat-hybrid, si dos specs comparten
  // `(method, uri)` desde dos frameworks, ambos pasan (no hay
  // discriminación por serviceId). El merger es el responsable de
  // deduplicar si llega el caso.
  it("x00039: flat-hybrid keeps specs that share (method, uri) from different frameworks", () => {
    const hybrid: IServiceDescriptor = {
      serviceId: "repo",
      match: { framework: "express", projectRoot: "/repo", artifacts: [] },
      additionalMatches: [{ framework: "graphql", projectRoot: "/repo", artifacts: [] }],
      frameworks: ["express", "graphql"],
      endpoints: [route("GET", "/health")],
      baseUrl: null,
      auth: undefined,
      variables: [],
    };
    const catalog: EndpointSpec[] = [
      spec("GET", "/health", { serviceId: "express_repo" }),
      spec("GET", "/health", { serviceId: "graphql_repo" }),
    ];

    const out = filterSpecsForService(catalog, hybrid);

    expect(out).toHaveLength(2);
  });
});
