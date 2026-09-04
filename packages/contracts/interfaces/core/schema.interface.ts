/**
 * The intermediate type model (IR): `SchemaGraph`.
 *
 * Until now the IR was a **flat field list** (`EndpointSpec.fields:
 * IEndpointField[]`). That works for describing loose validation rules,
 * but not nested types: an `address: { street, city }` flattens to
 * `address.street` and `address.city`, `enum` values are lost unless
 * declared as `enumValues`, and `oneOf` or `$ref` do not even exist
 * as concepts.
 *
 * `SchemaGraph` introduces a level of indirection: scanners can declare
 * **a graph of nodes** and reference each other. Exporters that know
 * how to consume the graph (OpenAPI for now) produce faithful
 * documents; those that still work with the flat list have a
 * `flatten-helper` that reconstructs it.
 *
 * ## Shape
 *
 * The graph is:
 *
 *   - `nodes`: a `Map<SchemaNodeId, ISchemaNode>` with every node,
 *     accessible by stable id.
 *   - `root`: the id of the root node from which the endpoint's
 *     request hangs.
 *
 * Each node declares its `kind` (one of the `SchemaNodeKind` values).
 * The remaining fields are **optional per kind**: a `scalar` carries
 * `scalarType`, an `enum` carries `enumValues`, an `object` carries
 * `children`, etc. Mixing fields irrelevant to the kind adds no
 * information and stays out of the contract — the helpers in this
 * package only fill in the ones that apply.
 *
 * ## Recursion and references
 *
 * Recursion is modelled with a `reference` node whose `ref` points to
 * another node **in the same graph**. Resolution is local first: if
 * the graph does not contain the target, the node stays as an
 * unresolved `$ref` and it is up to the exporter to decide what to do
 * (scanners that detect `OpenAPI`/`components/schemas` will resolve
 * it against the original document; the others emit the literal
 * `$ref`). Network resolution is out of scope for now (a00010 S6).
 *
 * ## Why `ReadonlyMap` / `ReadonlyArray`
 *
 * The graph is built once and read many times. Marking it immutable
 * from the contract prevents an exporter from mutating it by mistake
 * and gives the compiler room for optimizations.
 */

import type { IEndpointField } from "./postman.interface.js";

/** Node kinds in the graph. */
export type SchemaNodeKind =
  | "scalar"
  | "enum"
  | "object"
  | "array"
  | "tuple"
  | "union"
  | "intersection"
  | "reference"
  | "literal"
  | "nullable";

/** Stable locator of a node inside the graph. */
export type SchemaNodeId = string;

