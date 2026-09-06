/**
 * Exporter to OpenAPI 3.1.0.
 *
 * It is the bulk format that reaches the farthest: from an OpenAPI you
 * get SDKs, gateway configuration and documentation, and Swagger Editor,
 * Insomnia, Postman, and almost anything import it.
 *
 * **YAML is emitted**, which is how an OpenAPI is published almost always.
 *
 * This was first done in JSON, out of fear of the scalar rules of YAML:
 * an unquoted `description: yes` is a boolean, and such a failure silently
 * corrupts the document. The safe shape turned out to be trivial — quote
 * **every** string — and lives in `yaml.helper.ts` with its tests,
 * including values that break a document without warning. With that, the
 * risk disappears and there is no reason to give a format that wasn't
 * asked for.
 *
 * What it **doesn't** carry is the responses part. This project scans
 * what the API **receives**; what it returns is not in any signal that
 * gets read. A `200` is emitted with a description and without a schema,
 * which is the minimum OpenAPI requires, instead of inventing a
 * response shape that nobody has verified.
 */
import type {
  IExportArtifact,
  IExportInput,
  IExportTarget,
} from "../../contracts/interfaces/core/export-target.interface.js";
import type { EndpointSpec, IEndpointField } from "../../contracts/interfaces/core/postman.interface.js";
import type {
  ISchemaGraph,
  ISchemaNode,
  SchemaNodeId,
} from "../../contracts/interfaces/core/schema.interface.js";
import { toYaml } from "../helpers/yaml.helper.js";
import type { YamlValue } from "../../contracts/interfaces/core/helpers.interface.js";
import { expandAllMethods } from "../helpers/all-method.helper.js";

/** `{{id}}` from Postman → `{id}` from OpenAPI. */
function toOpenApiPath(uri: string): string {
  return uri.replace(/\{\{([^}]+)\}\}/g, "{$1}");
}

/** The parameter names that a route carries. */
function pathParamsOf(uri: string): string[] {
  return [...uri.matchAll(/\{\{([^}]+)\}\}/g)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined);
}

/** Internal type → JSON Schema type. */
function toSchemaType(type: string): string {
  switch (type) {
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    case "object":
      return "object";
    // `enum` and `date` are restricted strings, not JSON Schema types:
    // the format and the values go separately.
    default:
      return "string";
  }
}

/** The schema of a field, with its constraints. */
function fieldSchema(field: IEndpointField): Record<string, unknown> {
  const schema: Record<string, unknown> = { type: toSchemaType(field.type) };
  if (field.format) schema["format"] = field.format;
  if (field.enumValues && field.enumValues.length > 0) {
    schema["enum"] = [...field.enumValues];
  }
  if (field.minimum !== undefined) schema["minimum"] = field.minimum;
  if (field.maximum !== undefined) schema["maximum"] = field.maximum;
  if (field.minLength !== undefined) schema["minLength"] = field.minLength;
  if (field.maxLength !== undefined) schema["maxLength"] = field.maxLength;
  if (field.type === "array") schema["items"] = { type: "string" };
  return schema;
}

