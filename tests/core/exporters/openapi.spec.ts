/**
 * Tests for the OpenAPI exporter centered on 3.1 nullability (a00011 C-4).
 *
 * OpenAPI 3.1 uses JSON Schema 2020-12: `nullable: true` (the
 * OpenAPI 3.0 form) is deprecated. Nullability is modeled like so:
 *
 *   - **Scalars** (`scalar`/`enum`/`literal`): `type: [T, "null"]`.
 *   - **Composites** (`object`/`array`/`union`/`intersection`):
 *     `oneOf: [{...inner}, { type: "null" }]`.
 *   - **References**: same as composites (wrapped in `oneOf`).
 *
 * These tests check that the exporter at `packages/core/exporters/
 * openapi.exporter.ts` applies that translation, and that it **never**
 * emits `nullable: true` (no-regression).
 */
import { describe, expect, test } from "vitest";

import type { EndpointSpec } from "../../../packages/contracts/interfaces/core/postman.interface";
import type {
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../../packages/contracts/interfaces/core/schema.interface";
import type { IExportInput } from "../../../packages/contracts/interfaces/core/export-target.interface";
import { buildOpenApiDocument } from "../../../packages/core/exporters/openapi.exporter";
import { createArrayNode, createObjectNode } from "../../../packages/core/schema/build-schema-graph.helper";
import { createSchemaGraph } from "../../../packages/core/schema/serialize.helper";
import { createEnumNode, createScalarNode } from "../../../packages/core/schema/scalar.helper";
import { createUnionNode } from "../../../packages/core/schema/union.helper";

/** Builds a minimal valid `EndpointSpec` for the exporter. */
function spec(uri: string, method: EndpointSpec["method"], extra: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    name: `Spec ${method} ${uri}`,
    method,
    uri,
    ...extra,
  };
}

/** Base input for `buildOpenApiDocument`. */
function baseInput(specs: ReadonlyArray<EndpointSpec>): IExportInput {
  return {
    specs,
    config: {
      name: "test-api",
      collectionName: "Test API",
      collectionDescription: "Una API de tests",
      baseUrl: "http://localhost:3000",
      variables: [{ key: "id", value: "1" }],
    } as IExportInput["config"],
    auth: { type: "none" },
  };
}

/** Helper to extract the `schema` from an endpoint's requestBody. */
function extractRequestSchema(doc: Record<string, unknown>, path: string, method: string): Record<string, unknown> {
  const paths = doc["paths"] as Record<string, Record<string, unknown>>;
  const op = paths[path]?.[method] as Record<string, unknown>;
  const body = op["requestBody"] as Record<string, unknown>;
  const content = body["content"] as Record<string, Record<string, unknown>>;
  const json = content["application/json"] as Record<string, unknown>;
  return json["schema"] as Record<string, unknown>;
}

