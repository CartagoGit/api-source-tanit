/**
 * GraphQL and tRPC: two protocols with no visible routes.
 *
 * Both share the problem that makes them interesting — the client
 * does not write URLs, so nobody knows by heart what is being
 * called — and both have an **exact** HTTP translation, which is
 * what makes it possible to generate a collection that works on the
 * first Send.
 *
 * What is checked here is that translation, and the two things that
 * are deliberately left out: the subscriptions of both, which go
 * over WebSocket and would fail.
 */
import { describe, expect, test } from "vitest";

import {
  buildQueryDocument,
  parseOperations,
  stripGraphQlComments,
} from "../../packages/frameworks/scanners/graphql.scanner";
import { findNamedRouters, parseRouterObject, referencedRouterNames } from "../../packages/frameworks/scanners/trpc.scanner";
import { generateWithAllFrameworks } from "../../packages/frameworks/index";
import { createTempProject } from "../helpers/scanner-fixture";
import { exampleDir } from "../../scripts/helpers/root.helper";

const SCHEMA = `
"""Descripción que menciona type Query { falsa }."""
type Query {
  # un comentario
  users(page: Int, search: String): [User!]!
  user(id: ID!): User
}
type Mutation {
  createUser(name: String!, email: String!): User!
}
type Subscription {
  orderPlaced: Order!
}
`;

describe("GraphQL: reading the schema", () => {
  test("extracts the queries with their arguments", () => {
    const ops = parseOperations(SCHEMA, "query");
    expect(ops.map((o) => o.name)).toEqual(["users", "user"]);
    expect(ops[0]?.args).toEqual([
      { name: "page", type: "Int" },
      { name: "search", type: "String" },
    ]);
  });

  test("extracts the mutations separately", () => {
    expect(parseOperations(SCHEMA, "mutation").map((o) => o.name)).toEqual(["createUser"]);
  });

  // A description `"""…"""` can contain anything, including
  // something that looks like another type.
  test("descriptions and comments do not count", () => {
    const clean = stripGraphQlComments(SCHEMA);
    expect(clean).not.toContain("falsa");
    expect(clean).not.toContain("un comentario");
  });

  test("a schema without Query does not blow up", () => {
    expect(parseOperations("type User { id: ID! }", "query")).toEqual([]);
  });
});

describe("GraphQL: the query that is sent", () => {
  const [users] = parseOperations(SCHEMA, "query");

  /**
   * Arguments go as **variables**, not embedded in the text: that
   * lets you change them from the Postman panel without editing the
   * query, and it keeps a `String!` from ending up unquoted.
   */
  test("arguments go as declared variables", () => {
    const doc = buildQueryDocument(users!);
    expect(doc).toContain("$page: Int");
    expect(doc).toContain("$search: String");
    expect(doc).toContain("users(page: $page, search: $search)");
  });

  // Without knowing the return type you cannot ask for its field
  // selection, and a query with no selection is invalid. `__typename`
  // always exists.
  test("an object type receives a valid selection", () => {
    expect(buildQueryDocument(users!)).toContain("__typename");
  });

  test("a scalar carries no selection", () => {
    const doc = buildQueryDocument({
      kind: "query",
      name: "ping",
      args: [],
      returns: "String!",
    });
    expect(doc).not.toContain("__typename");
    expect(doc).toContain("query ping");
  });
});

describe("GraphQL: the example project", () => {
  test("each operation is one request, not a single one", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    expect(result.match?.framework).toBe("graphql");
    // 3 queries + 2 mutations. They all share `POST /graphql`, so
    // deduplicating by method and URI would leave just ONE.
    expect(result.specs).toHaveLength(5);
  });

  test("all of them go via POST to the same endpoint", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    expect(result.specs.every((s) => s.method === "POST")).toBe(true);
    expect(result.specs.every((s) => s.uri === "/graphql")).toBe(true);
  });

  test("each one carries its query in the body", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    for (const spec of result.specs) {
      const body = spec.body as { query?: string };
      expect(body.query, spec.name).toContain("{");
    }
  });

  // A `subscription` goes over WebSocket: an HTTP request to
  // `/graphql` with one inside would get a server error.
  test("subscriptions are left out", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    expect(result.specs.some((s) => s.name.includes("orderPlaced"))).toBe(false);
  });

  test("queries and mutations are separated into folders", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    const folders = new Set(result.specs.map((s) => s.folder));
    expect(folders).toEqual(new Set(["Queries", "Mutations"]));
  });
});