function buildOperation(spec: EndpointSpec, state: IBuildState, allMarker?: string): Record<string, unknown> {
  const fields = spec.fields ?? [];
  const operation: Record<string, unknown> = {
    summary: spec.name,
    operationId: `${spec.method.toLowerCase()}${toOpenApiPath(spec.uri)
      .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) =>
        c ? c.toUpperCase() : "",
      )}`,
  };
  if (spec.description) operation["description"] = spec.description;

  // r00015 S3/S4 (audit 2026-09-06 §16, §17): emit the
  // confidence stamp as an OpenAPI 3.x extension so external
  // consumers (CI gates, the UI, post-processors) can
  // programmatically filter or warn on low-confidence
  // routes without re-deriving the scanner signal. The
  // extension is omitted when the scanner didn't stamp a
  // confidence (the scanners that produce high-confidence
  // signals — App Router `GET` named exports, OpenAPI
  // paths, Hono `.get(...)`, Fastify `fastify.get(...)` —
  // leave `confidence` undefined to keep the spec clean).
  if (spec.confidence) {
    operation["x-tanit-confidence"] = spec.confidence.level;
    if (spec.confidence.reasons.length > 0) {
      operation["x-tanit-confidence-reasons"] = spec.confidence.reasons;
    }
  }

  // Parameters: path ones come from the URI itself (always required,
  // the spec says so), and query and header ones from the validation
  // rules.
  const parameters: Array<Record<string, unknown>> = [];
  for (const name of pathParamsOf(spec.uri)) {
    const declared = fields.find((f) => f.location === "path" && f.fieldName === name);
    parameters.push({
      name,
      in: "path",
      required: true,
      schema: declared ? fieldSchema(declared) : { type: "string" },
    });
  }
  for (const field of fields) {
    // Audit 2026-09-04 P2 #9 (cookies in OpenAPI): the validation
    // contract admits `cookie` from Laravel/Fastify, but the
    // exporter only propagated `query` and `header`. OpenAPI 3.x
    // includes `in: cookie` as a valid parameter (3.0 §4.7.7,
    // 3.1 §4.8.7) and the exporter must reflect it. `path` ones
    // already come out above with `pathParamsOf`.
    if (
      field.location !== "query" &&
      field.location !== "header" &&
      field.location !== "cookie"
    ) {
      continue;
    }
    parameters.push({
      name: field.fieldName,
      in: field.location,
      required: field.required,
      schema: fieldSchema(field),
    });
  }
  // Declared headers that don't come from a rule (those from an original
  // OpenAPI spec, for example).
  for (const header of spec.headers ?? []) {
    if (parameters.some((p) => p["name"] === header.key && p["in"] === "header")) continue;
    parameters.push({
      name: header.key,
      in: "header",
      required: false,
      schema: { type: "string" },
      ...(header.description ? { description: header.description } : {}),
    });
  }
  if (parameters.length > 0) operation["parameters"] = parameters;

  const bodyFields = fields.filter((f) => f.location === "body");
  if (spec.schemaGraph) {
    // Rich path: if the scanner declared a `SchemaGraph`, we use it for
    // the body. That is what allows nesting objects, representing arrays
    // of objects and unions — the flat `fields` list cannot.
    const { schema, components } = emitSchemaGraph(
      spec.schemaGraph,
      spec.schemaGraph.root,
    );
    // We accumulate the `components` declared by this endpoint; the
    // caller mixes them with the others and moves them under
    // `components.schemas` before closing the document.
    for (const [name, body] of Object.entries(components)) {
      state.components[name] = body;
    }
    operation["requestBody"] = {
      required: bodyFields.some((f) => f.required),
      content: {
        "application/json": {
          schema,
          ...(spec.body !== undefined ? { example: spec.body } : {}),
        },
      },
    };
  } else if (bodyFields.length > 0) {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const field of bodyFields) {
      properties[field.fieldName] = fieldSchema(field);
      if (field.required) required.push(field.fieldName);
    }
    operation["requestBody"] = {
      required: required.length > 0,
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties,
            ...(required.length > 0 ? { required } : {}),
          },
          ...(spec.body !== undefined ? { example: spec.body } : {}),
        },
      },
    };
  } else if (spec.body !== undefined) {
    // There is an example but no rules: the example is emitted without
    // a schema, which is more honest than inferring types from a sample
    // JSON.
    operation["requestBody"] = {
      required: false,
      content: { "application/json": { example: spec.body } },
    };
  }

  // Audit 2026-09-04 P1 #7: auth:none per operation is respected in the
  // OpenAPI document. The global scheme defines `security` at document
  // level (`document.security = [{ bearerAuth: [] }]`), but OpenAPI
  // allows overriding per operation with `security: []` (empty array) —
  // that means "this endpoint is public, requires no security scheme".
  // Without this override, `/auth/login` was exported with
  // `Authorization: Bearer` and the first request returned 401.
  if (spec.auth?.kind === "none") {
    operation["security"] = [];
  }

  // No schema: we don't know what it returns. See the file header.
  operation["responses"] = {
    "200": { description: "OK" },
  };
  // Audit 2026-09-06 §13 (x00056 S2): an operation that originated
  // as `method: "ALL"` (Hono's `.all()`) is marked with
  // `x-tanit-source`. The expansion into the seven standard verbs
  // happens in `expandAllMethods`; this only adds the provenance
  // hint that lets a downstream tool (Redoc, Swagger Editor) tell
  // the seven operations apart from individually declared ones.
  if (allMarker !== undefined) operation["x-tanit-source"] = allMarker;
  return operation;
}