describe("OpenAPI exporter — 3.1 nullability (a00011 C-4)", () => {
  test("`nullable` wrapping `scalar: string` emits `type: ['string', 'null']`", () => {
    const stringId: SchemaNodeId = "n:0";
    const nullableId: SchemaNodeId = "n:1";
    const root: SchemaNodeId = "n:2";

    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [stringId, createScalarNode("string", stringId, { name: "Nick" })],
        [nullableId, { id: nullableId, kind: "nullable", inner: stringId }],
        [
          root,
          createObjectNode(root, [
            { name: "nick", node: nullableId, required: false },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/users", "POST", { schemaGraph: graph })]),
    );

    const schema = extractRequestSchema(doc, "/api/users", "post");
    expect(schema["type"]).toBe("object");

    const properties = schema["properties"] as Record<string, unknown>;
    const nick = properties["nick"] as Record<string, unknown>;

    // 3.1 form: type array, not `nullable: true`.
    expect(nick["type"]).toEqual(["string", "null"]);
    expect(nick["nullable"]).toBeUndefined();
  });

  test("`nullable` wrapping `scalar: integer` emits `type: ['integer', 'null']`", () => {
    const intId: SchemaNodeId = "n:0";
    const nullableId: SchemaNodeId = "n:1";
    const root: SchemaNodeId = "n:2";

    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [intId, createScalarNode("integer", intId, { name: "Age" })],
        [nullableId, { id: nullableId, kind: "nullable", inner: intId }],
        [
          root,
          createObjectNode(root, [
            { name: "age", node: nullableId, required: false },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/users", "POST", { schemaGraph: graph })]),
    );

    const schema = extractRequestSchema(doc, "/api/users", "post");
    const properties = schema["properties"] as Record<string, unknown>;
    const age = properties["age"] as Record<string, unknown>;

    expect(age["type"]).toEqual(["integer", "null"]);
    expect(age["nullable"]).toBeUndefined();
  });

  test("`nullable` wrapping `object` emits `type: ['object', 'null']` with `properties` preserved", () => {
    const fieldId: SchemaNodeId = "n:0";
    const innerObjId: SchemaNodeId = "n:1";
    const nullableId: SchemaNodeId = "n:2";
    const root: SchemaNodeId = "n:3";

    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [fieldId, createScalarNode("string", fieldId)],
        [
          innerObjId,
          createObjectNode(innerObjId, [
            { name: "street", node: fieldId, required: true },
          ]),
        ],
        [nullableId, { id: nullableId, kind: "nullable", inner: innerObjId }],
        [
          root,
          createObjectNode(root, [
            { name: "address", node: nullableId, required: false },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/users", "POST", { schemaGraph: graph })]),
    );

    const schema = extractRequestSchema(doc, "/api/users", "post");
    const properties = schema["properties"] as Record<string, unknown>;
    const address = properties["address"] as Record<string, unknown>;

    // JSON Schema 2020-12 (OpenAPI 3.1) allows `type: ["object", "null"]`
    // just like for scalars: the type array covers any combination,
    // including `object + null`. The `oneOf` form would also be
    // valid, but `type: [...]` is the most compact and the one this
    // implementation prefers when the inner has a scalar `type`.
    expect(address["type"]).toEqual(["object", "null"]);
    expect(address["nullable"]).toBeUndefined();
    expect(address["oneOf"]).toBeUndefined();

    const innerProps = address["properties"] as Record<string, unknown>;
    expect(innerProps["street"]).toEqual({ type: "string" });
  });

  test("`nullable` wrapping `union` emits `oneOf` with the union + `null`", () => {
    const stringId: SchemaNodeId = "n:0";
    const intId: SchemaNodeId = "n:1";
    const unionId: SchemaNodeId = "n:2";
    const nullableId: SchemaNodeId = "n:3";
    const root: SchemaNodeId = "n:4";

    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [stringId, createScalarNode("string", stringId)],
        [intId, createScalarNode("integer", intId)],
        [
          unionId,
          createUnionNode([stringId, intId], unionId, { name: "StringOrInt" }),
        ],
        [nullableId, { id: nullableId, kind: "nullable", inner: unionId }],
        [
          root,
          createObjectNode(root, [
            { name: "value", node: nullableId, required: false },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/echo", "POST", { schemaGraph: graph })]),
    );

    const schema = extractRequestSchema(doc, "/api/echo", "post");
    const properties = schema["properties"] as Record<string, unknown>;
    const value = properties["value"] as Record<string, unknown>;

    expect(value["type"]).toBeUndefined();
    expect(value["nullable"]).toBeUndefined();

    const oneOf = value["oneOf"] as ReadonlyArray<Record<string, unknown>>;
    expect(oneOf).toHaveLength(2);

    // The first branch is the union's `oneOf` (string | integer).
    const unionBranch = oneOf[0] as Record<string, unknown>;
    const unionOneOf = unionBranch["oneOf"] as ReadonlyArray<Record<string, unknown>>;
    expect(unionOneOf).toHaveLength(2);
    expect(unionOneOf[0]).toEqual({ type: "string" });
    expect(unionOneOf[1]).toEqual({ type: "integer" });

    // The second branch is the nullability.
    expect(oneOf[1]).toEqual({ type: "null" });
  });

  test("`nullable` wrapping `enum` emits `type: ['string', 'null']` with `enum` preserved", () => {
    const enumId: SchemaNodeId = "n:0";
    const nullableId: SchemaNodeId = "n:1";
    const root: SchemaNodeId = "n:2";

    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [
          enumId,
          createEnumNode(["red", "green", "blue"], enumId, { name: "Color" }),
        ],
        [nullableId, { id: nullableId, kind: "nullable", inner: enumId }],
        [
          root,
          createObjectNode(root, [
            { name: "color", node: nullableId, required: false },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/things", "POST", { schemaGraph: graph })]),
    );

    const schema = extractRequestSchema(doc, "/api/things", "post");
    const properties = schema["properties"] as Record<string, unknown>;
    const color = properties["color"] as Record<string, unknown>;

    // `enum` is serialized as `{ type: "string", enum: [...] }`. The
    // exporter treats it as a scalar (type === "string"), so the
    // nullability goes as `type: ["string", "null"]` and preserves
    // the `enum`.
    expect(color["type"]).toEqual(["string", "null"]);
    expect(color["nullable"]).toBeUndefined();
    expect(color["enum"]).toEqual(["red", "green", "blue"]);
  });

  test("`nullable` wrapping `array` emits `type: ['array', 'null']` with `items` preserved", () => {
    const itemId: SchemaNodeId = "n:0";
    const arrayId: SchemaNodeId = "n:1";
    const nullableId: SchemaNodeId = "n:2";
    const root: SchemaNodeId = "n:3";

    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [itemId, createScalarNode("string", itemId)],
        [arrayId, createArrayNode(arrayId, itemId, { name: "Tags" })],
        [nullableId, { id: nullableId, kind: "nullable", inner: arrayId }],
        [
          root,
          createObjectNode(root, [
            { name: "tags", node: nullableId, required: false },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/posts", "POST", { schemaGraph: graph })]),
    );

    const schema = extractRequestSchema(doc, "/api/posts", "post");
    const properties = schema["properties"] as Record<string, unknown>;
    const tags = properties["tags"] as Record<string, unknown>;

    // Same as for `object`: the inner's `type` is "array" (string),
    // so the nullability goes as `type: ["array", "null"]`.
    expect(tags["type"]).toEqual(["array", "null"]);
    expect(tags["nullable"]).toBeUndefined();
    expect(tags["oneOf"]).toBeUndefined();
    expect(tags["items"]).toEqual({ type: "string" });
  });

  test("no OpenAPI document in the batch emits `nullable: true` (no-regression)", () => {
    // Cases that in 3.0 would have emitted `nullable: true`. We check
    // that **none** does so anymore, in any branch of the exporter.
    const scalarId: SchemaNodeId = "n:0";
    const objectId: SchemaNodeId = "n:1";
    const nullScalarId: SchemaNodeId = "n:2";
    const nullObjectId: SchemaNodeId = "n:3";
    const root: SchemaNodeId = "n:4";

    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [scalarId, createScalarNode("string", scalarId)],
        [objectId, createObjectNode(objectId, [])],
        [nullScalarId, { id: nullScalarId, kind: "nullable", inner: scalarId }],
        [nullObjectId, { id: nullObjectId, kind: "nullable", inner: objectId }],
        [
          root,
          createObjectNode(root, [
            { name: "a", node: nullScalarId, required: false },
            { name: "b", node: nullObjectId, required: false },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/all", "POST", { schemaGraph: graph })]),
    );

    // We walk the document looking for `nullable: true` (we forbid it
    // at any level, including `components.schemas`).
    const yaml = JSON.stringify(doc);
    expect(yaml).not.toMatch(/"nullable"\s*:\s*true/);
  });

  test("`nullable` without `inner` falls back to `{ type: 'null' }` (incomplete graph)", () => {
    // Defense: if the graph is broken (a `nullable` without `inner`),
    // the exporter must not throw — it must emit something honest.
    const nullableId: SchemaNodeId = "n:0";
    const root: SchemaNodeId = "n:1";

    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [nullableId, { id: nullableId, kind: "nullable" /* sin inner */ }],
        [
          root,
          createObjectNode(root, [
            { name: "x", node: nullableId, required: false },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/loose", "POST", { schemaGraph: graph })]),
    );

    const schema = extractRequestSchema(doc, "/api/loose", "post");
    const properties = schema["properties"] as Record<string, unknown>;
    const x = properties["x"] as Record<string, unknown>;
    // Missing `inner` → emitNullable returns `{ type: "null" }`. The
    // exporter does not throw and the output is 3.1 valid.
    expect(x["nullable"]).toBeUndefined();
    expect(x).toEqual({ type: "null" });
  });

  test("fields without `nullable` keep emitting their normal schema (no-regression)", () => {
    // Sanity: with a graph without `nullable` nodes, the exporter
    // does not add spurious 3.1 composition. We use a scalar without
    // `name` so it inlines (scalars with name go to
    // `components.schemas` as `$ref`, which is another valid path but
    // not the one we want to check here).
    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        ["n:0", createScalarNode("string", "n:0")],
        [
          "n:1",
          createObjectNode("n:1", [
            { name: "email", node: "n:0", required: true },
          ]),
        ],
      ]),
      "n:1",
    );

    const doc = buildOpenApiDocument(
      baseInput([spec("/api/users", "POST", { schemaGraph: graph })]),
    );

    const schema = extractRequestSchema(doc, "/api/users", "post");
    const properties = schema["properties"] as Record<string, unknown>;
    const email = properties["email"] as Record<string, unknown>;

    // Without wrapping: the field is `{ type: "string" }` directly.
    expect(email).toEqual({ type: "string" });
    expect(email["nullable"]).toBeUndefined();
    expect(email["oneOf"]).toBeUndefined();
  });
});
describe("OpenAPI exporter — auth per-op override (audit 2026-09-04 P1 #7)", () => {
  test("spec.auth = { kind: 'none' } emits security: [] at the operation level", () => {
    const doc = buildOpenApiDocument(
      baseInput([
        spec("/api/login", "POST", { auth: { kind: "none" } }),
        spec("/api/users", "GET"),
      ]),
    );

    // The document declares `none` global security via baseInput, so
    // the endpoint with auth: { kind: "none" } must carry an explicit
    // `security: []` (per-operation override).
    const paths = doc["paths"] as Record<string, Record<string, unknown>>;
    const login = paths["/api/login"]?.["post"] as Record<string, unknown>;
    expect(login["security"]).toEqual([]);

    // The other endpoint without override must respect the global
    // scheme (in this case baseInput sets auth: { type: "none" } so it
    // inherits that; the important thing is that it does NOT have
    // per-op `security: []`).
    const users = paths["/api/users"]?.["get"] as Record<string, unknown>;
    expect(users["security"]).toBeUndefined();
  });

  test("per-op override with auth { kind: 'none' } disables the global bearer", () => {
    // Real audit case: the collection has global bearer auth, but
    // /auth/login must be public.
    const input: IExportInput = {
      ...baseInput([spec("/auth/login", "POST", { auth: { kind: "none" } })]),
      auth: { type: "bearer" },
    };
    const doc = buildOpenApiDocument(input);
    const paths = doc["paths"] as Record<string, Record<string, unknown>>;
    const login = paths["/auth/login"]?.["post"] as Record<string, unknown>;
    expect(login["security"]).toEqual([]);
  });
});

describe("OpenAPI exporter — cookie params (audit 2026-09-04 P2 #9)", () => {
  test("spec.fields with location='cookie' emits in: cookie", () => {
    const doc = buildOpenApiDocument(
      baseInput([
        spec("/api/me", "GET", {
          fields: [{ fieldName: "session", location: "cookie", required: true, type: "string" }],
        }),
      ]),
    );
    const paths = doc["paths"] as Record<string, Record<string, unknown>>;
    const op = paths["/api/me"]?.["get"] as Record<string, unknown>;
    const parameters = op["parameters"] as Array<Record<string, unknown>>;
    const cookie = parameters.find((p) => p["in"] === "cookie");
    expect(cookie).toEqual({
      name: "session",
      in: "cookie",
      required: true,
      schema: expect.any(Object),
    });
  });
});

/**
 * `x-tanit-confidence` extension (audit 2026-09-06 §16, §17,
 * proposal `r00015` S3+S4).
 *
 * When a scanner stamps an EndpointSpec with a confidence
 * level (Next.js Pages Router for example — emits 5 verbs
 * from `switch (req.method)` and stamps `low`), the
 * OpenAPI exporter surfaces that stamp as an OpenAPI 3.x
 * extension:
 *
 *   - `x-tanit-confidence: "low" | "medium" | "high"`
 *   - `x-tanit-confidence-reasons: ["...", "..."]`
 *
 * Scanners that produce a precise signal (App Router `GET`
 * named export, OpenAPI path+verb, Hono `.get/.post/...`)
 * leave `confidence` undefined and the exporter omits the
 * extension — the OpenAPI doc stays clean for those routes.
 */
describe("r00015 — x-tanit-confidence extension", () => {
  test("spec without confidence emits no extension", () => {
    const doc = buildOpenApiDocument(
      baseInput([spec("/users", "GET")]),
    );
    const op = ((doc.paths as Record<string, { get?: Record<string, unknown> }>)["/users"]!).get!;
    expect(op["x-tanit-confidence"]).toBeUndefined();
    expect(op["x-tanit-confidence-reasons"]).toBeUndefined();
  });

  test("low confidence is emitted with reasons", () => {
    const doc = buildOpenApiDocument(
      baseInput([
        spec("/anything", "GET", {
          confidence: {
            level: "low",
            reasons: ["Pages Router multi-verb dispatch"],
          },
        }),
      ]),
    );
    const op = ((doc.paths as Record<string, { get?: Record<string, unknown> }>)["/anything"]!).get!;
    expect(op["x-tanit-confidence"]).toBe("low");
    expect(op["x-tanit-confidence-reasons"]).toEqual([
      "Pages Router multi-verb dispatch",
    ]);
  });

  test("medium confidence is emitted without reasons when empty", () => {
    const doc = buildOpenApiDocument(
      baseInput([
        spec("/x", "POST", {
          confidence: {
            level: "medium",
            reasons: [],
          },
        }),
      ]),
    );
    const op = ((doc.paths as Record<string, { post?: Record<string, unknown> }>)["/x"]!).post!;
    expect(op["x-tanit-confidence"]).toBe("medium");
    expect(op["x-tanit-confidence-reasons"]).toBeUndefined();
  });
});
