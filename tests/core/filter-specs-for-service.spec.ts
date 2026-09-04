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

function spec(method: "GET" | "POST", uri: string, extras: Partial<EndpointSpec> = {}): EndpointSpec {
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
});
