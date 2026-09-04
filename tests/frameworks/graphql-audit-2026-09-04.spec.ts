/**
 * Tests para los fixes del audit 2026-09-04 en el scanner GraphQL.
 *
 * Cubre:
 *   - P1 #3: dedupe entre Query.user y Mutation.user con el mismo
 *     nombre (antes se perdía uno).
 *   - P1 #4: escalares personalizados no se tratan como objetos.
 *   - P1 #5: SDL embebido en `gql\`...\`` se extrae de TS/JS.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  buildQueryDocument,
  extractEmbeddedSdl,
  parseOperations,
  GraphQlRouteScanner,
  _resetCustomScalars,
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

beforeEach(() => {
  _resetCustomScalars();
});

describe("graphql scanner — audit 2026-09-04 fixes", () => {
  test("P1 #3: dedupe entre Query.user y Mutation.user con mismo nombre", async () => {
    // Antes el `seen.has(op.name)` colisionaba entre query y mutation.
    // Ahora la clave compuesta `kind:name` mantiene las dos.
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
    // El parser debe registrar DateTime y UUID como escalares. Si no,
    // el cuerpo generado pediría `now { __typename }` sobre un
    // DateTime, que es inválido.
    const sdl = `scalar DateTime
scalar UUID

type Query {
  now: DateTime!
  byId(id: UUID!): User
}
type User { id: ID! }
`;
    const ops = parseOperations(sdl, "query");
    expect(ops).toHaveLength(2);

    const now = ops.find((o) => o.name === "now");
    expect(now).toBeDefined();
    if (now) {
      const doc = buildQueryDocument(now);
      expect(doc).not.toContain("__typename");
    }

    const byId = ops.find((o) => o.name === "byId");
    expect(byId).toBeDefined();
    if (byId) {
      const doc = buildQueryDocument(byId);
      // `byId` devuelve un objeto (User) → debe llevar `__typename`.
      expect(doc).toContain("__typename");
    }
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
        // El proyecto NO tiene ningún .graphql en disco — todo el
        // esquema está embebido en el código TS. Antes el scanner
        // devolvía 0 operaciones.
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
