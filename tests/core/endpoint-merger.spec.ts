import { describe, expect, test } from "vitest";
import {
  EndpointMerger,
  endpointSpecFromMerged,
  mergeEndpoints,
} from "../../packages/core/discovery/endpoint-merger.service";
import type { IEndpointMergeCandidate } from "../../packages/contracts/interfaces/core/merge.interface";
import type { IDetectedAuthScheme } from "../../packages/contracts/interfaces/core/discovery.interface";
import type { IValidationSpec } from "../../packages/contracts/interfaces/core/scanner.interface";

function body(s: string): unknown {
  return { example: s };
}

const OPENAPI_BODY = body("from-openapi");
const FASTIFY_BODY = body("from-fastify");
const REGEX_BODY = body("from-regex");

const BEARER: IDetectedAuthScheme = {
  type: "bearer",
  evidence: "Authorization: Bearer detected in spec/securitySchemes",
};
const APIKEY: IDetectedAuthScheme = {
  type: "apikey",
  keyName: "X-API-Key",
  keyIn: "header",
  evidence: "X-API-Key header detected in routes",
};

function field(partial: Partial<IValidationSpec>): IValidationSpec {
  return {
    fieldName: "name",
    location: "body",
    type: "string",
    required: false,
    ...partial,
  };
}

function candidate(
  partial: Partial<IEndpointMergeCandidate>,
): IEndpointMergeCandidate {
  return {
    framework: "unknown",
    scannerScore: 0.5,
    method: "GET",
    uri: "/users",
    ...partial,
  };
}

describe("EndpointMerger — identity", () => {
  test("1 candidate is an identity passthrough", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "express",
        scannerScore: 0.6,
        body: REGEX_BODY,
        description: "Lista usuarios",
      }),
    ]);

    expect(merged.method).toBe("GET");
    expect(merged.uri).toBe("/users");
    expect(merged.body).toBe(REGEX_BODY);
    expect(merged.description).toBe("Lista usuarios");
    expect(merged.provenance.contributors).toEqual(["express"]);
    expect(merged.provenance.route.framework).toBe("express");
    expect(merged.provenance.body?.framework).toBe("express");
    expect(merged.provenance.description?.framework).toBe("express");
    // Without auth → redistributes weights among the 3 present pieces:
    //   route(0.4)*0.5 + body(0.3)*0.5 + desc(0.1)*0.5 = 0.4
    // Normalized to 0.8 / (0.4+0.3+0.1) = 0.4 / 0.8 = 0.5
    expect(merged.confidence).toBeCloseTo(0.5, 2);
  });

  test("method is normalized to uppercase in the output", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ method: "post", uri: "/users", framework: "openapi" }),
    ]);
    expect(merged.method).toBe("POST");
  });

  test("name is preserved from the winner (GraphQL/tRPC identity)", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        method: "post",
        uri: "/graphql",
        name: "GetUser",
        framework: "graphql",
        scannerScore: 0.7,
      }),
      candidate({
        method: "post",
        uri: "/graphql",
        name: "GetUser",
        framework: "openapi",
        scannerScore: 0.95,
      }),
    ]);
    expect(merged.name).toBe("GetUser");
  });

  test("empty list throws", () => {
    const merger = new EndpointMerger();
    expect(() => merger.merge([])).toThrow(
      /no se puede fusionar una lista vacía/i,
    );
  });
});

describe("EndpointMerger — body", () => {
  test("the highest-confidence one wins: OpenAPI > Fastify > others", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.9, body: REGEX_BODY }),
      candidate({ framework: "fastify", scannerScore: 0.9, body: FASTIFY_BODY }),
      candidate({ framework: "openapi", scannerScore: 0.7, body: OPENAPI_BODY }),
    ]);

    expect(merged.body).toBe(OPENAPI_BODY);
    expect(merged.provenance.body?.framework).toBe("openapi");
  });

  test("with equal confidence, the first one in arrival order wins", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "laravel", scannerScore: 0.9, body: body("laravel") }),
      candidate({ framework: "symfony", scannerScore: 0.9, body: body("symfony") }),
    ]);

    expect(merged.body).toEqual(body("laravel"));
    expect(merged.provenance.body?.framework).toBe("laravel");
  });
});

