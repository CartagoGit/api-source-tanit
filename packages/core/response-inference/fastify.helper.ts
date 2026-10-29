/**
 * Fastify response inferrer (proposal `r00020` S3).
 *
 * ## What Fastify says about its responses
 *
 * Fastify is the only one of the six that **declares** its response
 * schema, and it does it in the route options:
 *
 * ```ts
 * fastify.get("/users", {
 *   schema: {
 *     response: {
 *       200: { type: "object", properties: { id: { type: "integer" } } },
 *     },
 *   },
 * }, handler);
 * ```
 *
 * The status keys of `schema.response` are the statuses the endpoint
 * answers with, and the value is a **JSON Schema**. That is a
 * stronger signal than anything the other five frameworks offer, so
 * the entries it produces carry `confidence: "high"`.
 *
 * ## The signals, strongest first
 *
 * 1. `schema.response.200` with an inline JSON Schema → the status and
 *    the shape of the object.
 * 2. `schema.response.200.$ref` (or `$ref("…")`) → the status and a
 *    reference to the shared schema.
 * 3. `reply.code(201).send(…)` → the status, with an empty body.
 *    Fastify lets the handler override the declared status, and that
 *    override is worth reading.
 *
 * ## Why a JSON Schema reader and not a generic one
 *
 * The schema is read as **JSON Schema**: `type`, `properties`,
 * `required`. A Ruby hash or a Go map are not JSON Schema, and the
 * other inferrers in this folder read their own dialects.
 */
import type {
  IResponseInferContext,
  IResponseInferrer,
  IResponseRoute,
  IResponseSpec,
} from "../../contracts/interfaces/core/response-inferrer.interface.js";
import type {
  IResponseInference,
  IResponseSchema,
} from "../../contracts/interfaces/core/responses.interface.js";
import type { IValidationSpec } from "../../contracts/interfaces/core/scanner.interface.js";
import { buildSchemaGraph } from "../schema/build-schema-graph.helper.js";
import {
  findRouteAnchors,
  pickRouteAnchor,
  sliceUntilNextAnchor,
} from "../helpers/route-anchor.helper.js";
import { splitTopLevel } from "../helpers/source-scan.helper.js";

/**
 * `fastify.get("/users", …)`, `app.post("/users", …)`.
 *
 * Fastify spells the methods in lower case, but the scanner reports
 * them uppercased; `findRouteAnchors` uppercases what it captures.
 */
const ROUTE_PATTERN =
  /\b(?:fastify|app|server|instance|api)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

/** `reply.code(201)` / `reply.status(201)` — the handler's override. */
const REPLY_STATUS_PATTERN = /\breply\s*\.\s*(?:code|status)\s*\(\s*(\d{3})\s*\)/g;

/** The `response` key of the route's `schema`. */
const RESPONSE_KEY_PATTERN = /\bresponse\s*:/g;

/**
 * Infers the response of a Fastify route.
 *
 * Fastify is the only one of the six that **declares** its response
 * schema, in the route's options: `schema.response` maps a status to
 * a JSON Schema. That is an explicit declaration, so the entries it
 * produces carry `confidence: "high"`.
 */
export class FastifyResponseInferrer implements IResponseInferrer {
  readonly framework = "fastify";

  detect(framework: string, _route: IResponseRoute): boolean {
    return framework === this.framework;
  }

  infer(route: IResponseRoute, ctx: IResponseInferContext): IResponseSpec | null {
    const text = ctx.source.content;
    const anchors = findRouteAnchors(text, ROUTE_PATTERN);
    const anchor = pickRouteAnchor(anchors, route);
    if (anchor === null) return null;

    const region = sliceUntilNextAnchor(text, anchor, anchors);
    const declared = readDeclaredResponses(region);
    if (declared.length > 0) {
      return { responses: declared };
    }

    // No declared schema: the handler may still override the status.
    const status = replyStatus(region);
    if (status === null) return null;
    const entry: IResponseInference = {
      status,
      schema: { kind: "empty" },
      confidence: "low",
      reason: `Fastify reply.code(${status}).send(...) — no response schema declared`,
    };
    return { responses: [entry] };
  }
}

/**
 * Reads `schema.response` — the statuses the route declares and the
 * schema of each.
 */
