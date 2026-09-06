/**
 * SchemaGraph → flat field list (audit 2026-09-06 §9, proposal
 * `r00016`).
 *
 * Today `EndpointSpec` carries **two** representations of the same
 * information: a flat `fields` list (consumed by every exporter)
 * and an optional `schemaGraph` (consumed only by OpenAPI). When
 * a scanner attaches both it must keep them in sync, and a typo
 * anywhere along the way produces a Postman collection that says
 * `type: "string"` while OpenAPI says `format: "uuid"` — two
 * sources of truth = drift.
 *
 * This helper is the first step of the migration: given a
 * `SchemaGraph` rooted at the request node, walk it once and emit
 * a flat `IEndpointField[]` (one entry per leaf scalar/enum with
 * a `path`-style `fieldName`) that consumers that don't yet know
 * the graph can render. The graph stays the source of truth; the
 * flat list is a **view derived on demand**, not a parallel
 * structure.
 *
 * The walk is intentionally minimal — enough to drive the
 * Postman description table and the HAR/Bruno/curl exporters,
 * not enough to rebuild an entire OpenAPI document. That is
 * already what `openapi.exporter.ts > emitSchemaGraph` does.
 * Adding `r00016` S1 means "stop duplicating scalars across both
 * shapes for the body" — not "replace OpenAPI's full emitter".
 *
 * What it does:
 *   - follows `object` children recursively, joining names with
 *     `.` (`address.street`),
 *   - flattens `array` items (`tags` → `tags[]` is rendered as a
 *     single field with `type` showing the item shape),
 *   - resolves `reference` nodes by id (no cross-graph lookup),
 *   - unwraps `nullable` (the inner shape becomes the field
 *     shape; nullability is preserved as `required: false` on the
 *     parent object field),
 *   - reads `scalarType`, `enumValues`, `format`, `minimum`,
 *     `maximum`, `minLength`, `maxLength`, `pattern` from
 *     constraints,
 *   - honours `required?: true` on object edges.
 *
 * What it does NOT do:
 *   - resolve `union` / `intersection` / `tuple` (those lose
 *     information when flattened to a single field; the consumers
 *     that need them — OpenAPI for now — go through
 *     `emitSchemaGraph` directly),
 *   - cross-graph `$ref` (out of scope; the OpenAPI emitter
 *     resolves them against the original document).
 *
 * `lint:contracts` keeps this helper here, not in `contracts/`:
 * it consumes `IEndpointField` from the contract and produces
 * the same shape; the contract package contains the types, this
 * package contains the algorithm.
 */