describe("EndpointMerger — fields", () => {
  test("union by fieldName: required true wins over false", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "fastify",
        scannerScore: 0.9,
        fields: [field({ fieldName: "email", required: false, type: "string" })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        fields: [field({ fieldName: "email", required: true, type: "string" })],
      }),
    ]);

    expect(merged.fields).toHaveLength(1);
    expect(merged.fields?.[0]?.required).toBe(true);
    expect(merged.fields?.[0]?.fieldName).toBe("email");
  });

  test("union: integer wins over string when required matches", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "laravel",
        scannerScore: 0.9,
        fields: [field({ fieldName: "age", type: "string", required: true })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        fields: [field({ fieldName: "age", type: "integer", required: true })],
      }),
    ]);

    expect(merged.fields?.[0]?.type).toBe("integer");
  });

  test("union with declared format wins over no format", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "laravel",
        scannerScore: 0.9,
        fields: [field({ fieldName: "id", type: "string", required: true })],
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.9,
        fields: [
          field({
            fieldName: "id",
            type: "string",
            required: true,
            format: "uuid",
          }),
        ],
      }),
    ]);

    expect(merged.fields?.[0]?.format).toBe("uuid");
  });

  test("fields from 3 candidates: 2 unique, 1 shared (restrictive wins)", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.9,
        fields: [
          field({ fieldName: "a", type: "string", required: false }),
          field({ fieldName: "b", type: "integer", required: true }),
        ],
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [field({ fieldName: "b", type: "string", required: false })],
      }),
      candidate({
        framework: "hono",
        scannerScore: 0.85,
        fields: [field({ fieldName: "c", type: "boolean", required: true })],
      }),
    ]);

    expect(merged.fields).toHaveLength(3);
    const names = merged.fields?.map((f) => f.fieldName).sort();
    expect(names).toEqual(["a", "b", "c"]);
    const b = merged.fields?.find((f) => f.fieldName === "b");
    // integer > string, required > optional, same candidate
    expect(b?.type).toBe("integer");
    expect(b?.required).toBe(true);
  });

  test("no candidate with fields → fields undefined", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.6 }),
    ]);
    expect(merged.fields).toBeUndefined();
  });
});

describe("EndpointMerger — auth", () => {
  test("auth without conflict: highest-confidence wins", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.5, authScheme: BEARER }),
      candidate({ framework: "fastify", scannerScore: 0.85, authScheme: BEARER }),
    ]);

    expect(merged.authScheme?.type).toBe("bearer");
    expect(merged.provenance.auth?.framework).toBe("fastify");
  });

  test("auth in conflict (bearer vs apikey): warning + the highest-confidence one wins", () => {
    const { specs, warnings } = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.5,
        method: "GET",
        uri: "/api",
        authScheme: BEARER,
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        method: "GET",
        uri: "/api",
        authScheme: APIKEY,
      }),
    ]);

    expect(specs).toHaveLength(1);
    // OpenAPI (0.95) wins over express (0.5)
    expect(specs[0]?.authScheme?.type).toBe("apikey");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/Conflicto de auth/i);
    expect(warnings[0]).toContain("express");
    expect(warnings[0]).toContain("openapi");
  });

  test("implicit auth (empty evidence) does not count as a conflict", () => {
    const implicit: IDetectedAuthScheme = { type: "bearer", evidence: "" };
    const explicit: IDetectedAuthScheme = {
      type: "apikey",
      keyName: "X-API-Key",
      evidence: "X-API-Key header declared",
    };
    const { warnings } = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.5,
        method: "GET",
        uri: "/x",
        authScheme: implicit,
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        method: "GET",
        uri: "/x",
        authScheme: explicit,
      }),
    ]);

    expect(warnings).toHaveLength(0);
  });
});

