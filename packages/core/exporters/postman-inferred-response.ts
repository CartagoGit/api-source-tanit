/**
 * `postman-inferred-response.ts` — Postman response[] rendering (f00014).
 *
 * Closes the Postman half of f00012 S4: the OpenAPI exporter already
 * reads `EndpointSpec.responses` and emits `responses.<status>` blocks;
 * the Postman side never did, so Postman collections are silent on
 * what the endpoint should return.
 *
 * This helper consumes the same `IResponseInference` array and produces
 * a Postman v2.1.0 `response[]` array, with:
 *
 * - `name` carrying the inferrer's `reason` so the user can read
 *   *why* a status was added.
 * - `code` = the HTTP status.
 * - `header` = a minimal `Content-Type: application/json` row.
 * - `body` = a JSON string with placeholder values derived from
 *   the schema (`""` for strings, `0` for numbers, `{}` for
 *   objects, `[]` for arrays, `true` for booleans, `null` for
 *   explicit nullable, the literal for `literal` shapes).
 *
 * If the entry's confidence is `low`, the helper adds a
 * `_postman_previewlanguage` comment-style marker so the user
 * understands the example is a heuristic guess.
 *
 * Returns `undefined` when `spec.responses` is empty so the caller
 * keeps the historical Postman shape (no `response[]` block).
 */
import type {
  IResponseInference,
  IResponseInferenceConfidence,
} from "../../contracts/interfaces/core/responses.interface.js";
import type { EndpointSpec } from "../../contracts/interfaces/core/postman.interface.js";

/** Single Postman v2.1.0 `response` entry. */
export interface IPostmanInferredResponse {
  readonly name: string;
  readonly status: string;
  readonly code: number;
  readonly _postman_previewlanguage?: string;
  readonly header: ReadonlyArray<{
    readonly key: string;
    readonly value: string;
    readonly type: "text";
  }>;
  readonly body: string;
}

/**
 * Materializes a spec's inferred responses as a Postman `response[]`.
 *
 * Returns `undefined` when `spec.responses` is empty or absent so the
 * caller can keep the historical shape (no `response[]` block). When
 * the inferrer produced entries, the result has one entry per
 * `(status, reason)` pair, deduplicated by the dispatcher.
 */
export function renderInferredPostmanResponses(
  spec: EndpointSpec,
): ReadonlyArray<IPostmanInferredResponse> | undefined {
  const entries = spec.responses;
  if (!entries || entries.length === 0) return undefined;

  const out: IPostmanInferredResponse[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.status}::${entry.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const name = `${entry.status} ${statusLabelFor(entry.status)} (${entry.reason})`;
    const body = bodyForEntry(entry);
    const header: IPostmanInferredResponse["header"] = [
      { key: "Content-Type", value: "application/json", type: "text" },
    ];
    const item: IPostmanInferredResponse = {
      name,
      status: statusLabelFor(entry.status),
      code: entry.status,
      header,
      body,
    };
    if (entry.confidence === "low") {
      item.header; // ensure layout
      // Mark the example as heuristic so the user knows it is a
      // guess, not a verified shape.
      return [
        ...out,
        {
          ...item,
          _postman_previewlanguage: `// inferred (low confidence): ${entry.reason}`,
        },
      ];
    }
    out.push(item);
  }
  return out;
}

function statusLabelFor(status: number): string {
  // A short canonical label per the standard Postman set. Anything
  // outside the table falls back to the empty string (Postman accepts
  // `status: ""`).
  const table: Record<number, string> = {
    200: "OK",
    201: "Created",
    202: "Accepted",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    409: "Conflict",
    422: "Unprocessable Entity",
    500: "Internal ServerError",
    503: "Service Unavailable",
  };
  return table[status] ?? "";
}