/**
 * Mutable state that runs through all `buildOperation`.
 *
 * Today it only carries `components` (the `$ref`s that `SchemaGraph`
 * declares); tomorrow it could carry, e.g., a global `visited` if two
 * endpoints share a node by id and we want to deduplicate it.
 */
interface IBuildState {
  /**
   * Accumulator of `components` per endpoint. Each endpoint that has a
   * `SchemaGraph` with named nodes adds entries here; when closing the
   * document they are moved under `components.schemas` (the shape that
   * OpenAPI expects) and mixed with `securitySchemes`.
   */
  readonly components: Record<string, Record<string, unknown>>;
}

/**
 * Translates a `SchemaGraph` to a valid JSON Schema in OpenAPI 3.1.
 *
 * The emitter does two passes:
 *
 *   1. Pre-register all nodes with `name` as empty entries in
 *      `components`, so that forward references (`A → B` where `B` is
 *      declared later) resolve in the final document.
 *   2. Emit each named node and then the root. `$ref`s are resolved
 *      against `components` by `name`; nodes without name are inlined.
 *
 * Cycles without name (e.g., a `union` whose `alternative` is directly
 * the node itself) are cut by returning `{}`: there is no way to
 * `$ref` an anonymous node, and emitting it inline would re-enter
 * infinitely. `{}` in JSON Schema means "matches anything", which is
 * the closest thing to "this part of the graph is recursive and we
 * give up drawing it".
 */
function emitSchemaGraph(
  graph: ISchemaGraph,
  rootId: SchemaNodeId,
): { schema: Record<string, unknown>; components: Record<string, Record<string, unknown>> } {
  const components: Record<string, Record<string, unknown>> = {};
  const visiting = new Set<SchemaNodeId>();
  const state = { components, visiting };

  // Pass 1: placeholders. They make refs to named nodes resolve even
  // though we have not yet emitted the body of the node.
  for (const [, node] of graph.nodes) {
    if (node.name && !(node.name in components)) {
      components[node.name] = {};
    }
  }
  // Pass 2: emit each named node over the placeholder.
  for (const [, node] of graph.nodes) {
    if (!node.name) continue;
    visiting.add(node.id);
    try {
      components[node.name] = emitSchemaNode(graph, node, state);
    } finally {
      visiting.delete(node.id);
    }
  }

  // Pass 3: the root. It is **always** inlined: the endpoint's
  // `requestBody` carries the body shape, not a pointer to a component
  // (a root `$ref` would serve if we wanted to reuse the root from
  // several endpoints, but a body per endpoint is the norm and a
  // `$ref` here would only add noise). Children with `name` keep
  // going to `components.schemas` and are referenced from within.
  //
  // We DO NOT add `rootId` to `visiting` before emitting: the cycle
  // guard at the start of `emitSchemaNode` would check the presence
  // and, since the root is anonymous, would exit with `{}`. Cycle
  // detection only has to activate when we **re-enter** a node within
  // the recursion, not when starting the first call.
  const root = graph.nodes.get(rootId);
  if (!root) return { schema: {}, components };
  const schema = emitSchemaNode(graph, root, state);
  return { schema, components };
}