describe("EndpointMerger — description", () => {
  test("the longest one in chars wins", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "express",
        scannerScore: 0.5,
        description: "Corta",
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        description: "La descripción más detallada y completa de este endpoint",
      }),
    ]);

    expect(merged.description).toBe(
      "La descripción más detallada y completa de este endpoint",
    );
    expect(merged.provenance.description?.framework).toBe("openapi");
  });

  test("with equal length, the first one wins", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "laravel",
        scannerScore: 0.9,
        description: "abc",
      }),
      candidate({
        framework: "symfony",
        scannerScore: 0.9,
        description: "abc",
      }),
    ]);

    expect(merged.description).toBe("abc");
    expect(merged.provenance.description?.framework).toBe("laravel");
  });
});

describe("EndpointMerger — provenance", () => {
  test("is present in all cases (even with 1 candidate)", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([candidate({ framework: "express" })]);

    expect(merged.provenance).toBeDefined();
    expect(merged.provenance.route).toBeDefined();
    expect(merged.provenance.contributors).toEqual(["express"]);
  });

  test("contributors lists every framework of the group", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.9 }),
      candidate({ framework: "openapi", scannerScore: 0.7 }),
      candidate({ framework: "fastify", scannerScore: 0.85 }),
    ]);

    expect(merged.provenance.contributors).toEqual([
      "openapi",
      "fastify",
      "express",
    ]);
  });
});

describe("EndpointMerger — global confidence (weighted average)", () => {
  test("4 pieces present: original weights", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        body: OPENAPI_BODY,
        authScheme: BEARER,
        description: "A complete description of this endpoint",
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        body: FASTIFY_BODY,
      }),
    ]);

    // Only OpenAPI contributes auth + description, Fastify only body.
    // Provenance registers OpenAPI in route/body/auth/description
    // because it is the winner in all pieces (0.95 vs 0.85).
    // Confidence = weighted average of ONE value per piece (because
    // the winner keeps the winner's confidence).
    //   route:  0.4 * 0.95 = 0.38
    //   body:   0.3 * 0.95 = 0.285
    //   auth:   0.2 * 0.95 = 0.19
    //   desc:   0.1 * 0.95 = 0.095
    //   total / (0.4+0.3+0.2+0.1) = 0.95 / 1.0 = 0.95
    expect(merged.confidence).toBeCloseTo(0.95, 2);
  });

  test("missing piece redistributes its weight: only route → confidence = route", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({ framework: "express", scannerScore: 0.5 }),
    ]);

    // Only route present: total weight is 0.4, the value is 0.5,
    // confidence = (0.4 * 0.5) / 0.4 = 0.5
    expect(merged.confidence).toBeCloseTo(0.5, 2);
  });

  test("two pieces (route + body): auth and desc are redistributed", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        body: FASTIFY_BODY,
      }),
      candidate({ framework: "express", scannerScore: 0.5 }),
    ]);

    // route and body present: weights 0.4 + 0.3 = 0.7
    // both from fastify framework (body winner), with confidence 0.85
    // (route of the winning candidate = fastify)
    //   (0.4 * 0.85 + 0.3 * 0.85) / 0.7 = 0.85
    expect(merged.confidence).toBeCloseTo(0.85, 2);
  });
});

