/**
 * Build a `SchemaGraph` from `IValidationSpec[]`.
 *
 * Until now the source of truth for the body was a flat list of
 * `IValidationSpec`. With `SchemaGraph` in play, the flat list still
 * comes from scanners that have not migrated to the graph yet, but it
 * is **converted** to the graph here. Exporters that know how to
 * consume the graph see nested types; others can flatten it with
 * `flatten-helper` and proceed as before.
 *
 * ## Minimum, by design
 *
 * The "minimum" `SchemaGraph` is not a complete graph: it is a 1-to-1
 * translation of specs to nodes, with the root as an `object` and each
 * spec as a child. This is deliberate — scanners do not yet produce
 * nested types, and reconstructing a rich graph from `address.street`
 * would be guesswork. When a scanner migrates to native SchemaGraph
 * (a00010 S7 and following), the graph it produces can pass through
 * this builder untouched, or skip it if it already comes with
 * referenced nodes.
 *
 * ## Determinism
 *
 * `buildSchemaGraph(specs, rootName)` produces the same graph for the
 * same input, in the same insertion order. Ids are assigned with a
 * local counter, not a global one: two simultaneous calls do not
 * interfere, and the result is cacheable by input equality.
 */
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import type {
  IBuildOptions,
  ICompositeOptions,
  ISchemaEdge,
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";
import { createSchemaGraph } from "./serialize.helper.js";
import {
  constraintsFromValidationSpec,
  createEnumNode,
  createScalarNode,
} from "./scalar.helper.js";

/**
 * Builds an `object` node with the given children.
 *
 * `children` is copied: mutating the caller's array afterwards does
 * not affect the node. The id is provided by the caller (typically the
 * builder) to avoid collisions in graphs under construction.
 */
export function createObjectNode(
  id: SchemaNodeId,
  children: ReadonlyArray<ISchemaEdge>,
  options: ICompositeOptions = {},
): ISchemaNode {
  const node: { -readonly [K in keyof ISchemaNode]: ISchemaNode[K] } = {
    id,
    kind: "object",
    children: children.map((edge) => ({ ...edge })),
  };
  if (options.name !== undefined) node.name = options.name;
  if (options.constraints !== undefined) node.constraints = options.constraints;
  return node;
}

/**
 * Builds an `array` node whose only child is `itemId`.
 *
 * The item lives in an `ISchemaEdge` with `name: "items"` and
 * `required: true` — an array without an item is not an array, and an
 * optional item in an array does not exist in JSON Schema (`items`
 * always applies to every element).
 */
export function createArrayNode(
  id: SchemaNodeId,
  itemId: SchemaNodeId,
  options: ICompositeOptions = {},
): ISchemaNode {
  const node: { -readonly [K in keyof ISchemaNode]: ISchemaNode[K] } = {
    id,
    kind: "array",
    children: [{ name: "items", node: itemId, required: true }],
  };
  if (options.name !== undefined) node.name = options.name;
  if (options.constraints !== undefined) node.constraints = options.constraints;
  return node;
}

/**
 * `SchemaGraph` builder.
 *
 * Keeps a local id counter and a node map. Each `add*` returns the id
 * of the created node, so the caller can chain references without
 * inventing ids. The builder is **single-use**: after `build()`, it
 * accepts no more `add*`.
 */
export class SchemaGraphBuilder {
  private readonly map = new Map<SchemaNodeId, ISchemaNode>();
  private nextIndex = 0;
  private sealed = false;

  /** Genera el siguiente id, reservando el prefijo `kind:` para legibilidad. */
  private newId(kind: string): SchemaNodeId {
    const id = `${kind}:${this.nextIndex}`;
    this.nextIndex += 1;
    return id;
  }

  /** Ensures the builder is still open. */
  private checkOpen(): void {
    if (this.sealed) {
      throw new Error(
        "SchemaGraphBuilder.build() was already called: the builder is single-use.",
      );
    }
  }

  /** Adds an already-built node to the graph and returns its id. */
  add(node: ISchemaNode): SchemaNodeId {
    this.checkOpen();
    if (this.map.has(node.id)) {
      throw new Error(
        `SchemaGraphBuilder: duplicate id "${node.id}". ids must be unique.`,
      );
    }
    this.map.set(node.id, node);
    return node.id;
  }

  /**
   * Builds an `object` with the given children and returns its id.
   *
   * `children` is copied: the caller's array may mutate afterwards
   * without the graph node noticing.
   */
  addObject(
    name: string | undefined,
    children: ReadonlyArray<ISchemaEdge>,
    options: ICompositeOptions = {},
  ): SchemaNodeId {
    this.checkOpen();
    const id = this.newId("object");
    const node: { -readonly [K in keyof ISchemaNode]: ISchemaNode[K] } = {
      id,
      kind: "object",
      children: children.map((edge) => ({ ...edge })),
    };
    if (name !== undefined) node.name = name;
    if (options.constraints !== undefined) node.constraints = options.constraints;
    this.map.set(id, node);
    return id;
  }

  /**
   * Builds an `array` whose only child is `itemId`. Returns the id of
   * the array, not the item.
   */
  addArray(itemId: SchemaNodeId, name?: string, options: ICompositeOptions = {}): SchemaNodeId {
    this.checkOpen();
    const id = this.newId("array");
    const node: { -readonly [K in keyof ISchemaNode]: ISchemaNode[K] } = {
      id,
      kind: "array",
      children: [{ name: "items", node: itemId, required: true }],
    };
    if (name !== undefined) node.name = name;
    if (options.constraints !== undefined) node.constraints = options.constraints;
    this.map.set(id, node);
    return id;
  }

  /**
   * Closes the graph and returns the immutable structure.
   *
   * `rootId` must exist in the map (it was created by a previous
   * `add*`). Otherwise it throws: a graph without a root is not a graph,
   * and `buildOpenApiDocument` with a non-existent root would produce a
   * broken document.
   */
  build(rootId: SchemaNodeId): ISchemaGraph {
    this.checkOpen();
    if (!this.map.has(rootId)) {
      throw new Error(
        `SchemaGraphBuilder.build(): rootId "${rootId}" is not in the map.`,
      );
    }
    this.sealed = true;
    // We wrap with `createSchemaGraph` so the resulting graph satisfies
    // the `ISchemaGraph.toDTO()` contract. Without this, the interface
    // requires a method that the literal `{ nodes, root }` does not
    // have, and consumers (MCP, UI, cache) could not serialize it.
    return createSchemaGraph(this.map, rootId);
  }

  /**
   * Translates an `IValidationSpec` into one or two graph nodes and
   * returns the id of the main one.
   *
   * Reason to live as a method: the implementation calls `newId`,
   * which is private to the builder. Keeping it here preserves
   * encapsulation and leaves `buildSchemaGraph` as a three-line
   * orchestrator.
   *
   * ## Composite types
   *
   * `array` translates to `kind: 'array'` with an `items` that is
   * **a `string` scalar** — the equivalent of the `items: string` the
   * OpenAPI exporter used to emit. Reason: the flat spec does not know
   * the item type, and reconstructing it from `array.of` or
   * `items.type` (which do not exist in `IValidationSpec`) would be
   * invention. A scanner migrating to native SchemaGraph can skip
   * this helper and build the `array` with the real item.
   *
   * `object` translates to `kind: 'object'` without children. The flat
   * spec does not carry sub-fields: a spec with `type: 'object'` and
   * name `address` does not say what is inside `address`. Same
   * argument.
   *
   * `any` translates to `kind: 'scalar'` without `scalarType`: it is
   * the "anything" of the contract, and JSON Schema renders it as `{}`
   * (matches all).
   */
  addFromSpec(spec: IValidationSpec): SchemaNodeId {
    this.checkOpen();
    switch (spec.type) {
      case "string":
      case "integer":
      case "number":
      case "boolean":
      case "date":
      case "datetime":
      case "file": {
        const id = this.newId("scalar");
        const constraints = constraintsFromValidationSpec(spec);
        const node = createScalarNode(spec.type, id, {
          ...(constraints !== undefined ? { constraints } : {}),
        });
        return this.add(node);
      }
      case "enum": {
        const id = this.newId("enum");
        const constraints = constraintsFromValidationSpec(spec);
        const node = createEnumNode(spec.enumValues ?? [], id, {
          ...(constraints !== undefined ? { constraints } : {}),
        });
        return this.add(node);
      }
      case "array": {
        // Default item is an opaque `string`: the flat spec does not
        // carry the item type.
        const itemId = this.add(createScalarNode("string", this.newId("scalar")));
        return this.addArray(itemId, spec.fieldName);
      }
      case "object": {
        return this.addObject(spec.fieldName, []);
      }
      case "any": {
        const id = this.newId("scalar");
        return this.add({ id, kind: "scalar" });
      }
    }
  }
}

/**
 * Builds a minimum `SchemaGraph` from `IValidationSpec[]`.
 *
 * The root node is an `object` with one child per spec. Each spec is
 * translated with `SchemaGraphBuilder.addFromSpec`. The resulting graph
 * serves exporters that know how to read it and, with `flatten-helper`,
 * those that do not.
 */
export function buildSchemaGraph(
  specs: ReadonlyArray<IValidationSpec>,
  options: IBuildOptions = {},
): ISchemaGraph {
  const builder = new SchemaGraphBuilder();
  const rootName = options.rootName ?? "Root";

  // Pass 1: create all leaf nodes. If a spec is `array`, it creates two
  // nodes (the `array` and the internal `items`). We need the ids
  // before we can add them as children of the root, but the builder
  // already returns the ids when inserting, so this is linear: first
  // independent nodes, then plug them into the root.
  const specIds = new Map<IValidationSpec, SchemaNodeId>();
  for (const spec of specs) {
    specIds.set(spec, builder.addFromSpec(spec));
  }

  // Pass 2: create the root and the children.
  const children: ISchemaEdge[] = [];
  for (const spec of specs) {
    const nodeId = specIds.get(spec);
    if (nodeId === undefined) continue;
    children.push({
      name: spec.fieldName,
      node: nodeId,
      required: spec.required,
    });
  }
  const rootId = builder.addObject(rootName, children);

  return builder.build(rootId);
}