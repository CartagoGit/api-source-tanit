/**
 * `graphAndFieldsAreConsistent` tests (r00016 S2).
 *
 * Pins the three branches the helper documents:
 *
 *   (1) Both sides empty → true (nothing to drift).
 *   (2) Graph only (scanner hasn't migrated `fields`) → true.
 *   (3) Fields only (legacy scanner with no graph) → true.
 *   (4) Graph + fields where every (name, location, type)
 *       agrees → true.
 *   (5) Graph + fields where the graph has an extra field
 *       that `fields` doesn't → false.
 *   (6) Graph + fields where a field's type disagrees
 *       between the two → false.
 */
import { describe, expect, test } from "vitest";

import {
  graphAndFieldsAreConsistent,
} from "../../packages/core/helpers/schema-flatten.helper";
import type { ISchemaGraph } from "../../packages/contracts/interfaces/core/schema.interface";
import type { IEndpointField } from "../../packages/contracts/interfaces/core/postman.interface";

function buildGraph(): ISchemaGraph {
  const map = new Map<import("../../packages/contracts/interfaces/core/schema.interface").SchemaNodeId, import("../../packages/contracts/interfaces/core/schema.interface").ISchemaNode>();
  map.set("root", {
    id: "root",
    kind: "object",
    children: [
      { name: "name", node: "name", required: true },
      { name: "age", node: "age", required: false },
    ],
  });
  map.set("name", { id: "name", kind: "scalar", scalarType: "string" });
  map.set("age", { id: "age", kind: "scalar", scalarType: "integer" });
  return {
    nodes: map,
    root: "root",
    toDTO() {
      return { nodes: Array.from(map.entries()), root: "root" };
    },
  };
}

const GRAPH = buildGraph();

function field(name: string, type: string): IEndpointField {
  return {
    fieldName: name,
    type,
    location: "body",
    required: false,
  };
}

describe("graphAndFieldsAreConsistent (r00016 S2)", () => {
  test("(1) both sides empty → true", () => {
    expect(graphAndFieldsAreConsistent({})).toBe(true);
  });

  test("(2) graph only → true", () => {
    expect(graphAndFieldsAreConsistent({ schemaGraph: GRAPH })).toBe(true);
  });

  test("(3) fields only → true", () => {
    expect(
      graphAndFieldsAreConsistent({ fields: [field("x", "string")] }),
    ).toBe(true);
  });

  test("(4) graph + fields where both agree → true", () => {
    expect(
      graphAndFieldsAreConsistent({
        fields: [
          field("name", "string"),
          field("age", "integer"),
        ],
        schemaGraph: GRAPH,
      }),
    ).toBe(true);
  });

  test("(5) graph + fields where graph has an extra field → false", () => {
    expect(
      graphAndFieldsAreConsistent({
        fields: [field("name", "string")],
        schemaGraph: GRAPH,
      }),
    ).toBe(false);
  });

  test("(6) graph + fields with a type mismatch → false", () => {
    expect(
      graphAndFieldsAreConsistent({
        fields: [field("name", "string"), field("age", "string")],
        schemaGraph: GRAPH,
      }),
    ).toBe(false);
  });
});
