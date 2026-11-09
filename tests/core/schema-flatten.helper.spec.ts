/**
 * `fieldsFromGraph` — SchemaGraph → flat field list.
 *
 * r00016 S1: the first step of migrating `EndpointSpec.fields`
 * from a parallel source to a view derived from `schemaGraph`.
 *
 * These tests pin every shape the helper supports and document
 * what it does NOT do (union/intersection/tuple collapse to a
 * single leaf; cross-graph `$ref` becomes a sentinel).
 */
import { describe, expect, test } from "vitest";

import { fieldsFromGraph } from "../../packages/core/helpers/schema-flatten.helper";
import type {
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../packages/contracts/interfaces/core/schema.interface";

/**
 * Build a tiny `SchemaGraph` from a flat list of nodes + a root
 * id. Keeps test setup short; the helper itself walks whatever
 * shape the graph has.
 */
function buildGraph(
  rootId: SchemaNodeId,
  nodes: ReadonlyArray<ISchemaNode>,
): ISchemaGraph {
  const map = new Map<SchemaNodeId, ISchemaNode>();
  for (const n of nodes) map.set(n.id, n);
  return {
    nodes: map,
    root: rootId,
    toDTO() {
      return { nodes: Array.from(map.entries()), root: rootId };
    },
  };
}

describe("r00016 S1 — fieldsFromGraph", () => {
  test("a single scalar root becomes one field", () => {
    const graph = buildGraph("root", [
      { id: "root", kind: "scalar", scalarType: "string" },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      fieldName: "(root)",
      location: "body",
      type: "string",
      required: false,
    });
  });

  test("an object root produces one entry per child, with `path` style names", () => {
    const graph = buildGraph("root", [
      {
        id: "root",
        kind: "object",
        children: [
          { name: "name", node: "n_name", required: true },
          { name: "age", node: "n_age" },
        ],
      },
      { id: "n_name", kind: "scalar", scalarType: "string" },
      { id: "n_age", kind: "scalar", scalarType: "integer" },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields.map((f) => f.fieldName).sort()).toEqual(["age", "name"]);
    const name = fields.find((f) => f.fieldName === "name")!;
    expect(name.required).toBe(true);
    expect(name.type).toBe("string");
  });

  test("nested objects join names with `.`", () => {
    const graph = buildGraph("root", [
      {
        id: "root",
        kind: "object",
        children: [{ name: "address", node: "addr", required: true }],
      },
      {
        id: "addr",
        kind: "object",
        children: [{ name: "street", node: "street" }],
      },
      { id: "street", kind: "scalar", scalarType: "string" },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.fieldName).toBe("address.street");
    // The `street` field itself has no `required: true` on its edge,
    // so even though the parent `address` is required, the leaf
    // stays optional. OpenAPI: presence of the parent does not
    // make every child required.
    expect(fields[0]!.required).toBe(false);
  });

  test("arrays flatten to one slot field suffixed `[]`", () => {
    const graph = buildGraph("root", [
      {
        id: "root",
        kind: "array",
        children: [{ name: "items", node: "string" }],
      },
      { id: "string", kind: "scalar", scalarType: "string" },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields).toHaveLength(1);
    // The root is `array`, so the path prefix stays empty — the
    // helper joins items with `[]`.
    expect(fields[0]!.fieldName).toBe("[]");
    expect(fields[0]!.type).toBe("string");
  });

  test("enums carry their values", () => {
    const graph = buildGraph("root", [
      {
        id: "root",
        kind: "enum",
        enumValues: ["admin", "user", "guest"],
      },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields[0]!.type).toBe("enum");
    expect(fields[0]!.enumValues).toEqual(["admin", "user", "guest"]);
  });

  test("scalar constraints (format, min/max, pattern) propagate", () => {
    const graph = buildGraph("root", [
      {
        id: "root",
        kind: "scalar",
        scalarType: "string",
        constraints: { format: "email", minLength: 3, maxLength: 100 },
      },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields[0]).toMatchObject({
      format: "email",
      minLength: 3,
      maxLength: 100,
    });
  });

  test("local $ref resolves and walks the target", () => {
    const graph = buildGraph("root", [
      {
        id: "root",
        kind: "reference",
        ref: "User",
      },
      {
        id: "User",
        kind: "object",
        children: [{ name: "id", node: "id" }],
      },
      { id: "id", kind: "scalar", scalarType: "string" },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.fieldName).toBe("id");
  });

  test("cross-graph $ref becomes a sentinel leaf", () => {
    // The ref points to an id that is NOT in this graph.
    const graph = buildGraph("root", [
      { id: "root", kind: "reference", ref: "external.User" },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.type).toContain("external.User");
  });

  test("nullable wraps and is encoded via `required: false`", () => {
    const graph = buildGraph("root", [
      {
        id: "root",
        kind: "object",
        children: [{ name: "nickname", node: "n" }],
      },
      { id: "n", kind: "nullable", inner: "s" },
      { id: "s", kind: "scalar", scalarType: "string" },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.fieldName).toBe("nickname");
    expect(fields[0]!.type).toBe("string");
    expect(fields[0]!.required).toBe(false);
  });

  test("union/intersection/tuple collapse to a leaf with the kind as `type`", () => {
    const graph = buildGraph("root", [
      { id: "root", kind: "union", alternatives: ["a", "b"] },
    ]);
    const fields = fieldsFromGraph(graph);
    expect(fields[0]!.type).toBe("union");
  });

  test("cycles deeper than DEFAULT_MAX_DEPTH collapse to `object`", () => {
    // Manually build a self-referential cycle.
    const root: ISchemaNode = {
      id: "root",
      kind: "object",
      children: [{ name: "self", node: "root" }],
    };
    const graph = buildGraph("root", [root]);
    const fields = fieldsFromGraph(graph);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.type).toBe("object");
  });
});
