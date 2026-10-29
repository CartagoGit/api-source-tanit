/**
 * Express response inferrer (proposal `r00020` S3).
 *
 * ## What Express says about its responses
 *
 * Express has no response declaration. The only thing it tells you is
 * **what the handler sends**: `res.json(body)`, `res.send(body)`,
 * `res.status(code).json(body)`. The shape of the response is
 * therefore whatever the handler puts in the call.
 *
 * That is a weaker signal than a decorator, but it is a **real**
 * signal — and the difference between "the handler sends
 * `{ id, name }`" and "the handler sends `user`" is exactly the
 * difference between a structural schema and a guess.
 *
 * ## The signals, strongest first
 *
 * 1. `res.status(201).json({ … })` → status 201 and the shape of the
 *    object literal. Confidence **medium**: the status is explicit and
 *    the shape is read from the code.
 * 2. `res.json({ … })` → status 200 and the shape of the literal.
 *    Confidence **medium**.
 * 3. `res.json(user)` → status 200 and a reference to `user`.
 *    Confidence **low**: the variable's type is unknown, so the
 *    reference names the *variable*, not a type.
 *
 * ## Why not a generic rule engine
 *
 * The payload shape is read from a **JavaScript object literal**, with
 * JavaScript's own rules: quoted or bare keys, trailing commas,
 * nested literals. A PHP array or a Go map are different languages
 * with different literals, and pretending otherwise is what produces
 * confidently wrong schemas. Each inferrer in this folder reads its
 * own dialect.
 */
import type {
  IResponseInferContext,
  IResponseInferrer,
  IResponseRoute,
  IResponseSpec,
} from "../../contracts/interfaces/core/response-inferrer.interface.js";
import type {
  IResponseInference,
  IResponseInferenceConfidence,
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
  findClosingParen,
  splitTopLevel,
  unwrapObjectLiteralItem,
} from "../helpers/source-scan.helper.js";

/**
 * `app.get("/users", …)`, `router.post("/users", …)`.
 *
 * The method is captured in group 1 and the path in group 2 — the
 * shape `findRouteAnchors` expects.
 */
