/**
 * GraphQL y tRPC: dos protocolos sin rutas visibles.
 *
 * Los dos comparten el problema que los hace interesantes — el cliente
 * no escribe URLs, así que nadie sabe de memoria a qué se está llamando
 * — y los dos tienen una traducción a HTTP **exacta**, que es lo que
 * permite generar una colección que funciona al primer Send.
 *
 * Lo que se comprueba aquí es esa traducción, y las dos cosas que se
 * dejan fuera a propósito: las suscripciones de los dos, que van por
 * WebSocket y fallarían.
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

describe("GraphQL: leer el esquema", () => {
  test("saca las queries con sus argumentos", () => {
    const ops = parseOperations(SCHEMA, "query");
    expect(ops.map((o) => o.name)).toEqual(["users", "user"]);
    expect(ops[0]?.args).toEqual([
      { name: "page", type: "Int" },
      { name: "search", type: "String" },
    ]);
  });

  test("saca las mutaciones aparte", () => {
    expect(parseOperations(SCHEMA, "mutation").map((o) => o.name)).toEqual(["createUser"]);
  });

  // Una descripción `"""…"""` puede contener cualquier cosa, incluido
  // algo que parezca otro tipo.
  test("las descripciones y los comentarios no cuentan", () => {
    const clean = stripGraphQlComments(SCHEMA);
    expect(clean).not.toContain("falsa");
    expect(clean).not.toContain("un comentario");
  });

  test("un esquema sin Query no revienta", () => {
    expect(parseOperations("type User { id: ID! }", "query")).toEqual([]);
  });
});

describe("GraphQL: la consulta que se manda", () => {
  const [users] = parseOperations(SCHEMA, "query");

  /**
   * Los argumentos van como **variables** y no incrustados en el texto:
   * es lo que deja cambiarlos desde el panel de Postman sin editar la
   * consulta, y lo que evita que un `String!` acabe sin comillas.
   */
  test("los argumentos van como variables declaradas", () => {
    const doc = buildQueryDocument(users!);
    expect(doc).toContain("$page: Int");
    expect(doc).toContain("$search: String");
    expect(doc).toContain("users(page: $page, search: $search)");
  });

  // Sin conocer el tipo de retorno no se puede pedir su selección de
  // campos, y una consulta sin selección no es válida. `__typename`
  // siempre existe.
  test("un tipo de objeto recibe una selección válida", () => {
    expect(buildQueryDocument(users!)).toContain("__typename");
  });

  test("un escalar no lleva selección", () => {
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

describe("GraphQL: el proyecto de ejemplo", () => {
  test("cada operación es una request, no una sola", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    expect(result.match?.framework).toBe("graphql");
    // 3 queries + 2 mutations. Todas comparten `POST /graphql`, así que
    // deduplicar por método y URI dejaría UNA.
    expect(result.specs).toHaveLength(5);
  });

  test("todas van por POST al mismo endpoint", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    expect(result.specs.every((s) => s.method === "POST")).toBe(true);
    expect(result.specs.every((s) => s.uri === "/graphql")).toBe(true);
  });

  test("cada una lleva su consulta en el body", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    for (const spec of result.specs) {
      const body = spec.body as { query?: string };
      expect(body.query, spec.name).toContain("{");
    }
  });

  // Una `subscription` va por WebSocket: una petición HTTP a `/graphql`
  // con una dentro contesta un error del servidor.
  test("las suscripciones se quedan fuera", async () => {
    const result = await generateWithAllFrameworks(exampleDir("graphql"));
    expect(result.specs.some((s) => s.name.includes("orderPlaced"))).toBe(false);
  });

  test("queries y mutaciones se separan en carpetas", async () => {
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

describe("tRPC: leer el router", () => {
  test("encuentra los routers declarados con nombre", () => {
    expect([...findNamedRouters(ROUTER_SOURCE).keys()]).toEqual([
      "usersRouter",
      "ordersRouter",
      "appRouter",
    ]);
  });

  /**
   * Una raíz no es "el router sin nombre" — `appRouter` también tiene
   * uno. Es el que **nadie referencia**.
   */
  test("distingue las ramas de la raíz por quién las referencia", () => {
    const named = findNamedRouters(ROUTER_SOURCE);
    const referenced = referencedRouterNames(ROUTER_SOURCE, named);
    expect(referenced).toEqual(new Set(["usersRouter", "ordersRouter"]));
    expect(referenced.has("appRouter")).toBe(false);
  });

  test("los procedimientos llevan el prefijo de su router", () => {
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

  // Sin resolver la referencia, el `list` de un router pisa al del otro:
  // desde fuera parecen el mismo.
  test("dos `list` en routers distintos no colisionan", () => {
    const named = findNamedRouters(ROUTER_SOURCE);
    const procs = parseRouterObject(ROUTER_SOURCE, named.get("appRouter")!, "", named);
    expect(procs.filter((p) => p.path.endsWith(".list"))).toHaveLength(2);
  });
});

describe("tRPC: el proyecto de ejemplo", () => {
  test("query → GET y mutation → POST, que es la regla de tRPC sobre HTTP", async () => {
    const result = await generateWithAllFrameworks(exampleDir("trpc"));
    expect(result.match?.framework).toBe("trpc");
    const byUri = new Map(result.specs.map((s) => [s.uri, s.method]));
    expect(byUri.get("/trpc/users.list")).toBe("GET");
    expect(byUri.get("/trpc/users.create")).toBe("POST");
    expect(byUri.get("/trpc/orders.place")).toBe("POST");
  });

  test("los procedimientos anidados conservan su ruta completa", async () => {
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

  test("las suscripciones se quedan fuera, igual que en GraphQL", async () => {
    const result = await generateWithAllFrameworks(exampleDir("trpc"));
    expect(result.specs.some((s) => s.uri.includes("onOrder"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// f00011 S4 — lockfiles como bonus de scoring en detect().
// ---------------------------------------------------------------------------

describe("tRPC — lockfiles como bonus de runtime (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` y `bun.lockb` afinan la confianza
  // del detector sin ser detección. Pesos pequeños: +0.1 (pnpm),
  // +0.15 (bun). El detector de tRPC suele estar casi al tope
  // (0.95 por la dependencia); el bonus aparece en `evidence`
  // aunque el score visible apenas cambie — exactamente lo que se
  // busca con esta propuesta: trazabilidad, no detección.
  test("pnpm-lock.yaml añade evidencia con peso 0.1", async () => {
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

  test("bun.lockb añade evidencia con peso 0.15", async () => {
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

  test("pnpm-lock.yaml + bun.lockb suman ambas señales", async () => {
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

  test("sin lockfiles no aparece ninguna señal de lockfile", async () => {
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

describe("GraphQL — lockfiles como bonus de runtime (f00011 S4)", () => {
  // f00011 S4: `pnpm-lock.yaml` y `bun.lockb` afinan la confianza
  // del detector sin ser detección. Pesos pequeños: +0.1 (pnpm),
  // +0.15 (bun). El detector de GraphQL suma evidencia en todas
  // sus ramas positivas (package.json, esquema, o ambas); el lockfile
  // se añade en `signals` antes de cualquier `return`, así que
  // aparece en `evidence` para todas las variantes.
  test("pnpm-lock.yaml añade evidencia con peso 0.1", async () => {
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

  test("bun.lockb añade evidencia con peso 0.15", async () => {
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

  test("pnpm-lock.yaml + bun.lockb suman ambas señales", async () => {
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

  test("sin lockfiles no aparece ninguna señal de lockfile", async () => {
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
