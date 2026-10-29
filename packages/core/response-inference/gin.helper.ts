/**
 * Gin response inferrer (proposal `r00020` S3).
 *
 * ## What Gin says about its responses
 *
 * Gin has no response declaration either. The handler says it with a
 * call:
 *
 * ```go
 * r.GET("/users", func(c *gin.Context) {
 *     c.JSON(200, gin.H{"id": 1, "name": "Ada"})
 * })
 * ```
 *
 * The status is the **first argument** of `c.JSON`, and the body is
 * the second. `c.JSON` is the JSON renderer; `c.String`,
 * `c.Data` and `c.File` are not JSON and are ignored on purpose —
 * inferring a JSON schema for a plain string would be inventing one.
 *
 * ## The signals, strongest first
 *
 * 1. `c.JSON(201, gin.H{…})` → status 201 and the shape of the map.
 *    Confidence **medium**.
 * 2. `c.JSON(200, user)` → status 200 and a reference to `user`.
 *    Confidence **low**: a Go variable has no type in the call.
 *
 * ## Why the map is read as Go
 *
 * The literal is read as a **Go map**: `gin.H{…}`, `map[string]any{…}`
 * or a bare `map[string]string{…}`, with Go's `"key": value` pairs.
 * Go's composite literals are not JavaScript object literals — the
 * keys are quoted, the values may be typed (`"Ada"` is a string, `1`
 * an `int`), and a trailing comma is allowed. The other inferrers in
 * this folder read their own dialects for the same reason.
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
import {
  splitTopLevel,
  unwrapObjectLiteralItem,
} from "../helpers/source-scan.helper.js";

/**
 * `r.GET("/users", …)`, `router.POST("/users", …)`.
 *
 * Go spells the methods in upper case, and `findRouteAnchors`
 * uppercases what it captures anyway.
 */
const ROUTE_PATTERN =
  /\b(?:r|router|group|engine|api|gin)\s*\.\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|Any)\s*\(\s*"([^"]+)"/g;