function readDeclaredResponses(region: string): ReadonlyArray<IResponseInference> {
  // A fresh regex per call: a module-level one with the `g` flag
  // carries `lastIndex` between calls, and the second route of the
  // file would be read starting from wherever the first one stopped.
  const key = new RegExp(RESPONSE_KEY_PATTERN.source, "g").exec(region);
  if (key === null) return [];

  const afterKey = region.slice(key.index + key[0].length);
  const block = balancedObjectAfter(afterKey);
  if (block === null) return [];

  const entries: IResponseInference[] = [];
  for (const item of splitTopLevel(block)) {
    const colon = item.indexOf(":");
    if (colon === -1) continue;
    const status = Number.parseInt(item.slice(0, colon).trim(), 10);
    if (!Number.isFinite(status)) continue;
    const value = item.slice(colon + 1).trim();
    const schema = schemaOfJsonSchema(value);
    if (schema === null) continue;
    entries.push({
      status,
      schema,
      confidence: "high",
      reason: `Fastify schema.response.${status}`,
    });
  }
  return entries;
}

/**
 * The schema of one entry of `schema.response`.
 *
 * A `$ref` becomes a reference; an inline JSON Schema with
 * `properties` becomes a structural schema; anything else (a bare
 * `true`, an empty object) has no shape to prove.
 */
function schemaOfJsonSchema(value: string): IResponseSchema | null {
  const ref = /\$ref\s*[:(]\s*["']([^"']+)["']/.exec(value);
  if (ref?.[1]) return { kind: "ref", $ref: ref[1] };

  const fields = jsonSchemaProperties(value);
  if (fields.length === 0) return null;
  return {
    kind: "schema-graph",
    graph: buildSchemaGraph(fields, { rootName: "Response" }),
  };
}

/**
 * The properties of an inline JSON Schema, as a flat field list.
 *
 * Only the top level is read — the repo's schema graph is built from a
 * flat list by design, and a nested reconstruction here would be a
 * second shape model competing with it.
 */
function jsonSchemaProperties(value: string): ReadonlyArray<IValidationSpec> {
  const marker = /\bproperties\s*:/.exec(value);
  if (marker === null) return [];
  const afterMarker = value.slice(marker.index + marker[0].length);
  const block = balancedObjectAfter(afterMarker);
  if (block === null) return [];

  const required = requiredNames(value);
  const fields: IValidationSpec[] = [];
  for (const item of splitTopLevel(block)) {
    const colon = item.indexOf(":");
    if (colon === -1) continue;
    const name = item.slice(0, colon).trim().replace(/^["']|["']$/g, "");
    if (name.length === 0) continue;
    const property = item.slice(colon + 1).trim();
    fields.push({
      fieldName: name,
      location: "body",
      type: jsonSchemaType(property),
      required: required.has(name),
    });
  }
  return fields;
}

/** The names listed in the schema's `required` array. */
function requiredNames(value: string): ReadonlySet<string> {
  const names = new Set<string>();
  const marker = /\brequired\s*:\s*\[/.exec(value);
  if (marker === null) return names;
  const start = value.indexOf("[", marker.index);
  const end = value.indexOf("]", start);
  if (start === -1 || end === -1) return names;
  for (const raw of value.slice(start + 1, end).split(",")) {
    const name = raw.trim().replace(/^["']|["']$/g, "");
    if (name.length > 0) names.add(name);
  }
  return names;
}

/** The type of a JSON Schema property. */
function jsonSchemaType(property: string): IValidationSpec["type"] {
  const marker = /\btype\s*:\s*["']([^"']+)["']/.exec(property);
  const type = marker?.[1];
  switch (type) {
    case "string":
      return "string";
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
    case "null":
      return "any";
    default:
      return "any";
  }
}

/**
 * The `{ … }` block that opens the text, without the braces.
 */
function balancedObjectAfter(text: string): string | null {
  const open = text.indexOf("{");
  if (open === -1) return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** The status the handler forces with `reply.code(n)`. */
function replyStatus(region: string): number | null {
  const re = new RegExp(REPLY_STATUS_PATTERN.source, "g");
  const match = re.exec(region);
  if (match === null) return null;
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}
