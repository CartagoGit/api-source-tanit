/**
 * Tests for the 2026-09-04 audit fixes in the GraphQL scanner.
 *
 * Covers:
 *   - P1 #3: dedupe between Query.user and Mutation.user with the
 *     same name (previously one was lost).
 *   - P1 #4: custom scalars are not treated as objects.
 *   - P1 #5: embedded SDL in `gql\`...\`` is extracted from TS/JS.
 *   - 2nd review: custom scalars live inside `scan()` and two
 *     consecutive scans (including `Promise.all`) do NOT contaminate
 *     the second one's result.
 */
import { afterEach, describe, expect, test } from "vitest";

import {
  buildQueryDocument,
  collectCustomScalars,
  parseOperations,
  GraphQlProjectScanner,
  GraphQlRouteScanner,
} from "../../packages/frameworks/scanners/graphql.scanner";
import {
  createTempProject,
  type ITempProject,
} from "../helpers/scanner-fixture";
import type { IProjectMatch } from "../../packages/contracts/interfaces/core/scanner.interface";
import {
  collectTaggedTemplatesFromSource,
} from "../../packages/frameworks/typescript/tagged-template.helper";
import { collectEmbeddedSdl } from "../../packages/frameworks/scanners/graphql-embedded.scanner";

const projects: ITempProject[] = [];

afterEach(async () => {
  for (const p of projects.splice(0)) await p.cleanup();
});

describe("graphql scanner — audit 2026-09-04 fixes", () => {
  test("P1 #3: dedupe between Query.user and Mutation.user with the same name", async () => {
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

  test("P1 #4: custom scalars do not generate field selection", () => {
    const sdl = `scalar DateTime
scalar UUID

type Query {
  now: DateTime!
  byId(id: UUID!): User
}
type User { id: ID! }
`;
    // Pass 1: collect scalars from the full SDL (not just the Query
    // block). `collectCustomScalars` is now pure: every call returns a
    // NEW Set.
    const customScalars = collectCustomScalars(sdl);
    expect(customScalars.has("DateTime")).toBe(true);
    expect(customScalars.has("UUID")).toBe(true);
    expect(customScalars.has("ID")).toBe(false); // builtin

    // Pass 2: extract operations with the Set as reference.
    const ops = parseOperations(sdl, "query");
    expect(ops).toHaveLength(2);

    const now = ops.find((o) => o.name === "now");
    expect(now).toBeDefined();
    if (now) {
      const doc = buildQueryDocument(now, customScalars);
      // If the bug persists, it would ask for `now { __typename }`
      // on a scalar — an invalid query.
      expect(doc).not.toContain("__typename");
    }

    const byId = ops.find((o) => o.name === "byId");
    expect(byId).toBeDefined();
    if (byId) {
      const doc = buildQueryDocument(byId, customScalars);
      // `byId` returns an object (User) → must carry `__typename`.
      expect(doc).toContain("__typename");
    }
  });

  test("2nd review #13: 'scalar X @specifiedBy(...)' is also recognized", () => {
    const sdl = `scalar DateTime @specifiedBy(url: "https://...")
type Query { now: DateTime! }
`;
    const customScalars = collectCustomScalars(sdl);
    expect(customScalars.has("DateTime")).toBe(true);
  });

  test("2nd review #12: a scalar declared in a separate file is also visible", async () => {
    // If the scalars are in a different file than the operations,
    // the scan must make a prior pass that collects them all before
    // generating the queries. Previously this failed because
    // isolated parseOperations did not see the external `scalar X`.
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
    // If the bug persists, it would generate `now { __typename }`
    // on a DateTime — an invalid query.
    expect(body?.query).not.toContain("__typename");
  });

  test("2nd review #10: scan() does not keep state between invocations", async () => {
    // Previously two consecutive scans contaminated their scalars:
    // the second inherited the first's `scalar X`. We verify that
    // is NOT the case: project B with a type User (object) must NOT
    // treat it as a scalar because A declared `scalar User`
    // earlier.
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
    // Scan A: User is a scalar.
    const routesA = (await scanner.scan({
      framework: "graphql",
      projectRoot: projectA.root,
      artifacts: ["schema.graphql"],
    })).routes;
    const currentA = routesA.find((r) => r.displayName === "query current");
    const bodyA = currentA?.body as { query: string } | undefined;
    expect(bodyA?.query).not.toContain("__typename");

    // Scan B: User is an object — MUST carry `__typename`.
    const routesB = (await scanner.scan({
      framework: "graphql",
      projectRoot: projectB.root,
      artifacts: ["schema.graphql"],
    })).routes;
    const currentB = routesB.find((r) => r.displayName === "query current");
    const bodyB = currentB?.body as { query: string } | undefined;
    expect(bodyB?.query).toContain("__typename");
  });

  test("2nd review #10: scan() does NOT contaminate under Promise.all", async () => {
    // The most severe regression: two concurrent `scan()` calls
    // sharing a global Set. We verify that `Promise.all` produces the
    // right result for each project independently.
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

    expect(bodyA).not.toContain("__typename"); // DateTime is a scalar in A
    expect(bodyB).toContain("__typename"); // DateTime is an object in B
  });

  test("P1 #5: extracts gql`...` blocks from a TS file", () => {
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
    const blocks = collectEmbeddedSdl(
      collectTaggedTemplatesFromSource(source, "schema.ts"),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain("type Query");
    expect(blocks[0]).toContain("type User");
  });

  test("P1 #5: GraphQL scanner extracts operations from embedded SDL", async () => {
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

describe("graphql scanner — false positive en detect() (audit 2nd-review #14)", () => {
  test(".graphql with fragments but NO type Query/Mutation: score 0", async () => {
    // Previously: emptyResult(0.5) — a frontend with only
    // fragments was classified as a GraphQL server. Now:
    // emptyResult(0) — only the manifest scores.
    const project = await createTempProject({
      "package.json": JSON.stringify({ name: "frontend" }),
      "fragments.graphql": `fragment UserFields on User {
  id
  name
}
`,
    });
    projects.push(project);

    const score = (
      await new GraphQlProjectScanner().detect(project.root)
    ).score;
    expect(score).toBe(0);

    await project.cleanup();
  });

  test(".graphql with type Query: score 1 (happy path)", async () => {
    const project = await createTempProject({
      "package.json": JSON.stringify({
        dependencies: { graphql: "^16.0.0" },
      }),
      "schema.graphql": `type Query { me: User }
type User { id: ID! }
`,
    });
    projects.push(project);

    const score = (
      await new GraphQlProjectScanner().detect(project.root)
    ).score;
    expect(score).toBe(1);

    await project.cleanup();
  });
});