/** Dispatches by `kind` to emit the node as JSON Schema. */
function emitSchemaNode(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  // Cycle cut for nodes without name: without a name to $ref to,
  // inlining it would re-enter. `{}` (matches all) is the most honest
  // output.
  if (state.visiting.has(node.id) && !node.name) return {};

  switch (node.kind) {
    case "scalar":
      return emitScalarSchema(node);
    case "enum":
      return { type: "string", enum: node.enumValues ? [...node.enumValues] : [] };
    case "literal":
      return { const: node.literal };
    case "object":
      return emitObjectSchema(graph, node, state);
    case "array":
      return emitArraySchema(graph, node, state);
    case "tuple":
      return emitTupleSchema(graph, node, state);
    case "union":
      return {
        oneOf: (node.alternatives ?? []).map((alt) =>
          emitFromId(graph, alt, state),
        ),
      };
    case "intersection":
      return {
        allOf: (node.alternatives ?? []).map((alt) =>
          emitFromId(graph, alt, state),
        ),
      };
    case "reference": {
      const target = node.ref ? graph.nodes.get(node.ref) : undefined;
      if (!target) return {};
      if (target.name) {
        return { $ref: `#/components/schemas/${target.name}` };
      }
      return emitSchemaNode(graph, target, state);
    }
    case "nullable": {
      // OpenAPI 3.1 uses JSON Schema 2020-12: `nullable: true` is
      // deprecated. Nullability is modeled with `type: [T, "null"]`
      // when the inner has a scalar `type` (string/number/etc.,
      // including object and array — JSON Schema 2020-12 accepts
      // arrays of types for all classes), or `oneOf: [T, { type: "null" }]`
      // when it does not have one (unions, references with `$ref`).
      // If the `inner` is missing (incomplete graph), we emit
      // `{ type: "null" }` — the fallback lives inside `emitNullable`.
      return emitNullable(graph, node, state);
    }
  }
}

/** Resolves an id and emits its node. Helper to avoid repeating `graph.nodes.get`. */
function emitFromId(
  graph: ISchemaGraph,
  id: SchemaNodeId,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const node = graph.nodes.get(id);
  if (!node) return {};
  return emitSchemaNode(graph, node, state);
}

/**
 * Decides how to emit a node in **child** position (object field, array
 * item, etc.).
 *
 * Different from the root, which is always inlined: the endpoint's body
 * carries the body shape, not a pointer to a component. Here, on the
 * other hand, the child is normally a reused type and `$ref` is
 * preferred over inline (reuse is what makes `components` valuable).
 *
 * References are the special case: if the child is a `reference` node,
 * we look at the **target** to decide. If the target has a name,
 * `$ref`; otherwise, we inline it.
 */
function emitChild(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  if (node.kind === "reference") {
    const target = node.ref ? graph.nodes.get(node.ref) : undefined;
    if (!target) return {};
    if (target.name) {
      return { $ref: `#/components/schemas/${target.name}` };
    }
    return emitSchemaNode(graph, target, state);
  }
  if (node.name) {
    return { $ref: `#/components/schemas/${node.name}` };
  }
  return emitSchemaNode(graph, node, state);
}

/** Emits an `object` as `{ type: "object", properties, required }`. */
function emitObjectSchema(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const edge of node.children ?? []) {
    const child = graph.nodes.get(edge.node);
    if (!child) continue;
    properties[edge.name] = emitChild(graph, child, state);
    if (edge.required) required.push(edge.name);
  }
  const out: Record<string, unknown> = { type: "object", properties };
  if (required.length > 0) out["required"] = required;
  return out;
}

/** Emits an `array` as `{ type: "array", items }`. */
function emitArraySchema(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const itemEdge = (node.children ?? [])[0];
  if (!itemEdge) return { type: "array", items: {} };
  const item = graph.nodes.get(itemEdge.node);
  if (!item) return { type: "array", items: {} };
  const items = emitChild(graph, item, state);
  return { type: "array", items };
}

/** Emits a `tuple` as `{ type: "array", prefixItems }` (OpenAPI 3.1 = JSON Schema 2020-12). */
function emitTupleSchema(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const prefixItems: Array<Record<string, unknown>> = (node.children ?? []).map(
    (edge) => {
      const child = graph.nodes.get(edge.node);
      if (!child) return {};
      return emitChild(graph, child, state);
    },
  );
  return { type: "array", prefixItems };
}