const ROUTER_SOURCE = `
const usersRouter = t.router({
  list: t.procedure.query(() => []),
  create: t.procedure.mutation(() => ({})),
});
const ordersRouter = t.router({
  list: t.procedure.query(() => []),
});
export const appRouter = t.router({
  health: t.procedure.query(() => "ok"),
  users: usersRouter,
  orders: ordersRouter,
});
`;

describe("tRPC: reading the router", () => {
  test("finds the routers declared with a name", () => {
    expect([...findNamedRouters(ROUTER_SOURCE).keys()]).toEqual([
      "usersRouter",
      "ordersRouter",
      "appRouter",
    ]);
  });

  /**
   * A root is not "the router without a name" — `appRouter` has one
   * too. It is the one **nobody references**.
   */
  test("distinguishes the root's branches by who references them", () => {
    const named = findNamedRouters(ROUTER_SOURCE);
    const referenced = referencedRouterNames(ROUTER_SOURCE, named);
    expect(referenced).toEqual(new Set(["usersRouter", "ordersRouter"]));
    expect(referenced.has("appRouter")).toBe(false);
  });

  test("procedures carry their router's prefix", () => {
    const named = findNamedRouters(ROUTER_SOURCE);
    const procs = parseRouterObject(
      ROUTER_SOURCE,
      named.get("appRouter")!,
      "",
      named,
    );
    expect(procs.map((p) => p.path).sort()).toEqual([
      "health",
      "orders.list",
      "users.create",
      "users.list",
    ]);
  });

  // Without resolving the reference, the `list` of one router would
  // clash with the other's: from the outside they look the same.
  test("two `list` in different routers do not collide", () => {
    const named = findNamedRouters(ROUTER_SOURCE);
    const procs = parseRouterObject(ROUTER_SOURCE, named.get("appRouter")!, "", named);
    expect(procs.filter((p) => p.path.endsWith(".list"))).toHaveLength(2);
  });
});

describe("tRPC: the example project", () => {
  test("query → GET and mutation → POST, which is the tRPC rule over HTTP", async () => {
    const result = await generateWithAllFrameworks(exampleDir("trpc"));
    expect(result.match?.framework).toBe("trpc");
    const byUri = new Map(result.specs.map((s) => [s.uri, s.method]));
    expect(byUri.get("/trpc/users.list")).toBe("GET");
    expect(byUri.get("/trpc/users.create")).toBe("POST");
    expect(byUri.get("/trpc/orders.place")).toBe("POST");
  });

  test("nested procedures preserve their full path", async () => {
    const result = await generateWithAllFrameworks(exampleDir("trpc"));
    const uris = result.specs.map((s) => s.uri).sort();
    expect(uris).toEqual([
      "/trpc/health",
      "/trpc/orders.list",
      "/trpc/orders.place",
      "/trpc/users.byId",
      "/trpc/users.create",
      "/trpc/users.list",
    ]);
  });

  test("subscriptions are left out, same as in GraphQL", async () => {
    const result = await generateWithAllFrameworks(exampleDir("trpc"));
    expect(result.specs.some((s) => s.uri.includes("onOrder"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// f00011 S4 — lockfiles as scoring bonuses in detect().
// ---------------------------------------------------------------------------

describe("tRPC — lockfiles as runtime bonuses (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` and `bun.lockb` sharpen the
  // detector's confidence without being detection. Small weights:
  // +0.1 (pnpm), +0.15 (bun). The tRPC detector usually sits near
  // the cap (0.95 from the dependency); the bonus shows up in
  // `evidence` even though the visible score barely changes —
  // exactly what this proposal aims for: traceability, not detection.
  test("pnpm-lock.yaml adds evidence with weight 0.1", async () => {
    const { TrpcProjectScanner } = await import(
      "../../packages/frameworks/scanners/trpc.scanner"
    );
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { "@trpc/server": "^10.0.0" } }),
      "pnpm-lock.yaml": "",
    });
    try {
      const result = await new TrpcProjectScanner().detect(project.root);
      const pnpm = result.evidence.find((e) => e.artifact === "pnpm-lock.yaml");
      expect(pnpm).toBeDefined();
      expect(pnpm?.weight).toBe(0.1);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb adds evidence with weight 0.15", async () => {
    const { TrpcProjectScanner } = await import(
      "../../packages/frameworks/scanners/trpc.scanner"
    );
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { "@trpc/server": "^10.0.0" } }),
      "bun.lockb": "",
    });
    try {
      const result = await new TrpcProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lockb");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb adds evidence with weight 0.15", async () => {
    const { TrpcProjectScanner } = await import(
      "../../packages/frameworks/scanners/trpc.scanner"
    );
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { "@trpc/server": "^10.0.0" } }),
      "pnpm-lock.yaml": "",
      "bun.lockb": "",
    });
    try {
      const result = await new TrpcProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("without lockfiles no lockfile signal appears", async () => {
    const { TrpcProjectScanner } = await import(
      "../../packages/frameworks/scanners/trpc.scanner"
    );
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { "@trpc/server": "^10.0.0" } }),
    });
    try {
      const result = await new TrpcProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(false);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});