/** Constraints applicable to a node (don't override the `kind`, they decorate it). */
export interface ISchemaConstraints {
  readonly format?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

/**
 * A node in the graph.
 *
 * Which field applies depends on `kind`:
 *
 *   - `scalar`     → `scalarType`
 *   - `enum`       → `enumValues`
 *   - `literal`    → `literal`
 *   - `object`     → `children`
 *   - `array`      → `children` (a single item, `name` is usually `items`)
 *   - `tuple`      → `children` (positional, `name` carries the index)
 *   - `union`      → `alternatives`
 *   - `intersection` → `alternatives`
 *   - `reference`  → `ref`
 *   - `nullable`   → `inner`
 *
 * `constraints` is orthogonal to `kind`: every node accepts it and it
 * translates to the equivalent JSON Schema keys (`format`, `minimum`,
 * `pattern`, …).
 */
export interface ISchemaNode {
  readonly id: SchemaNodeId;
  readonly kind: SchemaNodeKind;
  /** Logical name (e.g. `User`, `UserCreate`). When present, exporters register it as `$ref`. */
  readonly name?: string;
  /** Scalar type — only when `kind === 'scalar'`. */
  readonly scalarType?: "string" | "integer" | "number" | "boolean" | "date" | "datetime" | "file";
  /** Allowed values — only when `kind === 'enum'`. */
  readonly enumValues?: ReadonlyArray<string>;
  /** Literal value — only when `kind === 'literal'`. */
  readonly literal?: unknown;
  /** Children (object fields, array items, etc.). */
  readonly children?: ReadonlyArray<ISchemaEdge>;
  /** Id of the referenced node — only when `kind === 'reference'`. */
  readonly ref?: SchemaNodeId;
  /** Alternative nodes — only when `kind === 'union'` or `intersection'`. */
  readonly alternatives?: ReadonlyArray<SchemaNodeId>;
  /** Additional constraints (format, min/max, pattern). */
  readonly constraints?: ISchemaConstraints;
  /** Wrapped node — only when `kind === 'nullable'`. */
  readonly inner?: SchemaNodeId;
}

/** A named edge: object field, array item, etc. */
export interface ISchemaEdge {
  readonly name: string;
  readonly node: SchemaNodeId;
  readonly required?: boolean;
  readonly description?: string;
}

/**
 * The complete graph.
 *
 * The ids are **stable by construction**: once a graph is published,
 * two calls starting from the same specs produce the same node map.
 * That lets exporters cache results by `SchemaNodeId` and keeps diffs
 * between two runs stable.
 *
 * `nodes` is a `ReadonlyMap` for speed within the process; to cross
 * the process boundary (MCP, JSON, cache, UI), it is serialized with
 * `toDTO()` — a `ReadonlyMap` does not survive `JSON.stringify`.
 */
export interface ISchemaGraph {
  readonly nodes: ReadonlyMap<SchemaNodeId, ISchemaNode>;
  /** Id of the graph's root node. */
  readonly root: SchemaNodeId;
  /**
   * Serializable form of the graph for crossing process boundaries
   * (MCP, JSON, cache, UI). See `ISchemaGraphDTO`. The conversion is
   * stable: two calls on the same graph produce the same DTO.
   */
  toDTO(): ISchemaGraphDTO;
}

/**
 * Flat, JSON-serializable form of an `ISchemaGraph`.
 *
 * `nodes` is stored as `entries` (`Array<[id, node]>`) because
 * `JSON.stringify(new Map(...))` returns `"{}"` and loses the
 * information. The process boundary **requires** this DTO; within the
 * process, `ISchemaGraph` with its `ReadonlyMap` is the canonical
 * form.
 *
 * Order: the first array entry is kept stable for the same graph
 * (`SchemaNodeId` values are unique by construction).
 */
export interface ISchemaGraphDTO {
  nodes: ReadonlyArray<readonly [SchemaNodeId, ISchemaNode]>;
  root: SchemaNodeId;
}

/**
 * How an endpoint uses a schema graph.
 *
 * Not yet attached to `EndpointSpec` (a00010 S6 only leaves
 * `schemaGraph` optional, with `root` as the starting point). The
 * type stays declared for exporters that need more than one node per
 * endpoint — the obvious case is OpenAPI, where responses are also
 * described: every status code is associated with a graph node by id.
 */
export interface IOperationSchema {
  readonly request?: SchemaNodeId;
  readonly responses?: ReadonlyMap<string, SchemaNodeId>;
}

/**
 * Flattened form of a node, ready to be exported to a format that
 * does not yet consume `SchemaGraph` (the Postman collection, for
 * instance).
 *
 * This is what `flatten-helper` returns: a walk from the root that
 * emits one `IEndpointField` per scalable node. `object` nodes are
 * traversed recursively; tuples and unions are flattened with
 * suffixes in the name (`<field>.0`, `<field>.<alternative>`).
 */
export interface IFlattenedField {
  readonly path: string;
  readonly nodeId: SchemaNodeId;
  readonly kind: SchemaNodeKind;
  readonly field: IEndpointField;
}

export interface IBuildOptions {
  /** Logical name of the root node. If omitted, `"Root"`. */
  readonly rootName?: string;
}

/** Scalar type the contract accepts as `scalarType`. */
export type ScalarType = NonNullable<ISchemaNode["scalarType"]>;

/** Options when building a `scalar` or `enum` node. */
export interface IScalarOptions {
  /** Additional constraints: format, min/max, pattern, etc. */
  readonly constraints?: ISchemaConstraints;
  /** Logical name (e.g. `UserId`). Exporters pick it up as `$ref`. */
  readonly name?: string;
}

/** Options common to composite nodes (`union`/`intersection`/`object`/`array`). */
export interface ICompositeOptions {
  /** Logical name (e.g. `UserOrError`). Exporters use it as `$ref`. */
  readonly name?: string;
  /** Additional constraints applicable to the composite node. */
  readonly constraints?: ISchemaConstraints;
}

/** Options when building a `reference` node. */
export interface IReferenceOptions {
  /** Name of the reference node (when it has one; nominal `$ref`s use it). */
  readonly name?: string;
  /** Optional description of the link. */
  readonly description?: string;
}

/** Options for composite node builders (`object`/`array`/`tuple`). */
export interface ICompositeNodeOptions extends ICompositeOptions {}
