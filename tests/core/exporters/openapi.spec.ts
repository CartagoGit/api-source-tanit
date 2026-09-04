/**
 * Tests del OpenAPI exporter centrados en nulabilidad 3.1 (a00011 C-4).
 *
 * OpenAPI 3.1 usa JSON Schema 2020-12: `nullable: true` (la forma de
 * OpenAPI 3.0) está deprecado. La nulabilidad se modela así:
 *
 *   - **Escalares** (`scalar`/`enum`/`literal`): `type: [T, "null"]`.
 *   - **Compuestos** (`object`/`array`/`union`/`intersection`):
 *     `oneOf: [{...inner}, { type: "null" }]`.
 *   - **References**: igual que compuestos (envuelto en `oneOf`).
 *
 * Estos tests comprueban que el exporter de `packages/core/exporters/
 * openapi.exporter.ts` aplica esa traducción, y que **nunca** emite
 * `nullable: true` (regresión no-regresión).
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

/** Helper para extraer el `schema` del requestBody de un endpoint. */
function extractRequestSchema(doc: Record<string, unknown>, path: string, method: string): Record<string, unknown> {
  const paths = doc["paths"] as Record<string, Record<string, unknown>>;
  const op = paths[path]?.[method] as Record<string, unknown>;
  const body = op["requestBody"] as Record<string, unknown>;
  const content = body["content"] as Record<string, Record<string, unknown>>;
  const json = content["application/json"] as Record<string, unknown>;
  return json["schema"] as Record<string, unknown>;
}

describe("OpenAPI exporter — nulabilidad 3.1 (a00011 C-4)", () => {
  test("`nullable` envolviendo `scalar: string` emite `type: ['string', 'null']`", () => {
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

    // Forma 3.1: type array, no `nullable: true`.
    expect(nick["type"]).toEqual(["string", "null"]);
    expect(nick["nullable"]).toBeUndefined();
  });

  test("`nullable` envolviendo `scalar: integer` emite `type: ['integer', 'null']`", () => {
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

  test("`nullable` envolviendo `object` emite `type: ['object', 'null']` con `properties` preservadas", () => {
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

    // JSON Schema 2020-12 (OpenAPI 3.1) admite `type: ["object", "null"]`
    // igual que para escalares: el array de tipos cubre cualquier
    // combinación, incluido `object + null`. La forma `oneOf` también
    // sería válida, pero `type: [...]` es la más compacta y la que
    // prefiere esta implementación cuando el inner tiene `type`
    // escalar.
    expect(address["type"]).toEqual(["object", "null"]);
    expect(address["nullable"]).toBeUndefined();
    expect(address["oneOf"]).toBeUndefined();

    const innerProps = address["properties"] as Record<string, unknown>;
    expect(innerProps["street"]).toEqual({ type: "string" });
  });

  test("`nullable` envolviendo `union` emite `oneOf` con el union + `null`", () => {
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

    // La primera rama es el `oneOf` del union (string | integer).
    const unionBranch = oneOf[0] as Record<string, unknown>;
    const unionOneOf = unionBranch["oneOf"] as ReadonlyArray<Record<string, unknown>>;
    expect(unionOneOf).toHaveLength(2);
    expect(unionOneOf[0]).toEqual({ type: "string" });
    expect(unionOneOf[1]).toEqual({ type: "integer" });

    // La segunda rama es la nulabilidad.
    expect(oneOf[1]).toEqual({ type: "null" });
  });

  test("`nullable` envolviendo `enum` emite `type: ['string', 'null']` con `enum` preservado", () => {
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

    // `enum` se serializa como `{ type: "string", enum: [...] }`.
    // El exporter lo trata como escalar (type === "string"), así que
    // la nulabilidad va como `type: ["string", "null"]` y conserva el
    // `enum`.
    expect(color["type"]).toEqual(["string", "null"]);
    expect(color["nullable"]).toBeUndefined();
    expect(color["enum"]).toEqual(["red", "green", "blue"]);
  });

  test("`nullable` envolviendo `array` emite `type: ['array', 'null']` con `items` preservado", () => {
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

    // Igual que para `object`: el `type` del inner es "array" (string),
    // así que la nulabilidad va como `type: ["array", "null"]`.
    expect(tags["type"]).toEqual(["array", "null"]);
    expect(tags["nullable"]).toBeUndefined();
    expect(tags["oneOf"]).toBeUndefined();
    expect(tags["items"]).toEqual({ type: "string" });
  });

  test("ningún documento OpenAPI del lote emite `nullable: true` (regresión no-regresión)", () => {
    // Casos que en 3.0 habrían emitido `nullable: true`. Comprobamos
    // que **ninguno** lo hace ya, en cualquier rama del exporter.
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

    // Recorremos el documento en busca de `nullable: true` (lo
    // prohibimos en cualquier nivel, incluido `components.schemas`).
    const yaml = JSON.stringify(doc);
    expect(yaml).not.toMatch(/"nullable"\s*:\s*true/);
  });

  test("`nullable` sin `inner` cae a `{ type: 'null' }` (grafo incompleto)", () => {
    // Defensa: si el grafo está roto (un `nullable` sin `inner`), el
    // exporter no debe lanzar — debe emitir algo honesto.
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
    // `inner` faltante → emitNullable devuelve `{ type: "null" }`.
    // El exporter no lanza y la salida es 3.1 válida.
    expect(x["nullable"]).toBeUndefined();
    expect(x).toEqual({ type: "null" });
  });

  test("campos sin `nullable` siguen emitiendo su esquema normal (no-regresión)", () => {
    // Sanity: con un grafo sin nodos `nullable`, el exporter no añade
    // composición 3.1 espuria. Usamos un escalar sin `name` para que
    // se inlinee (los escalares con nombre van a `components.schemas`
    // como `$ref`, que es otra vía válida pero no la que queremos
    // comprobar aquí).
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

    // Sin envolver: el campo es `{ type: "string" }` directo.
    expect(email).toEqual({ type: "string" });
    expect(email["nullable"]).toBeUndefined();
    expect(email["oneOf"]).toBeUndefined();
  });
});
describe("OpenAPI exporter — auth per-op override (audit 2026-09-04 P1 #7)", () => {
  test("spec.auth = { kind: 'none' } emite security: [] a nivel de operación", () => {
    const doc = buildOpenApiDocument(
      baseInput([
        spec("/api/login", "POST", { auth: { kind: "none" } }),
        spec("/api/users", "GET"),
      ]),
    );

    // El documento declara seguridad global `none` por el baseInput,
    // así que el endpoint con auth: { kind: "none" } debe llevar
    // `security: []` explícito (override por operación).
    const paths = doc["paths"] as Record<string, Record<string, unknown>>;
    const login = paths["/api/login"]?.["post"] as Record<string, unknown>;
    expect(login["security"]).toEqual([]);

    // El otro endpoint sin override debe respetar el esquema global
    // (en este caso baseInput pone auth: { type: "none" } así que
    // hereda eso; lo importante es que NO tiene `security: []`
    // explícito por-op).
    const users = paths["/api/users"]?.["get"] as Record<string, unknown>;
    expect(users["security"]).toBeUndefined();
  });

  test("override per-op con auth { kind: 'none' } desactiva bearer global", () => {
    // Caso real del audit: la colección tiene auth global bearer,
    // pero /auth/login debe ser público.
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