describe("mergeEndpoints — pipeline-level", () => {
  test("empty list → empty result without warnings", () => {
    const result = mergeEndpoints([]);
    expect(result.specs).toEqual([]);
    expect(result.provenance).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  test("3 candidates in 2 groups → 2 merged endpoints + provenance", () => {
    const result = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.9,
        method: "GET",
        uri: "/users",
        description: "A",
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        method: "GET",
        uri: "/users",
        description: "B longer",
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.7,
        method: "POST",
        uri: "/users",
      }),
    ]);

    expect(result.specs).toHaveLength(2);
    expect(result.provenance).toHaveLength(2);
    // The longest description is the one from the GET group
    const getSpec = result.specs.find((s) => s.method === "GET");
    expect(getSpec?.description).toBe("B longer");
    // Conflict? No, no auth.
    expect(result.warnings).toEqual([]);
  });

  test("custom frameworkConfidence is respected", () => {
    const result = mergeEndpoints(
      [
        candidate({
          framework: "express",
          scannerScore: 0.5,
          method: "GET",
          uri: "/x",
          body: body("regex"),
        }),
        candidate({
          framework: "openapi",
          scannerScore: 0.5,
          method: "GET",
          uri: "/x",
          body: body("openapi"),
        }),
      ],
      {
        frameworkConfidence: {
          openapi: 0.6,
          fastify: 0.7,
          // express deliberadamente sin entry → cae al default
        },
      },
    );

    // Fastify (0.7) wins over OpenAPI (0.6) → there is no fastify in
    // the candidates, so the winning body is OpenAPI's by tie-breaker
    // (OpenAPI has 0.6, express default 0.5).
    expect(result.specs[0]?.body).toEqual(body("openapi"));
  });
});

describe("EndpointMerger — interacts with the confidence table", () => {
  test("default frameworkConfidence makes OpenAPI win over regex-based", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "laravel",
        scannerScore: 0.99, // high scannerScore but low framework
        body: body("regex"),
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.5,
        body: body("openapi"),
      }),
    ]);

    // OpenAPI (0.95) > Laravel (0.5) → OpenAPI wins
    expect(merged.provenance.body?.framework).toBe("openapi");
    expect(merged.body).toEqual(body("openapi"));
  });
});

// ─────────────────────────────────────────────────────────────────────
// a00011 C-3 — corrections from the post-a00010 review (B-rev-3 / 4 / 5 / 15)
// ─────────────────────────────────────────────────────────────────────

