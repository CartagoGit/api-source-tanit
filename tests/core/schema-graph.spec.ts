/**
 * Tests for `SchemaGraph` (a00010 S6).
 *
 * Covers the six cases the proposal asked for: object/array/union/
 * reference/flatten/OpenAPI. The graph is built with the pure helpers
 * (`createObjectNode`, `createArrayNode`, etc.) and plugs into the
 * OpenAPI exporter via `EndpointSpec.schemaGraph`.
 */
import { describe, expect, test } from "vitest";

import type { EndpointSpec, IEndpointField } from "../../packages/contracts/interfaces/core/postman.interface";
import type {
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../packages/contracts/interfaces/core/schema.interface";
import { buildOpenApiDocument } from "../../packages/core/exporters/openapi.exporter";
import {
  buildSchemaGraph,
  createArrayNode,
  createObjectNode,
} from "../../packages/core/schema/build-schema-graph.helper";
import { flatten } from "../../packages/core/schema/flatten.helper";
import { createReferenceNode } from "../../packages/core/schema/reference.helper";
import { createSchemaGraph, fromDTO, toDTO } from "../../packages/core/schema/serialize.helper";
import {
  createEnumNode,
  createLiteralNode,
  createScalarNode,
} from "../../packages/core/schema/scalar.helper";
import { createUnionNode } from "../../packages/core/schema/union.helper";
import type { IExportInput } from "../../packages/contracts/interfaces/core/export-target.interface";

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

describe("SchemaGraph — nodes", () => {
  test("object with two fields serializes to JSON with `id`, `kind` and `children`", () => {
    const nameId: SchemaNodeId = "n:0";
    const ageId: SchemaNodeId = "n:1";
    const root: SchemaNodeId = "n:2";
    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [nameId, createScalarNode("string", nameId)],
        [ageId, createScalarNode("integer", ageId)],
        [
          root,
          createObjectNode(root, [
            { name: "name", node: nameId, required: true },
            { name: "age", node: ageId, required: false },
          ]),
        ],
      ]),
      root,
    );

    // The root node is an `object` with two `children`.
    const rootNode = graph.nodes.get(root);
    expect(rootNode?.kind).toBe("object");
    expect(rootNode?.children).toHaveLength(2);
    expect(rootNode?.children?.[0]?.name).toBe("name");
    expect(rootNode?.children?.[0]?.required).toBe(true);
    expect(rootNode?.children?.[1]?.name).toBe("age");
    expect(rootNode?.children?.[1]?.required).toBe(false);

    // JSON-serializable: the contract is that it is plain-data.
    const json = JSON.stringify({
      root,
      nodes: Array.from(graph.nodes.entries()),
    });
    const roundtrip = JSON.parse(json);
    expect(roundtrip.nodes).toHaveLength(3);
    expect(roundtrip.root).toBe(root);
  });

  test("array with `items` points to another node by id", () => {
    const itemId: SchemaNodeId = "n:0";
    const arrayId: SchemaNodeId = "n:1";
    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [itemId, createScalarNode("string", itemId)],
        [
          arrayId,
          createArrayNode(arrayId, itemId, { name: "Tags" }),
        ],
      ]),
      arrayId,
    );

    const arrayNode = graph.nodes.get(arrayId);
    expect(arrayNode?.kind).toBe("array");
    expect(arrayNode?.name).toBe("Tags");
    expect(arrayNode?.children).toHaveLength(1);
    expect(arrayNode?.children?.[0]?.name).toBe("items");
    expect(arrayNode?.children?.[0]?.node).toBe(itemId);

    const item = graph.nodes.get(itemId);
    expect(item?.kind).toBe("scalar");
    expect(item?.scalarType).toBe("string");
  });

  test("union with two alternatives registers both ids", () => {
    const altA: SchemaNodeId = "n:0";
    const altB: SchemaNodeId = "n:1";
    const unionId: SchemaNodeId = "n:2";
    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [altA, createScalarNode("string", altA)],
        [altB, createScalarNode("integer", altB)],
        [
          unionId,
          createUnionNode([altA, altB], unionId, { name: "StringOrNumber" }),
        ],
      ]),
      unionId,
    );

    const union = graph.nodes.get(unionId);
    expect(union?.kind).toBe("union");
    expect(union?.alternatives).toEqual([altA, altB]);
    expect(union?.name).toBe("StringOrNumber");

    // The alternatives exist and are distinct nodes.
    expect(graph.nodes.get(altA)?.scalarType).toBe("string");
    expect(graph.nodes.get(altB)?.scalarType).toBe("integer");
  });

  test("reference resolves by returning the target node", () => {
    const userId: SchemaNodeId = "n:0";
    const refId: SchemaNodeId = "n:1";
    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [
          userId,
          createObjectNode(userId, [], { name: "User" }),
        ],
        [
          refId,
          createReferenceNode(userId, refId, { name: "SelfRef" }),
        ],
      ]),
      refId,
    );

    const ref = graph.nodes.get(refId);
    expect(ref?.kind).toBe("reference");
    expect(ref?.ref).toBe(userId);

    // `resolveReference` returns the target node.
    const target = graph.nodes.get(ref?.ref ?? "");
    expect(target?.kind).toBe("object");
    expect(target?.name).toBe("User");
  });
});

