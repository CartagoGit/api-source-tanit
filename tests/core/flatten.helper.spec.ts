/**
 * `packages/core/schema/flatten.helper.ts` — flatten a `SchemaGraph`
 * into `IEndpointField[]`.
 *
 * The flatten turns every node kind (`scalar`, `enum`, `literal`,
 * `object`, `array`, `tuple`, `union`, `intersection`, `reference`,
 * `nullable`) into zero or more `IEndpointField`s. The result feeds
 * legacy exporters that still consume the flat list (notably the
 * Postman collection); the graph is the source of truth.
 *
 * This spec covers every branch of the switch — the file was almost
 * entirely uncovered — so the cyclomatic cost of the helper is no
 * longer a blind spot. Each test pins down one node kind and what it
 * produces.
 */
import { describe, expect, test } from "vitest";

import {
  flatten,
  flattenFrom,
} from "../../packages/core/schema/flatten.helper";
import { createSchemaGraph } from "../../packages/core/schema/serialize.helper";
import type {
  ISchemaConstraints,
  ISchemaNode,
} from "../../packages/contracts/interfaces/core/schema.interface";

/**
 * Build a graph from a list of nodes. Helpers write the root id last
 * because it must exist in `nodes` for the helpers to traverse.
 */
function graph(
  root: string,
  nodes: ReadonlyArray<ISchemaNode>,
): ReturnType<typeof createSchemaGraph> {
  return createSchemaGraph(new Map(nodes.map((n) => [n.id, n])), root);
}

const scalar = (id: string, name: string, type: NonNullable<ISchemaNode["scalarType"]>): ISchemaNode => ({
  id,
  kind: "scalar",
  name,
  scalarType: type,
});

const enm = (id: string, name: string, values: ReadonlyArray<string>): ISchemaNode => ({
  id,
  kind: "enum",
  name,
  enumValues: values,
});

const literal = (id: string, name: string): ISchemaNode => ({
  id,
  kind: "literal",
  name,
});

const objectNode = (
  id: string,
  name: string,
  children: ReadonlyArray<{ name: string; node: string; required?: boolean }>,
): ISchemaNode => ({
  id,
  kind: "object",
  name,
  children: children.map((c) => ({
    name: c.name,
    node: c.node,
    ...(c.required !== undefined ? { required: c.required } : {}),
  })),
});

const arrayNode = (
  id: string,
  name: string,
  item: string | null,
): ISchemaNode => ({
  id,
  kind: "array",
  name,
  ...(item !== null
    ? {
        children: [{ name: "items", node: item }],
      }
    : {}),
});

const tupleNode = (
  id: string,
  name: string,
  parts: ReadonlyArray<{ name: string; node: string }>,
): ISchemaNode => ({
  id,
  kind: "tuple",
  name,
  children: parts.map((p) => ({ name: p.name, node: p.node })),
});

const unionNode = (
  id: string,
  alts: ReadonlyArray<string>,
): ISchemaNode => ({
  id,
  kind: "union",
  alternatives: alts,
});

const intersectionNode = (
  id: string,
  alts: ReadonlyArray<string>,
): ISchemaNode => ({
  id,
  kind: "intersection",
  alternatives: alts,
});

const refNode = (id: string, ref: string): ISchemaNode => ({
  id,
  kind: "reference",
  ref,
});

const nullableNode = (id: string, inner: string | null): ISchemaNode => ({
  id,
  kind: "nullable",
  ...(inner !== null ? { inner } : {}),
});