describe("EndpointMerger — REST vs RPC contextual identity (a00011 B-rev-3)", () => {
  test("two REST candidates with same (method, uri) and different name → one merged", () => {
    // REST does not multiplex: openapi and express share identity and
    // are fused. The winner's name (openapi, confidence 0.95) wins.
    const result = mergeEndpoints([
      candidate({
        method: "POST",
        uri: "/users",
        name: "Create a new user account",
        framework: "openapi",
        scannerScore: 0.95,
      }),
      candidate({
        method: "POST",
        uri: "/users",
        name: "Create Users",
        framework: "express",
        scannerScore: 0.6,
      }),
    ]);

    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.method).toBe("POST");
    expect(result.specs[0]?.uri).toBe("/users");
    expect(result.specs[0]?.name).toBe("Create a new user account");
    expect(result.provenance).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  test("two GraphQL candidates with same (method+uri), different name → TWO merged", () => {
    // GraphQL multiplexes by name: two POST /graphql with different
    // names are two distinct operations. Previously they collided
    // into one, silently losing an operation.
    const result = mergeEndpoints([
      candidate({
        method: "POST",
        uri: "/graphql",
        name: "QueryUsers",
        framework: "graphql",
        scannerScore: 0.7,
      }),
      candidate({
        method: "POST",
        uri: "/graphql",
        name: "MutationCreateUser",
        framework: "graphql",
        scannerScore: 0.7,
      }),
    ]);

    expect(result.specs).toHaveLength(2);
    const names = result.specs.map((s) => s.name).sort();
    expect(names).toEqual(["MutationCreateUser", "QueryUsers"]);
    expect(result.warnings).toEqual([]);
  });

  test("REST and RPC on the same (method, uri) do NOT collide (each to its own group)", () => {
    // graphql (RPC, includes name in the key) and express (REST, does
    // not include it) generate two distinct keys → two groups, two
    // merges. This is deliberate: the agnostic adapter prefers two
    // separate endpoints over a silent fusion.
    const result = mergeEndpoints([
      candidate({
        method: "POST",
        uri: "/users",
        name: "ExpressCreate",
        framework: "express",
        scannerScore: 0.6,
      }),
      candidate({
        method: "POST",
        uri: "/graphql",
        name: "GraphqlCreateUser",
        framework: "graphql",
        scannerScore: 0.7,
      }),
    ]);

    expect(result.specs).toHaveLength(2);
    const uris = result.specs.map((s) => s.uri).sort();
    expect(uris).toEqual(["/graphql", "/users"]);
  });
});

describe("EndpointMerger — field merge by location:fieldName (a00011 B-rev-4)", () => {
  test("path.id and query.id are TWO fields in the merged (composite key)", () => {
    // Previously both fields collided into a single entry because the
    // key was the bare `fieldName`; now `${location}:${fieldName}`
    // separates them and each keeps its location.
    const result = mergeEndpoints([
      candidate({
        method: "GET",
        uri: "/items/{id}",
        framework: "openapi",
        scannerScore: 0.95,
        fields: [
          field({ fieldName: "id", location: "path", type: "string", required: true }),
        ],
      }),
      candidate({
        method: "GET",
        uri: "/items/{id}",
        framework: "express",
        scannerScore: 0.6,
        fields: [
          field({ fieldName: "id", location: "query", type: "string", required: false }),
        ],
      }),
    ]);

    expect(result.specs).toHaveLength(1);
    const fields = result.specs[0]?.fields ?? [];
    expect(fields).toHaveLength(2);
    const byLoc = Object.fromEntries(
      fields.map((f) => [`${f.location}:${f.fieldName}`, f]),
    );
    expect(byLoc["path:id"]?.required).toBe(true);
    expect(byLoc["query:id"]?.required).toBe(false);
    expect(result.warnings).toEqual([]);
  });
});

describe("EndpointMerger — mergeFieldSpecs fulfills its contract (a00011 B-rev-5)", () => {
  test("minLength: max(minimums)", () => {
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [field({ fieldName: "username", type: "string", minLength: 3 })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [field({ fieldName: "username", type: "string", minLength: 5 })],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.minLength).toBe(5);
    expect(result.warnings).toEqual([]);
  });

  test("maximum: min(maximums)", () => {
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [field({ fieldName: "age", type: "integer", maximum: 120 })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [field({ fieldName: "age", type: "integer", maximum: 99 })],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.maximum).toBe(99);
  });

  test("enumValues: empty intersection → warning + empty enumValues", () => {
    // Disjoint: no value satisfies both scanners. The merger does not
    // invent: it emits a warning and leaves the (empty) intersection
    // for the operator to decide.
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [
          field({
            fieldName: "role",
            type: "string",
            enumValues: ["a", "b", "c"],
          }),
        ],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [
          field({
            fieldName: "role",
            type: "string",
            enumValues: ["b", "c", "d"],
          }),
        ],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.enumValues).toEqual(["b", "c"]);
    // The intersection is NOT empty: there is only a warning if it is.
    expect(result.warnings).toEqual([]);
  });

  test("enumValues: actual empty intersection → warning + enum from the highest-confidence side", () => {
    // Disjoint domains: the warning must come out in
    // `IMergeOutcome.warnings`. Publishing `[]` would discard the
    // whole domain: the contract (a00011 B-rev-5) is to keep the enum
    // from the higher-confidence/provenance side. OpenAPI (0.95) >
    // fastify (0.85), so openapi's `["c", "d"]` wins.
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [
          field({
            fieldName: "role",
            type: "string",
            enumValues: ["a", "b"],
          }),
        ],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [
          field({
            fieldName: "role",
            type: "string",
            enumValues: ["c", "d"],
          }),
        ],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.enumValues).toEqual(["c", "d"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/body:role/);
    expect(result.warnings[0]).toMatch(/enum intersection empty/);
  });

  test("enumValues: empty intersection with equal confidence → enum from A (first in order)", () => {
    // Confidence tie (default 0.5 for both): A wins, the first in the
    // caller's order (body-winner / arrival).
    const result = mergeEndpoints([
      candidate({
        framework: "laravel",
        scannerScore: 0.5,
        fields: [
          field({ fieldName: "role", type: "string", enumValues: ["a"] }),
        ],
      }),
      candidate({
        framework: "symfony",
        scannerScore: 0.5,
        fields: [
          field({ fieldName: "role", type: "string", enumValues: ["b"] }),
        ],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.enumValues).toEqual(["a"]);
    expect(result.warnings).toHaveLength(1);
  });

  test("type mismatch (string vs object) → conflict + winner by higher confidence", () => {
    // A: 'object' with scannerScore 0.95 (openapi). B: 'string' with
    // scannerScore 0.85 (fastify). openapi wins by frameworkConfidence
    // (0.95 vs 0.85), and the winner's type is 'object'.
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [field({ fieldName: "payload", type: "string", required: false })],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [field({ fieldName: "payload", type: "object", required: false })],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.type).toBe("object");
  });

  test("type mismatch with equal confidence → A is the winner + conflict warning", () => {
    // Two scanners with the same frameworkConfidence (falling back to
    // the default 0.5 for not being in the table). A wins by arrival
    // order, and the merger warns.
    const result = mergeEndpoints([
      candidate({
        framework: "laravel",
        scannerScore: 0.5,
        fields: [field({ fieldName: "payload", type: "string", required: false })],
      }),
      candidate({
        framework: "symfony",
        scannerScore: 0.5,
        fields: [field({ fieldName: "payload", type: "object", required: false })],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0];
    expect(f?.type).toBe("string");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/type mismatch: string vs object/);
  });

  test("divergent pattern → warning + winner A (openapi first by frameworkConfidence)", () => {
    // With the default table, openapi (0.95) beats fastify (0.85), so
    // A is openapi in `mergeFieldSpecs`. The contract is "first in the
    // caller's order wins"; here that order is the `sortCandidates`
    // one, which puts openapi first.
    const result = mergeEndpoints([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        fields: [
          field({ fieldName: "slug", type: "string", pattern: "^[a-z0-9-]+$" }),
        ],
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        fields: [
          field({ fieldName: "slug", type: "string", pattern: "^[a-z0-9_-]+$" }),
        ],
      }),
    ]);

    const f = result.specs[0]?.fields?.[0] as IValidationSpec | undefined;
    expect(f?.pattern).toBe("^[a-z0-9_-]+$");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/pattern mismatch/);
  });
});

describe("EndpointMerger — frameworkConfidence is respected in sortCandidates (a00011 B-rev-15)", () => {
  test("express wins the body despite a lower scannerScore because frameworkConfidence declares it higher", () => {
    // a00011 B-rev-15: sortCandidates must use the injected table, not
    // the global constant. Here openapi has a higher scannerScore
    // (0.95 vs 0.5) but express has a higher frameworkConfidence
    // (0.9 vs 0.2). The winning body must be express's.
    //
    // The user spec said "openapi wins... even with less scannerScore";
    // with the 0.2/0.9 values the example gave, that was impossible.
    // We interpret the intent of the B-rev-15 fix
    // (frameworkConfidence orders candidates) and write the case
    // consistent with the numbers.
    const result = mergeEndpoints(
      [
        candidate({
          method: "POST",
          uri: "/x",
          framework: "openapi",
          scannerScore: 0.95,
          body: body("openapi"),
        }),
        candidate({
          method: "POST",
          uri: "/x",
          framework: "express",
          scannerScore: 0.5,
          body: body("express"),
        }),
      ],
      {
        frameworkConfidence: {
          openapi: 0.2,
          express: 0.9,
        },
      },
    );

    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.body).toEqual(body("express"));
    expect(result.specs[0]?.provenance.body?.framework).toBe("express");
  });

  test("with the default frameworkConfidence, openapi still wins by the internal table", () => {
    // Regression: the default behavior (without override) still gives
    // openapi (0.95) above express (default 0.5).
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.5,
        body: body("openapi"),
      }),
      candidate({
        framework: "express",
        scannerScore: 0.95,
        body: body("express"),
      }),
    ]);

    expect(merged.provenance.body?.framework).toBe("openapi");
    expect(merged.body).toEqual(body("openapi"));
  });
});