/** Serializes a single inference entry's body as a placeholder JSON. */
function bodyForEntry(entry: IResponseInference): string {
  switch (entry.schema.kind) {
    case "empty":
      return "";
    case "ref":
      // `$ref` → we cannot resolve the type here, so the placeholder
      // is `{}`. Postman shows it as an empty object preview, which is
      // an honest signal that the shape is named elsewhere.
      return "{}";
    case "schema-graph": {
      const value = placeholderForGraph(
        entry.schema.graph.root,
        entry.schema.graph,
      );
      return JSON.stringify(value, null, 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Schema-graph → placeholder value (recursive).
// ---------------------------------------------------------------------------

interface ISimpleSchemaNodeLike {
  readonly id: string;
  readonly name?: string;
  readonly kind: string;
  readonly scalarType?: string;
  readonly enumValues?: ReadonlyArray<unknown>;
  readonly literal?: unknown;
  readonly fields?: ReadonlyArray<{
    readonly key: string;
    readonly value: ISimpleSchemaNodeLike;
    readonly optional?: boolean;
  }>;
  readonly element?: ISimpleSchemaNodeLike;
  readonly elements?: ReadonlyArray<ISimpleSchemaNodeLike | null>;
  readonly alternatives?: ReadonlyArray<ISimpleSchemaNodeLike>;
}

/** Picks a placeholder value for a schema-graph node. */
function placeholderForGraph(
  rootId: string,
  graphLike: unknown,
  depth = 0,
): unknown {
  // The graph is opaque; we pull just enough structure to emit
  // placeholders. Anything we do not understand becomes `null`.
  const graph = graphLike as {
    readonly nodes: ReadonlyMap<string, ISimpleSchemaNodeLike> | Iterable<readonly [string, ISimpleSchemaNodeLike]>;
  };
  const node = readNode(graph.nodes, rootId);
  if (!node) return null;
  return placeholderForNode(node, depth);
}

function readNode(
  nodes: ReadonlyMap<string, ISimpleSchemaNodeLike> | Iterable<readonly [string, ISimpleSchemaNodeLike]>,
  id: string,
): ISimpleSchemaNodeLike | undefined {
  // The `ISchemaGraph` contract is `nodes: ReadonlyMap<...>`. We accept
  // an iterable fallback for tests that pass a tuple array (avoids
  // leaking Map internals across the test surface).
  const asMap = nodes as ReadonlyMap<string, ISimpleSchemaNodeLike>;
  if (asMap && typeof asMap.get === "function") {
    return asMap.get(id);
  }
  for (const entry of nodes as Iterable<readonly [string, ISimpleSchemaNodeLike]>) {
    if (entry[0] === id) return entry[1];
  }
  return undefined;
}

function placeholderForNode(
  node: ISimpleSchemaNodeLike,
  depth: number,
): unknown {
  // Hard cap on recursion: a deeply nested schema produces a
  // visually-empty preview in Postman anyway, and unbounded recursion
  // is a footgun.
  if (depth > 3) return null;

  switch (node.kind) {
    case "scalar": {
      const t = (node.scalarType ?? "").toLowerCase();
      if (t === "number" || t === "integer") return 0;
      if (t === "boolean") return true;
      if (t === "null") return null;
      // string, date, anything else.
      return "";
    }
    case "enum": {
      const first = node.enumValues?.[0];
      return first ?? null;
    }
    case "literal":
      return node.literal ?? null;
    case "object": {
      const out: Record<string, unknown> = {};
      for (const field of node.fields ?? []) {
        if (field.optional && depth >= 2) continue;
        out[field.key] = placeholderForNode(field.value, depth + 1);
      }
      return out;
    }
    case "array":
      return node.element
        ? [placeholderForNode(node.element, depth + 1)]
        : [];
    case "tuple": {
      const first = node.elements?.[0];
      return first ? placeholderForNode(first, depth + 1) : null;
    }
    case "union": {
      const first = node.alternatives?.[0];
      return first ? placeholderForNode(first, depth + 1) : null;
    }
    case "intersection": {
      const first = node.alternatives?.[0];
      return first ? placeholderForNode(first, depth + 1) : null;
    }
    case "reference":
      // Self-reference: render an empty placeholder. The user sees
      // the example does not loop forever.
      return null;
    case "any":
    default:
      return null;
  }
}

/** Exposed for testing — labels without depending on the table above. */
export function __labelForStatusForTest(status: number): string {
  return statusLabelFor(status);
}

/** Exposed for testing — placeholder shape for a single entry. */
export function __bodyForEntryForTest(entry: IResponseInference): string {
  return bodyForEntry(entry);
}

/** Confidence test helper (kept narrow on purpose). */
export function __confidenceShapeForTest(c: IResponseInferenceConfidence): string {
  return c;
}