/** `c.JSON(200, …)` — the JSON renderer of Gin. */
const JSON_CALL_PATTERN = /\bc\s*\.\s*JSON\s*\(/g;

/**
 * The statuses of Go's `net/http` package, spelled out.
 *
 * `c.JSON(http.StatusCreated, …)` is how Go code says "201", and it
 * is the spelling the standard library declares. Reading it from the
 * source would mean guessing what `http.StatusFoo` is, and a wrong
 * status code is worse than no status code.
 */
const HTTP_STATUS: Readonly<Record<string, number>> = {
  StatusContinue: 100,
  StatusSwitchingProtocols: 101,
  StatusOK: 200,
  StatusCreated: 201,
  StatusAccepted: 202,
  StatusNoContent: 204,
  StatusResetContent: 205,
  StatusMultipleChoices: 300,
  StatusMovedPermanently: 301,
  StatusFound: 302,
  StatusNotModified: 304,
  StatusBadRequest: 400,
  StatusUnauthorized: 401,
  StatusPaymentRequired: 402,
  StatusForbidden: 403,
  StatusNotFound: 404,
  StatusMethodNotAllowed: 405,
  StatusConflict: 409,
  StatusGone: 410,
  StatusUnprocessableEntity: 422,
  StatusTooManyRequests: 429,
  StatusInternalServerError: 500,
  StatusNotImplemented: 501,
  StatusBadGateway: 502,
  StatusServiceUnavailable: 503,
  StatusGatewayTimeout: 504,
};

/**
 * Infers the response of a Gin route.
 *
 * Gin declares nothing: the signal is the `c.JSON(status, payload)`
 * call the handler makes. `c.String`, `c.Data` and `c.File` are not
 * JSON and are ignored on purpose — inferring a JSON schema for a
 * plain string would be inventing one.
 */
export class GinResponseInferrer implements IResponseInferrer {
  readonly framework = "gin";

  detect(framework: string, _route: IResponseRoute): boolean {
    return framework === this.framework;
  }

  infer(route: IResponseRoute, ctx: IResponseInferContext): IResponseSpec | null {
    const text = ctx.source.content;
    const anchors = findRouteAnchors(text, ROUTE_PATTERN);
    const anchor = pickRouteAnchor(anchors, route);
    if (anchor === null) return null;

    const region = sliceUntilNextAnchor(text, anchor, anchors);
    const call = findJsonCall(region);
    if (call === null) return null;

    const schema = schemaOfPayload(call.payload);
    if (schema === null) return null;

    const entry: IResponseInference = {
      status: call.status,
      schema,
      confidence: schema.kind === "schema-graph" ? "medium" : "low",
      reason: `Gin c.JSON(${call.status}, ...)`,
    };
    return { responses: [entry] };
  }
}

/** What a `c.JSON(status, payload)` call carries. */
interface IJsonCall {
  readonly status: number;
  readonly payload: string;
}

/**
 * Finds the first `c.JSON(` call of the region and reads its two
 * arguments.
 *
 * The status is the first argument — a literal number. When it is not
 * a literal (a variable holding the code), the call carries no status
 * we can prove, and the inferrer stays quiet.
 */
function findJsonCall(region: string): IJsonCall | null {
  const re = new RegExp(JSON_CALL_PATTERN.source, "g");
  const match = re.exec(region);
  if (match === null) return null;

  const args = region.slice(match.index + match[0].length);
  const close = matchingParen(args);
  if (close === -1) return null;

  const inner = args.slice(0, close);
  const comma = topLevelComma(inner);
  if (comma === -1) return null;

  const status = statusOf(inner.slice(0, comma).trim());
  if (status === null) return null;

  return { status, payload: inner.slice(comma + 1).trim() };
}

/**
 * The status the call answers with.
 *
 * A literal number (`c.JSON(200, …)`) or one of the `net/http`
 * constants (`c.JSON(http.StatusOK, …)`). Anything else — a variable
 * holding the code — carries no status we can prove, and the inferrer
 * stays quiet.
 */
function statusOf(argument: string): number | null {
  const literal = Number.parseInt(argument, 10);
  if (Number.isFinite(literal)) return literal;

  const constant = /^(?:http\.)?(Status[A-Za-z]+)$/.exec(argument);
  const name = constant?.[1];
  if (name === undefined) return null;
  return HTTP_STATUS[name] ?? null;
}

/**
 * The schema of the payload.
 *
 * A map literal becomes a structural schema; an identifier becomes a
 * reference to it.
 */
function schemaOfPayload(payload: string): IResponseSchema | null {
  if (payload.length === 0) return null;
  const brace = payload.indexOf("{");
  if (brace === -1) {
    const name = /^[A-Za-z_][\w.]*$/.test(payload) ? payload : null;
    if (name === null) return null;
    return { kind: "ref", $ref: name };
  }
  const fields = mapLiteralFields(payload.slice(brace));
  if (fields.length === 0) return null;
  return {
    kind: "schema-graph",
    graph: buildSchemaGraph(fields, { rootName: "Response" }),
  };
}

/**
 * Reads the entries of a Go map literal.
 *
 * The literal may be wrapped (`gin.H{…}`, `map[string]any{…}`); only
 * the braces matter.
 */
function mapLiteralFields(literal: string): ReadonlyArray<IValidationSpec> {
  const open = literal.indexOf("{");
  if (open === -1) return [];
  const close = matchingBrace(literal, open);
  if (close === -1) return [];

  const fields: IValidationSpec[] = [];
  for (const raw of splitTopLevel(literal.slice(open, close + 1))) {
    // The items keep the braces of the literal when there is only one
    // of them; the unwrap is what turns `{"id": 1}` into `"id": 1`.
    const item = unwrapObjectLiteralItem(raw);
    const colon = item.indexOf(":");
    if (colon === -1) continue;
    const name = item.slice(0, colon).trim().replace(/^["`]|["`]$/g, "");
    const value = item.slice(colon + 1).trim();
    if (name.length === 0) continue;
    fields.push({
      fieldName: name,
      location: "body",
      type: goValueType(value),
      required: true,
    });
  }
  return fields;
}

/**
 * The type of a Go value literal.
 *
 * Go's typed literals (`int64(1)`, `[]string{…}`) are recognised by
 * their constructor; the bare ones by their shape.
 */
function goValueType(value: string): IValidationSpec["type"] {
  const typed = /^(?:int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|string|bool)\s*\(/.exec(
    value,
  );
  const type = typed?.[0]?.slice(0, typed[0].indexOf("(")).trim();
  switch (type) {
    case "string":
      return "string";
    case "bool":
      return "boolean";
    case "int":
    case "int8":
    case "int16":
    case "int32":
    case "int64":
    case "uint":
    case "uint8":
    case "uint16":
    case "uint32":
    case "uint64":
      return "integer";
    case "float32":
    case "float64":
      return "number";
    default:
      break;
  }
  if (value.startsWith("[]")) return "array";
  if (value.startsWith("map[")) return "object";
  if (/^".*"$/.test(value) || /^`.*`$/.test(value)) return "string";
  if (value === "true" || value === "false") return "boolean";
  if (/^-?\d+$/.test(value)) return "integer";
  if (/^-?\d*\.\d+$/.test(value)) return "number";
  return "any";
}

/** The `)` that closes the `(` at the start of the text. */
function matchingParen(text: string): number {
  // The text starts **after** the opening parenthesis, so the depth
  // starts at one: the parenthesis that closes the call is the one
  // that brings it back to zero.
  let depth = 1;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
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
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The `}` that closes the `{` at `open`. */
function matchingBrace(text: string, open: number): number {
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
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The first comma that is not inside a nested literal. */
function topLevelComma(text: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
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
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}