describe("flatten — happy paths", () => {
  test("returns the root node's flatten when only the graph root exists", () => {
    const g = graph("r", [scalar("r", "name", "string")]);
    expect(flatten(g, "body")).toEqual([
      { fieldName: "name", location: "body", type: "string", required: false },
    ]);
  });

  test("an object is walked and each child becomes a field", () => {
    const g = graph("o", [
      objectNode("o", "obj", [
        { name: "first", node: "a" },
        { name: "second", node: "b" },
      ]),
      scalar("a", "a", "string"),
      scalar("b", "b", "integer"),
    ]);
    const fields = flatten(g, "body");
    expect(fields).toEqual([
      { fieldName: "first", location: "body", type: "string", required: false },
      { fieldName: "second", location: "body", type: "integer", required: false },
    ]);
  });

  test("an enum becomes a single enum field", () => {
    const g = graph("e", [enm("e", "color", ["red", "blue"])]);
    expect(flatten(g, "query")).toEqual([
      {
        fieldName: "color",
        location: "query",
        type: "enum",
        required: false,
        enumValues: ["red", "blue"],
      },
    ]);
  });

  test("a literal falls back to a string field with required=false", () => {
    const g = graph("l", [literal("l", "tag")]);
    expect(flatten(g, "body")).toEqual([
      { fieldName: "tag", location: "body", type: "string", required: false },
    ]);
  });

  test("a tuple emits each component with a positional prefix", () => {
    const g = graph("t", [
      tupleNode("t", "pair", [
        { name: "0", node: "a" },
        { name: "1", node: "b" },
      ]),
      scalar("a", "a", "string"),
      scalar("b", "b", "string"),
    ]);
    const fields = flatten(g, "body");
    expect(fields.map((f) => f.fieldName)).toEqual([
      "0.a",
      "1.b",
    ]);
  });

  test("a union flattens each alternative", () => {
    const g = graph("u", [
      unionNode("u", ["a", "b"]),
      scalar("a", "a", "string"),
      scalar("b", "b", "integer"),
    ]);
    expect(flatten(g, "body").map((f) => f.type)).toEqual(["string", "integer"]);
  });

  test("an intersection flattens each alternative (same shape as union)", () => {
    const g = graph("i", [
      intersectionNode("i", ["a", "b"]),
      scalar("a", "a", "boolean"),
      scalar("b", "b", "date"),
    ]);
    expect(flatten(g, "body").map((f) => f.type)).toEqual(["boolean", "date"]);
  });

  test("a reference is followed to the target node", () => {
    const g = graph("ref", [refNode("ref", "tgt"), scalar("tgt", "target", "string")]);
    expect(flatten(g, "body")).toEqual([
      {
        fieldName: "target",
        location: "body",
        type: "string",
        required: false,
      },
    ]);
  });

  test("a reference with no matching target returns []", () => {
    const g = graph("ref", [refNode("ref", "missing")]);
    expect(flatten(g, "body")).toEqual([]);
  });

  test("nullable without an inner returns []", () => {
    const g = graph("n", [nullableNode("n", null)]);
    expect(flatten(g, "body")).toEqual([]);
  });

  test("nullable wraps a node and marks the result not required", () => {
    const g = graph("n", [
      nullableNode("n", "s"),
      scalar("s", "s", "string"),
    ]);
    const [field] = flatten(g, "body");
    expect(field).toBeDefined();
    expect(field?.required).toBe(false);
  });

  test("array with no item emits a single placeholder field of type array", () => {
    const g = graph("a", [arrayNode("a", "list", null)]);
    expect(flatten(g, "body")).toEqual([
      {
        fieldName: "list",
        location: "body",
        type: "array",
        required: false,
      },
    ]);
  });

  test("array with an item prefixes every emitted field with `items.`", () => {
    const g = graph("a", [
      arrayNode("a", "list", "s"),
      scalar("s", "name", "string"),
    ]);
    expect(flatten(g, "body")).toEqual([
      {
        fieldName: "items.name",
        location: "body",
        type: "string",
        required: false,
      },
    ]);
  });
});

describe("flatten — defensive branches", () => {
  test("a cycle is cut and reported as a string `<cycle>` field", () => {
    const g = graph("a", [refNode("a", "a")]);
    expect(flatten(g, "body")).toEqual([
      {
        fieldName: "<cycle>",
        location: "body",
        type: "string",
        required: false,
      },
    ]);
  });

  test("flattenFrom with a missing root id returns []", () => {
    const g = graph("real", [scalar("real", "x", "string")]);
    expect(flattenFrom(g, "missing", "body")).toEqual([]);
  });

  test("an object whose child reference points to a missing node emits nothing", () => {
    const g = graph("o", [
      objectNode("o", "obj", [{ name: "broken", node: "absent" }]),
    ]);
    expect(flatten(g, "body")).toEqual([]);
  });

  test("an object with `required:true` propagates to the emitted field", () => {
    const g = graph("o", [
      objectNode("o", "obj", [{ name: "first", node: "a", required: true }]),
      scalar("a", "a", "string"),
    ]);
    const [field] = flatten(g, "body");
    expect(field?.required).toBe(true);
  });

  test("constraints are applied to the field (format / min / max / pattern)", () => {
    const constraints: ISchemaConstraints = {
      format: "email",
      minimum: 0,
      maximum: 100,
      minLength: 1,
      maxLength: 50,
    };
    const g = graph("r", [
      { ...scalar("r", "age", "string"), constraints },
    ]);
    const [field] = flatten(g, "body");
    expect(field).toEqual({
      fieldName: "age",
      location: "body",
      type: "string",
      required: false,
      format: "email",
      minimum: 0,
      maximum: 100,
      minLength: 1,
      maxLength: 50,
    });
  });

  test("enum constraints are applied too", () => {
    const g = graph("e", [
      {
        ...enm("e", "kind", ["a", "b"]),
        constraints: { format: "uuid" },
      },
    ]);
    const [field] = flatten(g, "body");
    expect(field?.format).toBe("uuid");
  });

  test("a scalar without a name falls back to `<scalar>`", () => {
    const g = graph("s", [{ id: "s", kind: "scalar", scalarType: "string" }]);
    expect(flatten(g, "body")[0]?.fieldName).toBe("<scalar>");
  });

  test("a scalar without a `scalarType` falls back to `any`", () => {
    const g = graph("s", [{ id: "s", kind: "scalar", name: "x" }]);
    expect(flatten(g, "body")[0]?.type).toBe("any");
  });
});