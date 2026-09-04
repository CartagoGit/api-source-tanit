/**
 * Flatten a `SchemaGraph` into the flat `IEndpointField[]` list.
 *
 * Exporters that cannot yet consume the graph (the Postman collection,
 * for example) need a field list per endpoint. Until now that list
 * came from `IValidationSpec[]` per scanner; with `SchemaGraph` in
 * play, the source is the graph and the flattening is this helper.
 *
 * ## What it is **not**
 *
 * It is not a faithful translation: the graph can express things the
 * flat list cannot (nested objects as a type, tuples, unions). The
 * flatten emits what fits —one field per reachable scalar— and gives
 * up the rest. Its purpose is to **not break** legacy exporters while
 * scanners migrate to the graph, not to be the source of truth.
 *
 * ## Shape of the result
 *
 * The resulting array has the same shape as `EndpointSpec.fields`:
 * each element is `IEndpointField` with `fieldName`, `type`, and
 * `required`. Composite nodes (`object`, `array`, `union`,
 * `intersection`) are **walked** and produce several `IEndpointField`.
 * `reference` nodes are **followed** and what they point to is
 * flattened. `literal` and `nullable` nodes are **emitted as string**,
 * which is the closest type in the flat list.
 *
 * Cycles in `reference` are cut: if a node references a node we are
 * already visiting, we emit a single scalar `string` field with
 * `required: false` and keep going. Without that, a recursive model
 * (`User.parent: User`) would exhaust the stack.
 */
import type { IEndpointField } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  ISchemaConstraints,
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";
import { resolveReference } from "./reference.helper.js";

/** Default location for the flattening (`IEndpointField` requires it). */
type TFieldLocation = IEndpointField["location"];

/**
 * Flattens the graph starting from its root.
 *
 * Shortcut for `flattenFrom(graph, graph.root, "body")`.
 */
export function flatten(
  graph: ISchemaGraph,
  location: TFieldLocation = "body",
): IEndpointField[] {
  return flattenFrom(graph, graph.root, location);
}

/**
 * Flattens a subgraph starting at a specific node.
 *
 * `rootId` must be in `graph.nodes`. If it is not, returns `[]`: the
 * graph does not contain the root, so there is nothing to flatten.
 *
 * `location` is the location assigned to the emitted fields. The same
 * graph can be flattened once with `body` and once with `query` if the
 * caller cares (not the case today, but the function accepts it without
 * cost).
 */
export function flattenFrom(
  graph: ISchemaGraph,
  rootId: SchemaNodeId,
  location: TFieldLocation,
): IEndpointField[] {
  const visiting = new Set<SchemaNodeId>();
  return visit(graph, rootId, location, visiting);
}

function visit(
  graph: ISchemaGraph,
  nodeId: SchemaNodeId,
  location: TFieldLocation,
  visiting: Set<SchemaNodeId>,
): IEndpointField[] {
  if (visiting.has(nodeId)) {
    // Cycle: we cut with an opaque string field. The full information
    // stays in the graph, where the exporter that knows how to read it
    // can detect it.
    return [stringField("<cycle>", location, false)];
  }
  const node = graph.nodes.get(nodeId);
  if (!node) return [];
  visiting.add(nodeId);
  try {
    return visitNode(graph, node, location, visiting);
  } finally {
    visiting.delete(nodeId);
  }
}

function visitNode(
  graph: ISchemaGraph,
  node: ISchemaNode,
  location: TFieldLocation,
  visiting: Set<SchemaNodeId>,
): IEndpointField[] {
  switch (node.kind) {
    case "scalar":
      return [scalarField(node, location)];
    case "enum":
      return [enumField(node, location)];
    case "literal":
      // The flat list has no literal; we fall back to `string`.
      return [stringField(node.name ?? "<literal>", location, false)];
    case "object":
      return (node.children ?? []).flatMap((edge) =>
        visit(graph, edge.node, location, visiting).map((f) => ({
          ...f,
          fieldName: edge.name,
          required: edge.required ?? f.required,
        })),
      );
    case "array": {
      const itemEdge = (node.children ?? [])[0];
      if (!itemEdge) {
        return [
          {
            fieldName: node.name ?? "<array>",
            location,
            type: "array",
            required: false,
          },
        ];
      }
      // We flatten the item with the `items.<field>` prefix so it does
      // not clash with parent fields if any.
      return visit(graph, itemEdge.node, location, visiting).map((f) => ({
        ...f,
        fieldName: `items.${f.fieldName}`,
      }));
    }
    case "tuple":
      // Tuples have fixed cardinality; here we lose the index and emit
      // all elements as `array` with positional prefix.
      return (node.children ?? []).flatMap((edge) =>
        visit(graph, edge.node, location, visiting).map((f) => ({
          ...f,
          fieldName: `${edge.name}.${f.fieldName}`,
        })),
      );
    case "union":
    case "intersection":
      return (node.alternatives ?? []).flatMap((alt) =>
        visit(graph, alt, location, visiting),
      );
    case "reference": {
      const target = node.ref ? resolveReference(graph, node.ref) : undefined;
      if (!target) return [];
      return visit(graph, target.id, location, visiting);
    }
    case "nullable":
      if (!node.inner) return [];
      // Nullability is flattened: the field was already optional in the
      // flat list (there was no way to require it). We propagate it as
      // not required and let the caller refine it.
      return visit(graph, node.inner, location, visiting).map((f) => ({
        ...f,
        required: false,
      }));
  }
}

function scalarField(node: ISchemaNode, location: TFieldLocation): IEndpointField {
  const field: { -readonly [K in keyof IEndpointField]: IEndpointField[K] } = {
    fieldName: node.name ?? "<scalar>",
    location,
    type: node.scalarType ?? "any",
    required: false,
  };
  applyConstraints(field, node.constraints);
  return field;
}

function enumField(node: ISchemaNode, location: TFieldLocation): IEndpointField {
  const field: { -readonly [K in keyof IEndpointField]: IEndpointField[K] } = {
    fieldName: node.name ?? "<enum>",
    location,
    type: "enum",
    required: false,
    enumValues: node.enumValues,
  };
  applyConstraints(field, node.constraints);
  return field;
}

function stringField(name: string, location: TFieldLocation, required: boolean): IEndpointField {
  return { fieldName: name, location, type: "string", required };
}

function applyConstraints(
  field: { -readonly [K in keyof IEndpointField]: IEndpointField[K] },
  constraints: ISchemaConstraints | undefined,
): void {
  if (!constraints) return;
  if (constraints.format !== undefined) field.format = constraints.format;
  if (constraints.minimum !== undefined) field.minimum = constraints.minimum;
  if (constraints.maximum !== undefined) field.maximum = constraints.maximum;
  if (constraints.minLength !== undefined) field.minLength = constraints.minLength;
  if (constraints.maxLength !== undefined) field.maxLength = constraints.maxLength;
}