describe("GraphQL — lockfiles as runtime bonuses (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` and `bun.lockb` sharpen the
  // detector's confidence without being detection. Small weights:
  // +0.1 (pnpm), +0.15 (bun). The GraphQL detector sums evidence
  // across all positive branches (package.json, schema, or both);
  // the lockfile is added to `signals` before any `return`, so it
  // appears in `evidence` for every variant.
  test("pnpm-lock.yaml adds evidence with weight 0.1", async () => {
    const { GraphQlProjectScanner } = await import(
      "../../packages/frameworks/scanners/graphql.scanner"
    );
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { graphql: "^16.0.0" } }),
      "pnpm-lock.yaml": "",
    });
    try {
      const result = await new GraphQlProjectScanner().detect(project.root);
      const pnpm = result.evidence.find((e) => e.artifact === "pnpm-lock.yaml");
      expect(pnpm).toBeDefined();
      expect(pnpm?.weight).toBe(0.1);
    } finally {
      await project.cleanup();
    }
  });

  test("bun.lockb adds evidence with weight 0.15", async () => {
    const { GraphQlProjectScanner } = await import(
      "../../packages/frameworks/scanners/graphql.scanner"
    );
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { graphql: "^16.0.0" } }),
      "bun.lockb": "",
    });
    try {
      const result = await new GraphQlProjectScanner().detect(project.root);
      const bun = result.evidence.find((e) => e.artifact === "bun.lockb");
      expect(bun).toBeDefined();
      expect(bun?.weight).toBe(0.15);
    } finally {
      await project.cleanup();
    }
  });

  test("pnpm-lock.yaml + bun.lockb add both signals", async () => {
    const { GraphQlProjectScanner } = await import(
      "../../packages/frameworks/scanners/graphql.scanner"
    );
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { graphql: "^16.0.0" } }),
      "pnpm-lock.yaml": "",
      "bun.lockb": "",
    });
    try {
      const result = await new GraphQlProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(true);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(true);
    } finally {
      await project.cleanup();
    }
  });

  test("pnpm-lock.yaml + bun.lockb add both signals", async () => {
    const { GraphQlProjectScanner } = await import(
      "../../packages/frameworks/scanners/graphql.scanner"
    );
    const project = await createTempProject({
      "package.json": JSON.stringify({ dependencies: { graphql: "^16.0.0" } }),
    });
    try {
      const result = await new GraphQlProjectScanner().detect(project.root);
      expect(result.evidence.some((e) => e.artifact === "pnpm-lock.yaml")).toBe(false);
      expect(result.evidence.some((e) => e.artifact === "bun.lockb")).toBe(false);
    } finally {
      await project.cleanup();
    }
  });
});