/** Emits a `scalar` with its constraints as `{ type, format, minimum, ... }`. */
function emitScalarSchema(node: ISchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = { type: node.scalarType ?? "string" };
  const c = node.constraints;
  if (!c) return out;
  if (c.format !== undefined) out["format"] = c.format;
  if (c.minimum !== undefined) out["minimum"] = c.minimum;
  if (c.maximum !== undefined) out["maximum"] = c.maximum;
  if (c.minLength !== undefined) out["minLength"] = c.minLength;
  if (c.maxLength !== undefined) out["maxLength"] = c.maxLength;
  if (c.pattern !== undefined) out["pattern"] = c.pattern;
  return out;
}

/**
 * Emits a `nullable` node as a valid composition in OpenAPI 3.1.
 *
 * OpenAPI 3.1 adopts JSON Schema 2020-12 and removes `nullable: true`.
 * Nullability is modeled like this:
 *
 *   - **Scalars** (`scalar`/`enum`/`literal`): `type: [T, "null"]` —
 *     the most compact shape, faithful to the intent.
 *   - **Compounds** (`object`/`array`/`union`/`intersection`):
 *     `oneOf: [{...inner}, { type: "null" }]` — here the `type` does
 *     not accept an array, so we go through composition.
 *   - **References**: the `$ref` can also be wrapped in
 *     `oneOf: [{$ref}, { type: "null" }]`; the 3.1 format allows it.
 *
 * If the inner doesn't resolve to anything (incomplete graph), we
 * return `{ type: "null" }`: "this may be null, nothing more" is the
 * most honest thing we can say without making it up.
 */
function emitNullable(
  graph: ISchemaGraph,
  node: ISchemaNode,
  state: { components: Record<string, Record<string, unknown>>; visiting: Set<SchemaNodeId> },
): Record<string, unknown> {
  const inner = node.inner ? emitFromId(graph, node.inner, state) : {};
  // If the inner doesn't resolve to anything (incomplete graph), we
  // fall back to `{ type: "null" }`: "this may be null, nothing more"
  // is the most honest thing we can say without making it up.
  if (Object.keys(inner).length === 0) {
    return { type: "null" };
  }
  // If the inner has a scalar `type` (string, number, object,
  // array, …), nullability goes as `type: [T, "null"]`. JSON Schema
  // 2020-12 (and therefore OpenAPI 3.1) allows this for any `type`,
  // not only strict-sense scalars.
  const innerType = inner["type"];
  if (typeof innerType === "string") {
    return { ...inner, type: [innerType, "null"] };
  }
  // The inner has no own `type` (it's a `oneOf`/`allOf`/`$ref`): we
  // move to explicit composition.
  return { oneOf: [inner, { type: "null" }] };
}

/** The `securitySchemes` block, derived from what was already detected. */
function buildSecurity(auth: IExportInput["auth"]): {
  schemes: Record<string, unknown>;
  requirement: Array<Record<string, string[]>>;
} {
  switch (auth.type) {
    case "bearer":
      return {
        schemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
        requirement: [{ bearerAuth: [] }],
      };
    case "apikey":
      return {
        schemes: {
          apiKeyAuth: {
            type: "apiKey",
            name: auth.keyName ?? "X-API-Key",
            in: auth.keyIn ?? "header",
          },
        },
        requirement: [{ apiKeyAuth: [] }],
      };
    case "oauth2":
      return {
        schemes: {
          oauth2Auth: {
            type: "oauth2",
            flows: { clientCredentials: { tokenUrl: "/oauth/token", scopes: {} } },
          },
        },
        requirement: [{ oauth2Auth: [] }],
      };
    case "none":
      return { schemes: {}, requirement: [] };
  }
}

/**
 * The OpenAPI document as an object, before serializing it.
 *
 * It is exported so its **structure** can be checked with precise
 * assertions instead of scanning for substrings in a YAML. That the
 * YAML itself is correct is another problem, and `yaml.helper.spec.ts`
 * covers it.
 */