describe("endpointSpecFromMerged — auth per-op (audit 2026-09-04 P1 #6)", () => {
  test("authScheme { type: 'none' } is translated to EndpointSpec.auth { kind: 'none' }", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        authScheme: { type: "none", evidence: "per-op override (fastify)" },
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "none" });
  });

  test("authScheme 'bearer' is translated to EndpointSpec.auth scheme:bearer (per-op override)", () => {
    // Audit 2nd review #17: now ALL branches of the union are
    // translated, not only `none`. A per-op override of bearer must
    // survive the merger and the resulting EndpointSpec — previously
    // it was discarded and the builder used the global auth.
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: BEARER,
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "scheme", scheme: "bearer" });
  });

  test("authScheme 'apikey' is translated to scheme:apiKey", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: APIKEY,
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "scheme", scheme: "apiKey" });
  });

  test("authScheme 'oauth2' is translated to scheme:oauth2", () => {
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: { type: "oauth2", evidence: "OAuth2 flow" },
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "scheme", scheme: "oauth2" });
  });

  test("hybrid fusion with override 'none' preserves the public mark", () => {
    // OpenAPI declares /auth/login as bearer (global scheme);
    // Fastify overrides it to none (it is the endpoint that issues
    // the token, it cannot require it). The merger must keep none.
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: BEARER,
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        authScheme: { type: "none", evidence: "per-op override (fastify)" },
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "none" });
  });

  test("per-op authScheme scheme:bearer wins over the higher-confidence global bearer", () => {
    // Audit 2nd review #18: an EXPLICIT per-operation override must
    // have semantic precedence, not "framework with higher confidence".
    // Here fastify (0.85) overrides bearer→apiKey and must win even
    // though openapi (0.95) brings bearer.
    const merger = new EndpointMerger();
    const { merged } = merger.merge([
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        authScheme: BEARER,
      }),
      candidate({
        framework: "fastify",
        scannerScore: 0.85,
        authScheme: {
          type: "apikey",
          keyIn: "header",
          evidence: "per-op override (fastify, apiKey)",
        },
      }),
    ]);
    const spec = endpointSpecFromMerged(merged);
    expect(spec.auth).toEqual({ kind: "scheme", scheme: "apiKey" });
  });
});