const ROUTE_PATTERN =
  /\b(?:app|router|api|server|express)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*["'`]([^"'`]+)["'`]/gi;

/** `res.status(201)` — the explicit status of the response. */
const STATUS_PATTERN = /\bres\s*\.\s*status\s*\(\s*(\d{3})\s*\)/g;

/**
 * `res.json(` / `res.send(` — the call that carries the body.
 *
 * The chain matters: Express answers `res.status(201).json(body)`, and
 * the `json` of that call is **not** preceded by `res` — it is
 * preceded by `)`. A pattern that requires `res.` right before it
 * finds nothing in the chained form, which is the form every Express
 * codebase uses when the status is not 200.
 */
const SEND_PATTERN =
  /\bres(?:\s*\.\s*status\s*\(\s*\d{3}\s*\))*\s*\.\s*(json|send)\s*\(/g;

/**
 * Infers the response of an Express route.
 *
 * Express declares nothing: the only signal is what the handler
 * sends — `res.json(body)`, `res.send(body)`,
 * `res.status(code).json(body)`. The shape of the response is
 * therefore whatever the handler puts in the call, and the entry says
 * so.
 */
export class ExpressResponseInferrer implements IResponseInferrer {
  readonly framework = "express";

  /**
   * Express routes are declared with `app.<method>(path, handler)`.
   * There is no sub-slice of Express this inferrer ignores, so the
   * only question is whether the caller is talking about Express.
   */
  detect(framework: string, _route: IResponseRoute): boolean {
    return framework === this.framework;
  }

  infer(route: IResponseRoute, ctx: IResponseInferContext): IResponseSpec | null {
    const text = ctx.source.content;
    const anchors = findRouteAnchors(text, ROUTE_PATTERN);
    const anchor = pickRouteAnchor(anchors, route);
    if (anchor === null) return null;

    const region = sliceUntilNextAnchor(text, anchor, anchors);
    const call = findSendCall(region);
    if (call === null) return null;

    const schema = schemaOfPayload(call.payload);
    if (schema === null) return null;

    const confidence: IResponseInferenceConfidence =
      schema.kind === "schema-graph" ? "medium" : "low";

    const entry: IResponseInference = {
      status: call.status,
      schema,
      confidence,
      reason:
        call.status === 200
          ? `Express res.${call.kind}(...) — status 200 by default`
          : `Express res.status(${call.status}).${call.kind}(...)`,
    };
    return { responses: [entry] };
  }
}

/** What a `res.json(...)` / `res.send(...)` call carries. */
interface ISendCall {
  readonly status: number;
  readonly kind: "json" | "send";
  readonly payload: string;
}

/**
 * Finds the first response call of the handler region.
 *
 * The status is the **nearest preceding** `res.status(n)`: Express
 * chains them (`res.status(201).json(…)`), and the chain that matters
 * is the one attached to this call, not the previous handler's.
 */
function findSendCall(region: string): ISendCall | null {
  const re = new RegExp(SEND_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(region)) !== null) {
    // The match ends with the parenthesis that opens the call — and
    // it is the **last** one, because a chained `res.status(201)`
    // carries a parenthesis of its own before it.
    // The match ends with the parenthesis that opens the call — and
    // it is the **last** one, because a chained `res.status(201)`
    // carries a parenthesis of its own before it.
    const open = match.index + match[0].length - 1;
    const close = findClosingParen(region, open);
    if (close === -1) continue;
    const kind = match[1] === "send" ? "send" : "json";
    const payload = region.slice(open + 1, close).trim();
    return { status: statusBefore(region, match.index), kind, payload };
  }
  return null;
}

/**
 * The status in force when the call was made: the last `res.status(n)`
 * before it. `200` when there is none — Express's default.
 */
function statusBefore(region: string, callStart: number): number {
  const re = new RegExp(STATUS_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  let status = 200;
  while ((match = re.exec(region)) !== null) {
    // The chained form puts the `res.status(n)` at the very same
    // offset the send call starts at, so the comparison is `>` and
    // not `>=`: the status that opens the chain belongs to it.
    if (match.index > callStart) break;
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(parsed)) status = parsed;
  }
  return status;
}

/**
 * The schema of the payload.
 *
 * An object literal becomes a structural schema; an identifier becomes
 * a reference to it (the variable name is all we know); anything else
 * — a call, a template literal, an array — has no shape we can prove,
 * so the inferrer stays quiet instead of inventing one.
 */
function schemaOfPayload(payload: string): IResponseSchema | null {
  if (payload.length === 0) return null;
  if (!payload.startsWith("{")) {
    const name = /^[A-Za-z_$][\w$]*$/.test(payload.trim())
      ? payload.trim()
      : null;
    if (name === null) return null;
    return { kind: "ref", $ref: name };
  }
  const fields = objectLiteralFields(payload);
  if (fields.length === 0) return null;
  return { kind: "schema-graph", graph: buildSchemaGraph(fields, { rootName: "Response" }) };
}

/**
 * Reads the fields of a JavaScript object literal.
 *
 * Only the **top level** is read: a nested object becomes one
 * `object` field, not a tree. The repo's schema graph is built from a
 * flat list of fields by design (`buildSchemaGraph` says so), and
 * inventing a nested structure here would be a second, competing
 * shape model.
 */
function objectLiteralFields(literal: string): ReadonlyArray<IValidationSpec> {
  const fields: IValidationSpec[] = [];
  for (const raw of splitTopLevel(literal)) {
    // The items keep the braces of the literal when there is only one
    // of them; the unwrap is what turns `{ id: 1 }` into `id: 1`.
    const item = unwrapObjectLiteralItem(raw);
    const colon = item.indexOf(":");
    if (colon === -1) continue;
    const name = item.slice(0, colon).trim().replace(/^["'`]|["'`]$/g, "");
    const value = item.slice(colon + 1).trim();
    if (name.length === 0) continue;
    fields.push({
      fieldName: name,
      location: "body",
      type: literalValueType(value),
      required: true,
    });
  }
  return fields;
}

/**
 * The type of a JavaScript literal.
 *
 * The mapping is deliberately coarse: a literal proves its **shape**,
 * not its domain. `42` is an integer, `"x"` is a string, `true` is a
 * boolean; anything else is `any`.
 */
function literalValueType(value: string): IValidationSpec["type"] {
  if (/^-?\d+$/.test(value)) return "integer";
  if (/^-?\d*\.\d+$/.test(value)) return "number";
  if (value === "true" || value === "false") return "boolean";
  if (/^["'`]/.test(value)) return "string";
  if (value.startsWith("[")) return "array";
  if (value.startsWith("{")) return "object";
  return "any";
}
