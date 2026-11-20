/**
 * Serialization of the `SchemaGraph` for process boundaries.
 *
 * The graph lives as `ReadonlyMap` for in-process speed, but
 * `JSON.stringify(new Map(...))` returns `"{}"` — the information is
 * lost. When the graph crosses a boundary (MCP, JSON, cache, UI),
 * it must go through a DTO that **is** JSON-serializable.
 *
 * This helper exports:
 *
 *   - `createSchemaGraph(nodes, root)`: factory that returns an
 *     `ISchemaGraph` with `toDTO()` bound to the map. This is the
 *     recommended way to build a graph (the builders in
 *     `build-schema-graph.helper.ts` use it internally).
 *   - `toDTO(graph)`: converts any `ISchemaGraph` to an
 *     `ISchemaGraphDTO`. It implements the interface's `toDTO()`
 *     method and is also exposed as a free function for consumers
 *     that prefer not to call the method.
 *   - `fromDTO(dto)`: rebuilds an `ISchemaGraph` from a DTO. The
 *     resulting graph includes `toDTO()` (via `createSchemaGraph`).
 *   - `sortByLocation(graph)`: sorts nodes by location when that
 *     information is available; see note below.
 *
 * ## Determinism
 *
 * `toDTO(graph)` produces the same array of `entries` each time, in
 * the iteration order of the underlying `Map`. JS `Map` iteration
 * follows insertion order, so the DTO is stable for the same graph
 * and reproducible by content equality.
 *
 * ## Why `entries` and not `Record<string, ISchemaNode>`
 *
 * `Record<string, ISchemaNode>` is also JSON-serializable, but an
 * array of `[id, node]` preserves ordering (important for stable
 * diffs between two passes) and does not require ids to be valid
 * object keys (a `SchemaNodeId` may contain `:` or other characters
 * that JS would handle fine, but the convention here is loose — the
 * contract does not restrict it).
 *
 * ## `sortByLocation` — no location metadata for now
 *
 * The current `ISchemaNode` contract has no `line`/`column`. The
 * reason this helper exists is to prepare the ground for when AST
 * scanners (`a00010 S7`) emit nodes with their source origin — the
 * top-down order of the file must survive serialization.
 *
 * Until then, `sortByLocation` returns a copy of the graph with nodes
 * in `Map` iteration order. If `ISchemaNode` later adds
 * `readonly location?: { line: number; column: number }`, this helper
 * sorts by `(line, column, id)` and DTOs from two passes over the
 * same source will be byte-for-byte identical.
 */

import type {
  ISchemaGraph,
  ISchemaGraphDTO,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/**
 * Builds an `ISchemaGraph` from a `Map` and a root id.
 *
 * Returns an object with `toDTO()` bound to the map. This is the only
 * valid way to satisfy the interface from external code: literals of
 * the form `{ nodes: map, root }` no longer compile because the
 * interface requires `toDTO`.
 *
 * If you need a graph from a DTO, use `fromDTO(dto)` (which in turn
 * delegates here).
 */
export function createSchemaGraph(
  nodes: ReadonlyMap<SchemaNodeId, ISchemaNode>,
  root: SchemaNodeId,
): ISchemaGraph {
  return {
    nodes,
    root,
    toDTO(): ISchemaGraphDTO {
      return toDTO(this);
    },
  };
}

/**
 * Converts an `ISchemaGraph` to its JSON-serializable DTO.
 *
 * Implements the interface's `toDTO()` method and is also exported as
 * a free function. Both paths produce the same result:
 * `graph.toDTO() === toDTO(graph)` for any graph.
 *
 * The `nodes` array comes out in the underlying `Map`'s iteration
 * order (insertion order). That guarantees two calls on the same
 * graph produce the same DTO, and `fromDTO(toDTO(graph))` recovers
 * the same graph by content equality.
 */
export function toDTO(graph: ISchemaGraph): ISchemaGraphDTO {
  return {
    nodes: Array.from(graph.nodes.entries()),
    root: graph.root,
  };
}

/**
 * Rebuilds an `ISchemaGraph` from a DTO.
 *
 * Creates a new `Map` from the DTO entries and wraps it with
 * `createSchemaGraph` (which adds `toDTO`). Useful on the opposite
 * boundary: if the graph comes as JSON from MCP, cache, or a persisted
 * snapshot, this function returns it in the in-memory form exporters
 * work with.
 */
export function fromDTO(dto: ISchemaGraphDTO): ISchemaGraph {
  return createSchemaGraph(new Map(dto.nodes), dto.root);
}

/**
 * Returns a copy of the graph with nodes in stable order.
 *
 * Today: the copy keeps the iteration order of the original `Map`
 * (insertion order), so the result is stable for the same input
 * graph.
 *
 * Tomorrow: when `ISchemaNode` carries `location?: { line, column }`,
 * this function sorts by `(line, column, id)` — the same order in
 * which they appear in the source file. The AST frontend
 * (`a00010 S7`) produces that top-down order; this helper preserves
 * it when crossing the JSON boundary.
 */
export function sortByLocation(graph: ISchemaGraph): ISchemaGraph {
  // The current interface has no `location`. We iterate the map in its
  // (already stable) order and return a new graph. When `ISchemaNode`
  // is extended, this is the place to touch.
  return createSchemaGraph(new Map(graph.nodes), graph.root);
}