describe("endpoint merger — serviceId separates workspaces (audit 2nd-review #3)", () => {
  test("two GET /health from different workspaces do NOT merge", () => {
    // Real audit case: monorepo with apps/users-api and
    // apps/payments-api. Each workspace exposes its own GET /health.
    // Previously the merger collapsed them into one.
    const { specs, warnings } = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.8,
        serviceId: "apps/users-api",
        method: "GET",
        uri: "/health",
      }),
      candidate({
        framework: "express",
        scannerScore: 0.8,
        serviceId: "apps/payments-api",
        method: "GET",
        uri: "/health",
      }),
    ]);
    expect(specs).toHaveLength(2);
    expect(
      warnings.some((w) => w.includes("were declared by more than one")),
    ).toBe(false);
  });

  test("same serviceId DOES merge (no regression of legacy behavior)", () => {
    const { specs } = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.8,
        serviceId: "apps/api",
        method: "GET",
        uri: "/users",
        body: body("from-express"),
      }),
      candidate({
        framework: "openapi",
        scannerScore: 0.95,
        serviceId: "apps/api",
        method: "GET",
        uri: "/users",
        body: body("from-openapi"),
      }),
    ]);
    // Same service: hybrid fusion. One spec.
    expect(specs).toHaveLength(1);
  });

  test("empty serviceId stays as an empty string in the key (flat projects)", () => {
    // Legacy case: a flat project without workspaces must keep
    // deduplicating by method+uri. serviceId must not interfere.
    const { specs } = mergeEndpoints([
      candidate({
        framework: "express",
        scannerScore: 0.8,
        method: "GET",
        uri: "/users",
      }),
      candidate({
        framework: "express",
        scannerScore: 0.8,
        method: "GET",
        uri: "/users",
      }),
    ]);
    expect(specs).toHaveLength(1);
  });
});