describe("SchemaGraph — flatten-helper", () => {
  test("flattens an object with two scalars to an IEndpointField array", () => {
    const graph: ISchemaGraph = buildSchemaGraph([
      { fieldName: "name", location: "body", type: "string", required: true },
      { fieldName: "age", location: "body", type: "integer", required: false },
    ]);

    const flat: ReadonlyArray<IEndpointField> = flatten(graph);
    expect(flat).toHaveLength(2);

    const name = flat.find((f) => f.fieldName === "name");
    const age = flat.find((f) => f.fieldName === "age");
    expect(name?.type).toBe("string");
    expect(name?.required).toBe(true);
    expect(age?.type).toBe("integer");
    expect(age?.required).toBe(false);
  });

  test("flattens an enum preserving `enumValues`", () => {
    const graph: ISchemaGraph = buildSchemaGraph([
      {
        fieldName: "role",
        location: "body",
        type: "enum",
        required: true,
        enumValues: ["admin", "user"],
      },
    ]);

    const flat = flatten(graph);
    expect(flat).toHaveLength(1);
    expect(flat[0]?.fieldName).toBe("role");
    expect(flat[0]?.type).toBe("enum");
    expect(flat[0]?.enumValues).toEqual(["admin", "user"]);
  });
});

describe("SchemaGraph — OpenAPI exporter", () => {
  test("with `schemaGraph` it produces `properties` and `required`", () => {
    const graph: ISchemaGraph = buildSchemaGraph([
      { fieldName: "name", location: "body", type: "string", required: true },
      { fieldName: "age", location: "body", type: "integer", required: false },
    ]);

    const doc = buildOpenApiDocument(
      baseInput([
        spec("/api/users", "POST", { schemaGraph: graph }),
      ]),
    );

    const op = (doc["paths"] as Record<string, Record<string, unknown>>)["/api/users"]?.["post"] as Record<string, unknown>;
    const body = op["requestBody"] as Record<string, unknown>;
    const content = body["content"] as Record<string, Record<string, unknown>>;
    const json = content["application/json"] as Record<string, unknown>;
    const schema = json["schema"] as Record<string, unknown>;

    expect(schema["type"]).toBe("object");
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties["name"]).toEqual({ type: "string" });
    expect(properties["age"]).toEqual({ type: "integer" });
    expect(schema["required"]).toEqual(["name"]);
  });

  test("a node with `name` produces `$ref` and an entry in `components.schemas`", () => {
    const userId: SchemaNodeId = "n:0";
    const refId: SchemaNodeId = "n:1";
    const root: SchemaNodeId = "n:2";
    const graph: ISchemaGraph = createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [
          userId,
          createObjectNode(
            userId,
            [
              { name: "email", node: "n:3", required: true },
            ],
            { name: "User" },
          ),
        ],
        [
          "n:3",
          createScalarNode("string", "n:3", { constraints: { format: "email" } }),
        ],
        [
          refId,
          createReferenceNode(userId, refId, { name: "UserRef" }),
        ],
        [
          root,
          createObjectNode(root, [
            { name: "owner", node: refId, required: true },
          ]),
        ],
      ]),
      root,
    );

    const doc = buildOpenApiDocument(
      baseInput([
        spec("/api/teams", "POST", { schemaGraph: graph }),
      ]),
    );

    const components = doc["components"] as Record<string, Record<string, unknown>>;
    const schemas = components["schemas"] as Record<string, Record<string, unknown>>;
    expect(schemas["User"]).toBeDefined();
    const userSchema = schemas["User"] as Record<string, unknown>;
    expect(userSchema["type"]).toBe("object");
    const userProps = userSchema["properties"] as Record<string, unknown>;
    expect(userProps["email"]).toEqual({ type: "string", format: "email" });

    // The endpoint body references the schema by $ref.
    const op = (doc["paths"] as Record<string, Record<string, unknown>>)["/api/teams"]?.["post"] as Record<string, unknown>;
    const body = op["requestBody"] as Record<string, unknown>;
    const content = body["content"] as Record<string, Record<string, unknown>>;
    const json = content["application/json"] as Record<string, unknown>;
    const schema = json["schema"] as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties["owner"]).toEqual({ $ref: "#/components/schemas/User" });
  });

  test("without `schemaGraph` falls back to the `fields` path (no backward-compat break)", () => {
    // Spec without `schemaGraph` and with `fields` (legacy path): it
    // must still emit `properties` from `fields`, not from a
    // non-existent graph.
    const doc = buildOpenApiDocument(
      baseInput([
        spec("/api/users", "POST", {
          fields: [
            { fieldName: "name", location: "body", type: "string", required: true },
          ],
        }),
      ]),
    );

    const op = (doc["paths"] as Record<string, Record<string, unknown>>)["/api/users"]?.["post"] as Record<string, unknown>;
    const body = op["requestBody"] as Record<string, unknown>;
    const content = body["content"] as Record<string, Record<string, unknown>>;
    const json = content["application/json"] as Record<string, unknown>;
    const schema = json["schema"] as Record<string, unknown>;

    expect(schema["type"]).toBe("object");
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties["name"]).toEqual({ type: "string" });
    expect(schema["required"]).toEqual(["name"]);
  });
});