export function buildOpenApiDocument(input: IExportInput): Record<string, unknown> {
  const { specs, config, auth } = input;

    // `components` is filled on the fly with the `$ref`s that the
    // endpoints declare in their `SchemaGraph`. If nobody declares
    // anything, it stays empty and `document.components` doesn't appear
    // — preserves the previous behavior, where `components` only
    // existed when there were `securitySchemes`.
    const state: IBuildState = { components: {} };

    // An OpenAPI `path` groups its methods: `/users` with `get` and
    // `post` is ONE entry with two operations, not two entries.
    const paths: Record<string, Record<string, unknown>> = {};
    // x00056 S2: `method: "ALL"` (the Hono `.all()` sentinel) expands
    // to the seven standard verbs here. Postman keeps the original
    // and translates to `ANY`; OpenAPI has no equivalent verb, so the
    // expansion is the only honest representation. The marker travels
    // with each expanded spec and becomes `x-tanit-source` on the
    // operation (see `buildOperation`).
    const expanded = expandAllMethods(specs);
    for (const { spec, allMarker } of expanded) {
      const path = toOpenApiPath(spec.uri);
      const bucket = paths[path] ?? (paths[path] = {});
      // The **first** wins, so it matches what the warning says. With
      // plain `=` the last won, and the warning lied about which one
      // had been kept.
      const verb = spec.method.toLowerCase();
      if (!(verb in bucket)) bucket[verb] = buildOperation(spec, state, allMarker);
    }

    const security = buildSecurity(auth);
    if (Object.keys(security.schemes).length > 0) {
      state.components["securitySchemes"] = security.schemes;
    }

    // OpenAPI 3.1 separates `components.schemas` (the reusable types
    // declared by `SchemaGraph`) from `components.securitySchemes`
    // (the auth block). If there are accumulated `components`, we move
    // them under `schemas` and leave `securitySchemes` at the
    // `components` level.
    const document: Record<string, unknown> = {
      openapi: "3.1.0",
      info: {
        title: config.collectionName || config.name,
        description: config.collectionDescription || "",
        version: "1.0.0",
      },
      servers: [{ url: config.baseUrl }],
      paths,
    };
    if (Object.keys(security.schemes).length > 0) {
      document["security"] = security.requirement;
    }
    if (Object.keys(state.components).length > 0) {
      const { securitySchemes, ...schemas } = state.components;
      const components: Record<string, unknown> = {};
      if (Object.keys(schemas).length > 0) {
        components["schemas"] = schemas;
      }
      if (securitySchemes !== undefined) {
        components["securitySchemes"] = securitySchemes;
      }
      document["components"] = components;
    }

  return document;
}

/** Serializes the catalog to an OpenAPI 3.1.0 document in YAML. */
export class OpenApiExporter implements IExportTarget {
  readonly format = "openapi";
  readonly summary = "OpenAPI 3.1.0 (YAML) — SDKs, gateways, Swagger Editor";

  /**
   * Operations that get lost due to the shape of the format.
   *
   * OpenAPI indexes by route + method, so two endpoints that share both
   * are **the same** for the document. It doesn't happen in REST; in
   * RPC over POST —GraphQL, tRPC with a single endpoint— it is the
   * norm.
   */
  warnings(input: IExportInput): string[] {
    // x00056 S2: warnings operate on the **expanded** set so the
    // collision message matches what the document actually emits. An
    // `ALL` spec expands to seven verbs and would otherwise look like
    // a single non-colliding entry while actually colliding with any
    // explicit verb on the same path.
    const expanded = expandAllMethods(input.specs);
    const byKey = new Map<string, string[]>();
    for (const { spec } of expanded) {
      const key = `${spec.method} ${toOpenApiPath(spec.uri)}`;
      byKey.set(key, [...(byKey.get(key) ?? []), spec.name]);
    }
    const out: string[] = [];
    for (const [key, names] of byKey) {
      if (names.length < 2) continue;
      out.push(
        `openapi: \`${key}\` agrupa ${names.length} operaciones y el formato solo ` +
          `admite una. Se conserva \`${names[0]}\` y se pierden: ` +
          `${names.slice(1).join(", ")}. OpenAPI identifica una operación por ruta ` +
          "y método, así que una API de RPC sobre POST no se puede representar entera.",
      );
    }
    return out;
  }

  serialize(input: IExportInput): IExportArtifact[] {
    return [
      {
        path: `${input.config.name}.openapi.yaml`,
        content: toYaml(buildOpenApiDocument(input) as YamlValue),
      },
    ];
  }
}
