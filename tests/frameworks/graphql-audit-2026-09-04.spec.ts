/**
 * Tests para los fixes del audit 2026-09-04 en el scanner GraphQL.
 *
 * Cubre:
 *   - P1 #3: dedupe entre Query.user y Mutation.user con el mismo
 *     nombre (antes se perdía uno).
 *   - P1 #4: escalares personalizados no se tratan como objetos.
 *   - P1 #5: SDL embebido en `gql\`...\`` se extrae de TS/JS.
 *   - 2ª revisión: los custom scalars viven dentro de `scan()` y
 *     dos scans consecutivos (incluido `Promise.all`) NO contaminan
 *     el resultado del segundo.
 */
import { afterEach, describe, expect, test } from "vitest";

import {
  buildQueryDocument,
  collectCustomScalars,
  extractEmbeddedSdl,
  parseOperations,
  GraphQlRouteScanner,
} from "../../packages/frameworks/scanners/graphql.scanner";
import {
  createTempProject,
  type ITempProject,
} from "../helpers/scanner-fixture";
import type { IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface";

const projects: ITempProject[] = [];

afterEach(async () => {
  for (const p of projects.splice(0)) await p.cleanup();
});

describe("graphql scanner — audit 2026-09-04 fixes", () => {
  test("P1 #3: dedupe entre Query.user y Mutation.user con mismo nombre", async () => {
    const project = await createTempProject(
      {
        "schema.graphql": `type Query { user: User }
type Mutation { user(input: UserInput!): User }
type User { id: ID!; name: String! }
input UserInput { id: ID!; name: String! }
`,
        "package.json": JSON.stringify({
          dependencies: { graphql: "^16.0.0" },
        }),
      },
      "graphql-dedupe-",
    );
    projects.push(project);

    const match: IProjectMatch = {
      framework: "graphql",
      projectRoot: project.root,
      artifacts: ["schema.graphql"],
    };
    const routes = (await new GraphQlRouteScanner().scan(match)).routes;
    const names = routes.map((r) => r.displayName).sort();
    expect(names).toEqual(["mutation user", "query user"]);
  });

  test("P1 #4: escalares personalizados no generan selección de campos", () => {
    const sdl = `scalar DateTime
scalar UUID

type Query {
  now: DateTime!
  byId(id: UUID!): User
}
type User { id: ID! }
`;
    // Pasada 1: recogemos escalares del SDL completo (no solo del
    // bloque Query). Ahora `collectCustomScalars` es pura: cada
    // llamada devuelve un Set NUEVO.
    const customScalars = collectCustomScalars(sdl);
    expect(customScalars.has("DateTime")).toBe(true);
    expect(customScalars.has("UUID")).toBe(true);
    expect(customScalars.has("ID")).toBe(false); // builtin

    // Pasada 2: extraemos operaciones con el Set como referencia.
    const ops = parseOperations(sdl, "query");
    expect(ops).toHaveLength(2);

    const now = ops.find((o) => o.name === "now");
    expect(now).toBeDefined();
    if (now) {
      const doc = buildQueryDocument(now, customScalars);
      // Si el bug persiste, pediría `now { __typename }` sobre un
      // escalar — query inválida.
      expect(doc).not.toContain("__typename");
    }

    const byId = ops.find((o) => o.name === "byId");
    expect(byId).toBeDefined();
    if (byId) {
      const doc = buildQueryDocument(byId, customScalars);
      // `byId` devuelve un objeto (User) → debe llevar `__typename`.
      expect(doc).toContain("__typename");
    }
  });

  test("2ª revisión #13: 'scalar X @specifiedBy(...)' también se reconoce", () => {
    const sdl = `scalar DateTime @specifiedBy(url: "https://...")
type Query { now: DateTime! }
`;
    const customScalars = collectCustomScalars(sdl);
    expect(customScalars.has("DateTime")).toBe(true);
  });

  test("2ª revisión #12: escalar declarado en fichero aparte también se ve", async () => {
    // Si los escalares están en un fichero distinto al de las
    // operaciones, el scan debe hacer una pasada previa que los
    // recoja todos antes de generar las queries. Antes esto fallaba
    // porque parseOperations aislado no veía el `scalar X` externo.
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          dependencies: { graphql: "^16.0.0" },
        }),
        "99-scalars.graphql": `scalar DateTime
scalar UUID
`,
        "00-query.graphql": `type Query {
  now: DateTime!
  byId(id: UUID!): User
}
type User { id: ID! }
`,
      },
      "graphql-scalars-cross-file-",
    );
    projects.push(project);

    const match: IProjectMatch = {
      framework: "graphql",
      projectRoot: project.root,
      artifacts: ["00-query.graphql", "99-scalars.graphql"],
    };
    const routes = (await new GraphQlRouteScanner().scan(match)).routes;
    const nowRoute = routes.find((r) => r.displayName === "query now");
    expect(nowRoute).toBeDefined();
    const body = nowRoute?.body as { query: string } | undefined;
    expect(body).toBeDefined();
    // Si el bug persiste, generaría `now { __typename }` sobre un
    // DateTime — query inválida.
    expect(body?.query).not.toContain("__typename");
  });

  test("2ª revisión #10: scan() no guarda estado entre invocaciones", async () => {
    // Antes dos scans consecutivos contaminaban sus escalares: el
    // segundo heredaba los `scalar X` del primero. Verificamos que
    // NO: el proyecto B con un type User (objeto) NO debe
    // considerarlo escalar porque A declaró `scalar User` antes.
    const projectA = await createTempProject(
      {
        "package.json": JSON.stringify({
          dependencies: { graphql: "^16.0.0" },
        }),
        "schema.graphql": `scalar User
type Query { current: User }
`,
      },
      "graphql-a-",
    );
    const projectB = await createTempProject(
      {
        "package.json": JSON.stringify({
          dependencies: { graphql: "^16.0.0" },
        }),
        "schema.graphql": `type User { id: ID! }
type Query { current: User }
`,
      },
      "graphql-b-",
    );
    projects.push(projectA, projectB);

    const scanner = new GraphQlRouteScanner();
    // Scan A: User es scalar.
    const routesA = (await scanner.scan({
      framework: "graphql",
      projectRoot: projectA.root,
      artifacts: ["schema.graphql"],
    })).routes;
    const currentA = routesA.find((r) => r.displayName === "query current");
    const bodyA = currentA?.body as { query: string } | undefined;
    expect(bodyA?.query).not.toContain("__typename");

    // Scan B: User es objeto — DEBE llevar `__typename`.
    const routesB = (await scanner.scan({
      framework: "graphql",
      projectRoot: projectB.root,
      artifacts: ["schema.graphql"],
    })).routes;
    const currentB = routesB.find((r) => r.displayName === "query current");
    const bodyB = currentB?.body as { query: string } | undefined;
    expect(bodyB?.query).toContain("__typename");
  });

  test("2ª revisión #10: scan() NO contamina en Promise.all", async () => {
    // La regresión más grave: dos `scan()` concurrentes compartiendo
    // un Set global. Verificamos que `Promise.all` produce el
    // resultado correcto para cada proyecto por separado.
    const projectA = await createTempProject(
      {
        "package.json": JSON.stringify({
          dependencies: { graphql: "^16.0.0" },
        }),
        "schema.graphql": `scalar DateTime
type Query { now: DateTime! }
`,
      },
      "graphql-a2-",
    );
    const projectB = await createTempProject(
      {
        "package.json": JSON.stringify({
          dependencies: { graphql: "^16.0.0" },
        }),
        "schema.graphql": `type DateTime { value: String! }
type Query { now: DateTime! }
`,
      },
      "graphql-b2-",
    );
    projects.push(projectA, projectB);

    const scanner = new GraphQlRouteScanner();
    const [routesA, routesB] = await Promise.all([
      scanner.scan({
        framework: "graphql",
        projectRoot: projectA.root,
        artifacts: ["schema.graphql"],
      }),
      scanner.scan({
        framework: "graphql",
        projectRoot: projectB.root,
        artifacts: ["schema.graphql"],
      }),
    ]);

    const bodyA = (routesA.routes.find((r) => r.displayName === "query now")
      ?.body as { query: string } | undefined)?.query;
    const bodyB = (routesB.routes.find((r) => r.displayName === "query now")
      ?.body as { query: string } | undefined)?.query;

    expect(bodyA).not.toContain("__typename"); // DateTime es scalar en A
    expect(bodyB).toContain("__typename"); // DateTime es objeto en B
  });

  test("P1 #5: extrae bloques gql`...` de un fichero TS", () => {
    const source = `import { gql } from "@apollo/client";

const schema = gql\`
  type Query {
    me: User
  }
  type User {
    id: ID!
    name: String!
  }
\`;
`;
    const blocks = extractEmbeddedSdl(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("type Query");
    expect(blocks[0]).toContain("type User");
  });

  test("P1 #5: scanner GraphQL extrae operaciones de SDL embebido", async () => {
    const project = await createTempProject(
      {
        "package.json": JSON.stringify({
          dependencies: { graphql: "^16.0.0", "@apollo/server": "^4.0.0" },
        }),
        "src/schema.ts": `import { gql } from "@apollo/server";

export const typeDefs = gql\`
  type Query {
    health: String!
  }
  type Mutation {
    ping: String!
  }
\`;
`,
      },
      "graphql-embedded-",
    );
    projects.push(project);

    const match: IProjectMatch = {
      framework: "graphql",
      projectRoot: project.root,
      artifacts: ["src/schema.ts"],
    };
    const routes = (await new GraphQlRouteScanner().scan(match)).routes;
    const names = routes.map((r) => r.displayName).sort();
    expect(names).toContain("query health");
    expect(names).toContain("mutation ping");
  });
});