import type {
  IEndpointField,
} from "../../contracts/interfaces/core/postman.interface.js";
import type {
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";

/** Default maxDepth for the recursion. Anything deeper collapses to a `$ref` leaf. */
const DEFAULT_MAX_DEPTH = 16;

/**
 * Flatten a `SchemaGraph` into a list of `IEndpointField`.
 *
 * The first entry corresponds to the root node; the order is
 * stable across runs (Babel-friendly: children, alternatives,
 * and constraints are read in declaration order). The same input
 * always produces the same output, which keeps diffs between two
 * runs stable.
 *
 * `root` is the node the request hangs from. When the spec
 * already declares its own root via `spec.schemaGraph.root`,
 * `flattenBody` calls this helper with that root.
 */
export function fieldsFromGraph(
  graph: ISchemaGraph,
  root: SchemaNodeId = graph.root,
): ReadonlyArray<IEndpointField> {
  const out: IEndpointField[] = [];
  const start = graph.nodes.get(root);
  if (!start) return out;
  walk(graph, start, "", undefined, 0, out);
  return out;
}

function walk(
  graph: ISchemaGraph,
  node: ISchemaNode,
  pathPrefix: string,
  parentRequired: boolean | undefined,
  depth: number,
  out: IEndpointField[],
): void {
  // Stop on cycle or excessive depth. The user gets a $ref leaf
  // and the OpenAPI emitter can resolve it; we don't.
  if (depth > DEFAULT_MAX_DEPTH) {
    out.push({
      fieldName: pathPrefix || node.id,
      location: "body",
      type: "object",
      required: parentRequired ?? false,
    });
    return;
  }

  switch (node.kind) {
    case "scalar": {
      out.push({
        fieldName: pathPrefix || "(root)",
        location: "body",
        type: node.scalarType ?? "string",
        required: parentRequired ?? false,
        ...(node.constraints?.format
          ? { format: node.constraints.format }
          : {}),
        ...(node.constraints?.minimum !== undefined
          ? { minimum: node.constraints.minimum }
          : {}),
        ...(node.constraints?.maximum !== undefined
          ? { maximum: node.constraints.maximum }
          : {}),
        ...(node.constraints?.minLength !== undefined
          ? { minLength: node.constraints.minLength }
          : {}),
        ...(node.constraints?.maxLength !== undefined
          ? { maxLength: node.constraints.maxLength }
          : {}),
      });
      return;
    }
    case "enum": {
      out.push({
        fieldName: pathPrefix || "(root)",
        location: "body",
        type: "enum",
        required: parentRequired ?? false,
        enumValues: node.enumValues ?? [],
      });
      return;
    }
    case "literal": {
      out.push({
        fieldName: pathPrefix || "(root)",
        location: "body",
        type: typeof node.literal === "number"
          ? "number"
          : typeof node.literal === "boolean"
          ? "boolean"
          : "string",
        required: parentRequired ?? false,
        enumValues: node.literal === undefined
          ? undefined
          : [String(node.literal)],
      });
      return;
    }
    case "object": {
      // The object itself does not become a leaf; we descend into
      // its children. The path prefix carries through.
      const children = node.children ?? [];
      for (const edge of children) {
        const child = graph.nodes.get(edge.node);
        if (!child) continue;
        const childName = edge.name;
        const path = pathPrefix === "" ? childName : `${pathPrefix}.${childName}`;
        walk(
          graph,
          child,
          path,
          edge.required ?? false,
          depth + 1,
          out,
        );
      }
      return;
    }
    case "array": {
      const items = node.children ?? [];
      const item = items[0];
      if (!item) {
        out.push({
          fieldName: pathPrefix || "(root)",
          location: "body",
          type: "array",
          required: parentRequired ?? false,
        });
        return;
      }
      const itemNode = graph.nodes.get(item.node);
      if (!itemNode) return;
      // `items` is rendered as `items[]` in the flat list — a
      // single field that describes one slot. Consumers that need
      // the OpenAPI `items` object go through `emitSchemaGraph`.
      walk(
        graph,
        itemNode,
        `${pathPrefix}[]`,
        parentRequired,
        depth + 1,
        out,
      );
      return;
    }
    case "nullable": {
      const inner = node.inner
        ? graph.nodes.get(node.inner)
        : undefined;
      if (!inner) return;
      // Unwrap: the inner shape becomes the field; nullability is
      // encoded as `required: false` on the parent edge (already
      // passed in as `parentRequired`).
      walk(graph, inner, pathPrefix, parentRequired, depth + 1, out);
      return;
    }
    case "reference": {
      // Local-only: if the referenced id is in the same graph,
      // walk it; otherwise emit a `$ref` leaf and stop.
      const target = node.ref ? graph.nodes.get(node.ref) : undefined;
      if (target && node.ref && target.id === node.ref) {
        walk(graph, target, pathPrefix, parentRequired, depth + 1, out);
        return;
      }
      out.push({
        fieldName: pathPrefix || node.id,
        location: "body",
        type: `$ref:${node.ref ?? "missing"}`,
        required: parentRequired ?? false,
      });
      return;
    }
    case "union":
    case "intersection":
    case "tuple": {
      // Loses information when flattened — emit a single leaf and
      // let the consumer pick a richer path (OpenAPI goes through
      // `emitSchemaGraph`).
      out.push({
        fieldName: pathPrefix || "(root)",
        location: "body",
        type: node.kind,
        required: parentRequired ?? false,
      });
      return;
    }
  }
}

/**
 * Convenience: derive the body's flat fields from the spec.
 *
 * Equivalent to `fieldsFromGraph(spec.schemaGraph, spec.schemaGraph.root)`
 * with an empty guard for the legacy path (no graph attached —
 * returns `undefined`, the existing `fields` field is the source
 * of truth).
 */
export function bodyFieldsFromGraph(
  spec: { readonly schemaGraph?: ISchemaGraph },
): ReadonlyArray<IEndpointField> | undefined {
  if (!spec.schemaGraph) return undefined;
  return fieldsFromGraph(spec.schemaGraph, spec.schemaGraph.root);
}
