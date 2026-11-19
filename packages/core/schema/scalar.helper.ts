/**
 * Scalar node constructors for the `SchemaGraph`.
 *
 * Three node kinds live in this file:
 *
 *   - `scalar`  — a primitive value (`string`, `integer`, …).
 *   - `enum`    — a value from a finite, declared set.
 *   - `literal` — a constant value, declared by its value.
 *
 * These are the "leaf" nodes: they have no children or references. The
 * rest of the graph (`object`, `array`, `union`, …) is built in
 * `build-schema-graph.helper.ts` with a builder, because they need to
 * register ids and keep a map of nodes under construction.
 *
 * The functions are **pure**: given the same input they return the same
 * node. That lets the builder try candidate ids before committing them,
 * and lets tests compare graphs by structural equality.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IScalarOptions,
  ISchemaConstraints,
  ISchemaNode,
  ScalarType,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/** Scalar type the contract accepts as `scalarType`. */
export type { ScalarType };

/**
 * Builds a `scalar` node.
 *
 * The id is provided by the caller: usually it comes from the
 * `SchemaGraphBuilder`, which keeps the single registry of nodes.
 * Passing ids from outside the builder would cause silent collisions.
 */
export function createScalarNode(
  scalarType: ScalarType,
  id: SchemaNodeId,
  options: IScalarOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "scalar",
    scalarType,
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
  };
}

/**
 * Builds an `enum` node.
 *
 * `values` is not validated here: the caller knows what they are
 * declaring, and an empty list is a real case (an `enum` declared in
 * code that the scanner did not populate). What is frozen is the
 * reference: an `enum` should not mutate after being built.
 */
export function createEnumNode(
  values: ReadonlyArray<string>,
  id: SchemaNodeId,
  options: IScalarOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "enum",
    enumValues: [...values],
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
  };
}

/**
 * Builds a `literal` node.
 *
 * `literal` is `unknown` because it accepts any JSON primitive value:
 * a `42`, a `"foo"`, a `true`, a `null`. What the exporter does with it
 * depends on the target format: JSON Schema renders it as
 * `{ const: <value> }`.
 */
export function createLiteralNode(
  literal: unknown,
  id: SchemaNodeId,
): ISchemaNode {
  return { id, kind: "literal", literal };
}

/**
 * Translates the constraints of an `IValidationSpec` to `ISchemaConstraints`.
 *
 * Constraints live **outside the node**: a `scalar` node carries its
 * type (`string`, `integer`…) and this object carries the adornments
 * (`format`, `minimum`, `pattern`…). Separating them makes clear that
 * they are orthogonal, and that `flatten-helper` can treat constraints
 * as metadata without walking the graph.
 *
 * Returns `undefined` if there are no constraints: `ISchemaNode`
 * distinguishes between "has no constraints" and "has empty
 * constraints", and we respect that distinction here.
 */
export function constraintsFromValidationSpec(
  spec: IValidationSpec,
): ISchemaConstraints | undefined {
  const out: { -readonly [K in keyof ISchemaConstraints]: ISchemaConstraints[K] } = {};
  if (spec.format !== undefined) out["format"] = spec.format;
  if (spec.minimum !== undefined) out["minimum"] = spec.minimum;
  if (spec.maximum !== undefined) out["maximum"] = spec.maximum;
  if (spec.minLength !== undefined) out["minLength"] = spec.minLength;
  if (spec.maxLength !== undefined) out["maxLength"] = spec.maxLength;
  if (spec.pattern !== undefined) out["pattern"] = spec.pattern;
  return Object.keys(out).length > 0 ? out : undefined;
}