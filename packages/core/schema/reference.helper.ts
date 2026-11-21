/**
 * Reference nodes and `$ref` resolution in the `SchemaGraph`.
 *
 * A reference is a node with `kind: 'reference'` and `ref` pointing
 * to the id of another node in the same graph. It enables:
 *
 *   - **Recursion**: a `User` node with field `parent: $ref User`.
 *   - **Reuse**: the same `SchemaNodeId` cited from two places.
 *   - **Forward references**: declaring a node before having all its
 *     fields and resolving it when the graph closes.
 *
 * Resolution is **local-first**: if the graph contains the target, the
 * node can be replaced by its full tree or by a nominal `$ref`
 * (`#/components/schemas/<name>`). If not, the target stays as an
 * external id and the exporter decides what to do (scanners that
 * detect OpenAPI resolve it against the original document; others emit
 * it literally). Network fetch is out of scope today (a00010 S6 leaves
 * it as follow-up).
 */
import type {
  IReferenceOptions,
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/**
 * Builds a `reference` node.
 *
 * The id referenced by the node (`ref`) must exist in the target graph.
 * Checking it at build time would be O(n) per node and would become
 * brittle on graphs under construction: the builder usually adds the
 * target **after** the `reference`, so early verification would fail.
 * The invariant is validated at closure (`resolveReference` or in
 * `flatten-helper`), not on every `add`.
 */
export function createReferenceNode(
  ref: SchemaNodeId,
  id: SchemaNodeId,
  options: IReferenceOptions = {},
): ISchemaNode {
  return {
    id,
    kind: "reference",
    ref,
    ...(options.name !== undefined ? { name: options.name } : {}),
  };
}

/**
 * Resolves a local `$ref`.
 *
 * If the graph contains the target, returns the node. Otherwise returns
 * `undefined`: the caller decides whether to treat it as an error
 * (strict validation) or to emit the literal `$ref` (lax exporter).
 */
export function resolveReference(
  graph: ISchemaGraph,
  ref: SchemaNodeId,
): ISchemaNode | undefined {
  return graph.nodes.get(ref);
}

/**
 * Derives a stable name to use as a nominal `$ref`.
 *
 * If the node has a `name`, it is used as-is: it is the logical name
 * the scanner set and the one expected in the target document.
 * Otherwise, it falls back to the id: less pretty, but it guarantees
 * two calls with the same input produce the same name.
 *
 * Exporters that prefer not to invent names for anonymous nodes should
 * check `node.name !== undefined` before calling here.
 */
export function deriveLocalRefName(
  node: ISchemaNode,
  fallback: (node: ISchemaNode) => string = (n) => n.id,
): string {
  return node.name ?? fallback(node);
}