describe("SchemaGraph — utils", () => {
  test("enum node carries `enumValues` and `kind: 'enum'`", () => {
    const node = createEnumNode(["a", "b", "c"], "n:0", { name: "Color" });
    expect(node.kind).toBe("enum");
    expect(node.enumValues).toEqual(["a", "b", "c"]);
    expect(node.name).toBe("Color");
  });

  test("literal node carries `literal` and `kind: 'literal'`", () => {
    const node = createLiteralNode(42, "n:0");
    expect(node.kind).toBe("literal");
    expect(node.literal).toBe(42);
  });

  test("scalar node with constraints carries `format` and `minimum`", () => {
    const node = createScalarNode("integer", "n:0", {
      constraints: { format: "int32", minimum: 0, maximum: 120 },
      name: "Age",
    });
    expect(node.kind).toBe("scalar");
    expect(node.scalarType).toBe("integer");
    expect(node.constraints?.minimum).toBe(0);
    expect(node.constraints?.maximum).toBe(120);
    expect(node.constraints?.format).toBe("int32");
  });
});

describe("SchemaGraph — DTO round-trip (a00011 C-4)", () => {
  // We build a graph with three nodes: a `name` scalar, an `age`
  // scalar, and a root object that joins them. We use it to verify
  // that `toDTO` and `fromDTO` preserve content across the JSON
  // frontier.
  function buildRoundTripGraph(): ISchemaGraph {
    const nameId: SchemaNodeId = "n:0";
    const ageId: SchemaNodeId = "n:1";
    const rootId: SchemaNodeId = "n:2";
    return createSchemaGraph(
      new Map<SchemaNodeId, ISchemaNode>([
        [nameId, createScalarNode("string", nameId, { name: "Name" })],
        [ageId, createScalarNode("integer", ageId, { name: "Age" })],
        [
          rootId,
          createObjectNode(rootId, [
            { name: "name", node: nameId, required: true },
            { name: "age", node: ageId, required: false },
          ]),
        ],
      ]),
      rootId,
    );
  }

  test("Map → DTO → Map preserves all the nodes", () => {
    const graph = buildRoundTripGraph();
    const dto = toDTO(graph);

    // The DTO is a plain object — not a `Map`, no interface methods.
    // `Reflect.has` avoids the cast: what the interface forbids at
    // compile time, runtime corroborates.
    expect(dto).not.toBeInstanceOf(Map);
    expect(Reflect.has(dto, "toDTO")).toBe(false);

    // `nodes` is `ReadonlyArray<[id, node]>` with the three nodes.
    expect(dto.nodes).toHaveLength(3);
    expect(dto.root).toBe("n:2");

    // The round-trip rebuilds a graph with the same ids and nodes.
    const roundTripped = fromDTO(dto);
    expect(roundTripped.root).toBe(graph.root);
    expect(roundTripped.nodes.size).toBe(graph.nodes.size);
    for (const [id, node] of graph.nodes) {
      const back = roundTripped.nodes.get(id);
      expect(back).toBeDefined();
      expect(back?.kind).toBe(node.kind);
      expect(back?.name).toBe(node.name);
    }
  });

  test("JSON.stringify(toDTO(graph)) → JSON.parse → fromDTO preserves the graph", () => {
    const graph = buildRoundTripGraph();
    const dto = toDTO(graph);

    // JSON crossing: if the contract did not require DTO, this step
    // would lose all the nodes (a Map serializes as `{}`). With DTO,
    // they survive.
    const wire = JSON.stringify(dto);
    const parsed = JSON.parse(wire) as unknown;

    // Sanity: the JSON is not empty nor `{}`.
    expect(wire).not.toBe("{}");
    expect(typeof parsed).toBe("object");

    // We come back to the graph from the parsed JSON.
    const restored = fromDTO(parsed as Parameters<typeof fromDTO>[0]);
    expect(restored.root).toBe(graph.root);
    expect(restored.nodes.size).toBe(3);
    expect(restored.nodes.get("n:0")?.name).toBe("Name");
    expect(restored.nodes.get("n:1")?.scalarType).toBe("integer");
  });

  test("the rebuilt graph has `toDTO()` bound", () => {
    const graph = buildRoundTripGraph();
    const restored = fromDTO(toDTO(graph));

    // The interface requires `toDTO()`; the round-trip must return a
    // graph that satisfies it.
    expect(typeof restored.toDTO).toBe("function");
    const dto = restored.toDTO();
    expect(dto.root).toBe(graph.root);
    expect(dto.nodes).toHaveLength(3);
  });
});