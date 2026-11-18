/**
 * Union and intersection nodes for the `SchemaGraph`.
 *
 * Two node kinds model combinations:
 *
 *   - `union`        → `oneOf` in JSON Schema: the value must satisfy
 *                       **any** of the alternative nodes.
 *   - `intersection` → `allOf` in JSON Schema: the value must satisfy
 *                       **all** of the nodes.
 *
 * `anyOf` has no node of its own: it is semantically a `union` without
 * the exclusivity guarantee that OpenAPI's `oneOf` provides. If the
 * scanner needs to mark that difference, it does so by putting the name
 * on the node (`name: 'anyOf'`) — the helper does not distinguish them
 * because structurally they are the same node.
 *
 * Alternatives are stored as **ids**, not as nodes: keeping references
 * to the graph here would force propagating `ISchemaGraph` through every
 * builder and cloning it when copying a node, which is exactly the
 * indirection the graph came to avoid.
 */
import type {
  ICompositeOptions,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/**
 * Builds a `union` node (`oneOf`).
 *
 * `alternatives` may have a single element: `oneOf` with a single
 * candidate is legal and flattens to that candidate. We do not flatten
 * it here: if the caller wants it flat, they build it flat. The helper
 * only respects the shape it receives.
 */
export function createUnionNode(
  alternatives: ReadonlyArray<SchemaNodeId>,
  id: SchemaNodeId,
  options: ICompositeOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "union",
    alternatives: [...alternatives],
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
  };
}

/**
 * Builds an `intersection` node (`allOf`).
 *
 * Empty: an `allOf` without candidates equals `true` in JSON Schema,
 * which is a pathological case. The caller decides whether to pass an
 * empty list (the helper respects it without error) or reject it before
 * calling.
 */
export function createIntersectionNode(
  alternatives: ReadonlyArray<SchemaNodeId>,
  id: SchemaNodeId,
  options: ICompositeOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "intersection",
    alternatives: [...alternatives],
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.constraints !== undefined ? { constraints: options.constraints } : {}),
  };
}