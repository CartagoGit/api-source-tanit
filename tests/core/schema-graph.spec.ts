/**
 * Tests del `SchemaGraph` (a00010 S6).
 *
 * Cubre los seis casos que pidió la propuesta: object/array/union/
 * reference/flatten/OpenAPI. El grafo se construye con los helpers
 * puros (`createObjectNode`, `createArrayNode`, etc.) y se enchufa al
 * OpenAPI exporter por la vía de `EndpointSpec.schemaGraph`.
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
import {
  createEnumNode,
  createLiteralNode,
  createScalarNode,
} from "../../packages/core/schema/scalar.helper";
import { createUnionNode } from "../../packages/core/schema/union.helper";
import type { IExportInput } from "../../packages/contracts/interfaces/core/export-target.interface";

/** Construye un `EndpointSpec` mínimo válido para el exporter. */
function spec(uri: string, method: EndpointSpec["method"], extra: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    name: `Spec ${method} ${uri}`,
    method,
    uri,
    ...extra,
  };
}

/** Input base para `buildOpenApiDocument`. */
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

describe("SchemaGraph — nodos", () => {
  test("object con dos campos serializa a JSON con `id`, `kind` y `children`", () => {
    const nameId: SchemaNodeId = "n:0";
    const ageId: SchemaNodeId = "n:1";
    const root: SchemaNodeId = "n:2";
    const graph: ISchemaGraph = {
      root,
      nodes: new Map<SchemaNodeId, ISchemaNode>([
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
    };

    // El nodo raíz es un `object` con dos `children`.
    const rootNode = graph.nodes.get(root);
    expect(rootNode?.kind).toBe("object");
    expect(rootNode?.children).toHaveLength(2);
    expect(rootNode?.children?.[0]?.name).toBe("name");
    expect(rootNode?.children?.[0]?.required).toBe(true);
    expect(rootNode?.children?.[1]?.name).toBe("age");
    expect(rootNode?.children?.[1]?.required).toBe(false);

    // JSON-serializable: el contrato es que sea plain-data.
    const json = JSON.stringify({
      root,
      nodes: Array.from(graph.nodes.entries()),
    });
    const roundtrip = JSON.parse(json);
    expect(roundtrip.nodes).toHaveLength(3);
    expect(roundtrip.root).toBe(root);
  });

  test("array con `items` apunta a otro nodo por id", () => {
    const itemId: SchemaNodeId = "n:0";
    const arrayId: SchemaNodeId = "n:1";
    const graph: ISchemaGraph = {
      root: arrayId,
      nodes: new Map<SchemaNodeId, ISchemaNode>([
        [itemId, createScalarNode("string", itemId)],
        [
          arrayId,
          createArrayNode(arrayId, itemId, { name: "Tags" }),
        ],
      ]),
    };

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

  test("union con dos alternativas registra ambos ids", () => {
    const altA: SchemaNodeId = "n:0";
    const altB: SchemaNodeId = "n:1";
    const unionId: SchemaNodeId = "n:2";
    const graph: ISchemaGraph = {
      root: unionId,
      nodes: new Map<SchemaNodeId, ISchemaNode>([
        [altA, createScalarNode("string", altA)],
        [altB, createScalarNode("integer", altB)],
        [
          unionId,
          createUnionNode([altA, altB], unionId, { name: "StringOrNumber" }),
        ],
      ]),
    };

    const union = graph.nodes.get(unionId);
    expect(union?.kind).toBe("union");
    expect(union?.alternatives).toEqual([altA, altB]);
    expect(union?.name).toBe("StringOrNumber");

    // Las alternativas existen y son nodos distintos.
    expect(graph.nodes.get(altA)?.scalarType).toBe("string");
    expect(graph.nodes.get(altB)?.scalarType).toBe("integer");
  });

  test("reference se resuelve devolviendo el nodo destino", () => {
    const userId: SchemaNodeId = "n:0";
    const refId: SchemaNodeId = "n:1";
    const graph: ISchemaGraph = {
      root: refId,
      nodes: new Map<SchemaNodeId, ISchemaNode>([
        [
          userId,
          createObjectNode(userId, [], { name: "User" }),
        ],
        [
          refId,
          createReferenceNode(userId, refId, { name: "SelfRef" }),
        ],
      ]),
    };

    const ref = graph.nodes.get(refId);
    expect(ref?.kind).toBe("reference");
    expect(ref?.ref).toBe(userId);

    // `resolveReference` devuelve el nodo destino.
    const target = graph.nodes.get(ref?.ref ?? "");
    expect(target?.kind).toBe("object");
    expect(target?.name).toBe("User");
  });
});

describe("SchemaGraph — flatten-helper", () => {
  test("apana un object con dos escalares a un array de IEndpointField", () => {
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

  test("apana un enum preservando `enumValues`", () => {
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
  test("con `schemaGraph` produce `properties` y `required`", () => {
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

  test("un nodo con `name` produce `$ref` y entrada en `components.schemas`", () => {
    const userId: SchemaNodeId = "n:0";
    const refId: SchemaNodeId = "n:1";
    const root: SchemaNodeId = "n:2";
    const graph: ISchemaGraph = {
      root,
      nodes: new Map<SchemaNodeId, ISchemaNode>([
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
    };

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

    // El body del endpoint referencia el esquema por $ref.
    const op = (doc["paths"] as Record<string, Record<string, unknown>>)["/api/teams"]?.["post"] as Record<string, unknown>;
    const body = op["requestBody"] as Record<string, unknown>;
    const content = body["content"] as Record<string, Record<string, unknown>>;
    const json = content["application/json"] as Record<string, unknown>;
    const schema = json["schema"] as Record<string, unknown>;
    const properties = schema["properties"] as Record<string, unknown>;
    expect(properties["owner"]).toEqual({ $ref: "#/components/schemas/User" });
  });

  test("sin `schemaGraph` cae al camino de `fields` (no rompe retrocompat)", () => {
    // Spec sin `schemaGraph` y con `fields` (camino legacy): debe
    // seguir emitiendo `properties` desde `fields`, no desde un grafo
    // inexistente.
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
  test("enum node lleva `enumValues` y `kind: 'enum'`", () => {
    const node = createEnumNode(["a", "b", "c"], "n:0", { name: "Color" });
    expect(node.kind).toBe("enum");
    expect(node.enumValues).toEqual(["a", "b", "c"]);
    expect(node.name).toBe("Color");
  });

  test("literal node lleva `literal` y `kind: 'literal'`", () => {
    const node = createLiteralNode(42, "n:0");
    expect(node.kind).toBe("literal");
    expect(node.literal).toBe(42);
  });

  test("scalar node con constraints lleva `format` y `minimum`", () => {
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