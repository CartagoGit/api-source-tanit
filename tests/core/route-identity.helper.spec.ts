/**
 * The piece that was missing, and the four times its absence bit.
 *
 * "The URL identifies the operation" holds for REST and does not hold
 * for GraphQL or tRPC, where there is one endpoint and what
 * distinguishes one query from another is the name. Three places
 * answered that question with three different formulas, and all three
 * failed separately on the same example.
 */
import { describe, expect, test } from "vitest";

import { describeEndpoint, endpointKey, needsNameToDisambiguate } from "../../packages/core/helpers/route-identity.helper";

describe("endpointKey", () => {
  test("in REST, method and URI are enough", () => {
    expect(endpointKey({ method: "GET", uri: "/users" })).toBe(
      endpointKey({ method: "GET", uri: "/users" }),
    );
    expect(endpointKey({ method: "GET", uri: "/users" })).not.toBe(
      endpointKey({ method: "POST", uri: "/users" }),
    );
  });

  test("normalizes the URI, so `/api/x` and `api/x` are not two", () => {
    expect(endpointKey({ method: "GET", uri: "/users" })).toBe(
      endpointKey({ method: "GET", uri: "users" }),
    );
  });

  test("the method is not case-sensitive", () => {
    expect(endpointKey({ method: "get", uri: "/users" })).toBe(
      endpointKey({ method: "GET", uri: "/users" }),
    );
  });

  /**
   * THE case. Five GraphQL operations share `POST /graphql`, and
   * without the name all five collapse into one — exactly what was
   * happening in `dedupeSpecs`, in the invariants, and in `check`.
   */
  test("in RPC over POST, the name is the only thing that separates them", () => {
    const operaciones = [
      { method: "POST", uri: "/graphql", name: "query users" },
      { method: "POST", uri: "/graphql", name: "query orders" },
      { method: "POST", uri: "/graphql", name: "mutation createUser" },
      { method: "POST", uri: "/graphql", name: "mutation deleteUser" },
      { method: "POST", uri: "/graphql", name: "query health" },
    ];
    const claves = new Set(operaciones.map(endpointKey));
    expect(claves.size).toBe(5);
  });

  test("the body separates two variants of the same endpoint", () => {
    const a = endpointKey({ method: "POST", uri: "/users", body: '{"name":"x"}' });
    const b = endpointKey({ method: "POST", uri: "/users", body: '{"name":"y"}' });
    expect(a).not.toBe(b);
  });

  /**
   * An empty name cannot change the key: if it did, the same route seen
   * through two paths —one that fills `displayName` and one that does
   * not— would no longer match itself.
   */
  test("an empty name or body does not change the key", () => {
    const base = endpointKey({ method: "GET", uri: "/users" });
    expect(endpointKey({ method: "GET", uri: "/users", name: "" })).toBe(base);
    expect(endpointKey({ method: "GET", uri: "/users", body: "" })).toBe(base);
    expect(endpointKey({ method: "GET", uri: "/users", name: undefined })).toBe(base);
  });
});

describe("describeEndpoint", () => {
  test("in REST, method and URI are enough", () => {
    expect(describeEndpoint({ method: "GET", uri: "/users" })).toBe("GET /users");
  });

  /**
   * Three identical `POST /graphql` in a "missing these" list do not
   * say which one to look for. With the name, they do.
   */
  test("with a name, says which one it is", () => {
    expect(
      describeEndpoint({ method: "POST", uri: "/graphql", name: "query orders" }),
    ).toContain("(query orders)");
  });
});

describe("needsNameToDisambiguate", () => {
  test("a normal REST does not need it", () => {
    expect(
      needsNameToDisambiguate([
        { method: "GET", uri: "/users" },
        { method: "POST", uri: "/users" },
        { method: "GET", uri: "/orders" },
      ]),
    ).toBe(false);
  });

  test("several operations on the same endpoint, yes", () => {
    expect(
      needsNameToDisambiguate([
        { method: "POST", uri: "/graphql", name: "a" },
        { method: "POST", uri: "/graphql", name: "b" },
      ]),
    ).toBe(true);
  });

  /**
   * It asks about the shape of the routes, not about a list of
   * frameworks: a hand-written JSON-RPC works without anyone adding
   * anything, and supporting a new framework does not force touching
   * this.
   */
  test("does not depend on which framework it is", () => {
    expect(
      needsNameToDisambiguate([
        { method: "POST", uri: "/rpc", name: "sumar" },
        { method: "POST", uri: "/rpc", name: "restar" },
      ]),
    ).toBe(true);
  });

  test("an empty or single-element list needs nothing", () => {
    expect(needsNameToDisambiguate([])).toBe(false);
    expect(needsNameToDisambiguate([{ method: "GET", uri: "/x" }])).toBe(false);
  });
});
