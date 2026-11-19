/**
 * Ktor response inferrer (proposal `r00020` S3).
 *
 * ## What Ktor says about its responses
 *
 * Ktor's routing DSL builds the handler inline, and the handler says
 * what it answers with:
 *
 * ```kotlin
 * get("/users/{id}") {
 *     val user = UserRepository.byId(call.parameters["id"])
 *     if (user == null) {
 *         call.respond(HttpStatusCode.NotFound)
 *         return@get
 *     }
 *     call.respond(HttpStatusCode.OK, user)
 * }
 * ```
 *
 * `call.respond(status)` answers with no body; `call.respond(status,
 * payload)` answers with one. A handler may call it **more than
 * once** — the `404` above and the `200` below — and each call is a
 * real response of the endpoint. That is why the spec carries a
 * collection and not a single entry.
 *
 * ## The signals, strongest first
 *
 * 1. `call.respond(HttpStatusCode.OK, User(...))` → status 200 and a
 *    reference to the type being constructed. Confidence **medium**.
 * 2. `call.respond(HttpStatusCode.NotFound)` → status 404 and an empty
 *    body. Confidence **high** for the status: the code names it.
 * 3. `call.respond(HttpStatusCode.OK, user)` → status 200 and a
 *    reference to the variable. Confidence **low**.
 *
 * ## Why the status is read from the enum
 *
 * `HttpStatusCode.OK` is a Kotlin enum constant, not a number. The
 * mapping is the one the standard library declares, and it is written
 * out here on purpose: reading it from the source would mean guessing
 * what `HttpStatusCode.Foo` is, and a wrong status code is worse than
 * no status code.
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
import { routeRegionOf } from "../helpers/route-anchor.helper.js";

/**
 * The routing DSL: `get("/users") { … }`.
 *
 * Anchored to the beginning of a line, because in Kotlin `get(` also
 * appears as a map accessor (`map.get("key")`) and as a property
 * (`logger.get`).
 */
const ROUTE_PATTERN =
  /^[ \t]*(get|post|put|patch|delete|head|options)\s*\(\s*"([^"]+)"/gm;

/** `call.respond(` — the call that answers the request. */
const RESPOND_PATTERN = /\bcall\s*\.\s*respond\s*\(/g;

/** `HttpStatusCode.OK` — the status the handler answers with. */
const STATUS_CONSTANT_PATTERN = /HttpStatusCode\s*\.\s*([A-Za-z]+)/g;

/**
 * The status codes of the Kotlin standard library's
 * `HttpStatusCode`, spelled out.
 */
const STATUS_CODES: Readonly<Record<string, number>> = {
  Continue: 100,
  SwitchingProtocols: 101,
  OK: 200,
  Created: 201,
  Accepted: 202,
  NonAuthoritativeInformation: 203,
  NoContent: 204,
  ResetContent: 205,
  PartialContent: 206,
  MultipleChoices: 300,
  MovedPermanently: 301,
  Found: 302,
  SeeOther: 303,
  NotModified: 304,
  TemporaryRedirect: 307,
  PermanentRedirect: 308,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  MethodNotAllowed: 405,
  NotAcceptable: 406,
  RequestTimeout: 408,
  Conflict: 409,
  Gone: 410,
  LengthRequired: 411,
  UnsupportedMediaType: 415,
  UnprocessableEntity: 422,
  TooManyRequests: 429,
  InternalServerError: 500,
  NotImplemented: 501,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
};

/**
 * Infers the response of a Ktor route.
 *
 * The signal is the `call.respond(status, payload)` call the handler
 * makes. A handler may call it **more than once** — a `404` and then
 * a `200` — and each call is a real response of the endpoint, which
 * is why the spec carries a collection.
 */
export class KtorRespondResponseInferrer implements IResponseInferrer {
  readonly framework = "ktor";

  /**
   * Does this route use the construct this inferrer models — a
   * handler that answers (`call.respond(…)`)?
   *
   * Ktor declares nothing else, so the answer is: the route is
   * declared in the file and its handler answers.
   */
  detect(
    framework: string,
    route: IResponseRoute,
    ctx: IResponseInferContext,
  ): boolean {
    if (framework !== this.framework) return false;
    const region = routeRegionOf(ctx.source.content, ROUTE_PATTERN, route);
    if (region === null) return false;
    return new RegExp(RESPOND_PATTERN.source).test(region);
  }

  infer(route: IResponseRoute, ctx: IResponseInferContext): IResponseSpec | null {
    const region = routeRegionOf(ctx.source.content, ROUTE_PATTERN, route);
    if (region === null) return null;

    const calls = findRespondCalls(region);
    if (calls.length === 0) return null;

    const entries: IResponseInference[] = [];
    for (const call of calls) {
      const schema = schemaOfPayload(call.payload);
      if (schema === null) continue;
      entries.push({
        status: call.status,
        schema,
        confidence: schema.kind === "empty" ? "high" : "medium",
        reason:
          call.payload === null
            ? `Ktor call.respond(HttpStatusCode.${call.statusName})`
            : `Ktor call.respond(HttpStatusCode.${call.statusName}, ...)`,
      });
    }
    if (entries.length === 0) return null;
    return { responses: entries };
  }
}

/** What a `call.respond(...)` call carries. */
interface IRespondCall {
  readonly status: number;
  readonly statusName: string;
  /** The payload, or `null` when the call answers with no body. */
  readonly payload: string | null;
}

/**
 * Finds the `call.respond(` calls of the region.
 *
 * Every call is a response of the endpoint — a handler that answers
 * `404` and `200` declares two.
 */
function findRespondCalls(region: string): ReadonlyArray<IRespondCall> {
  const calls: IRespondCall[] = [];
  const re = new RegExp(RESPOND_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(region)) !== null) {
    const args = region.slice(match.index + match[0].length);
    const close = matchingParen(args);
    if (close === -1) break;
    const inner = args.slice(0, close).trim();
    const comma = topLevelComma(inner);
    const head = comma === -1 ? inner : inner.slice(0, comma).trim();
    const payload = comma === -1 ? null : inner.slice(comma + 1).trim();

    const statusName = statusConstantOf(head);
    if (statusName === null) continue;
    const status = STATUS_CODES[statusName];
    if (status === undefined) continue;
    calls.push({ status, statusName, payload });
  }
  return calls;
}

/** The `HttpStatusCode` constant of an argument, if it is one. */
function statusConstantOf(argument: string): string | null {
  const re = new RegExp(STATUS_CONSTANT_PATTERN.source, "g");
  const match = re.exec(argument);
  return match?.[1] ?? null;
}

/**
 * The schema of the payload.
 *
 * A **constructor call** (`User(1, "Ada")`) names its type, and that
 * type is the response — a reference to it is the honest answer. A
 * bare identifier names a variable, and a variable's type is unknown.
 */
function schemaOfPayload(payload: string | null): IResponseSchema | null {
  if (payload === null || payload.length === 0) return { kind: "empty" };
  const constructor = /^([A-Z][A-Za-z0-9_]*)\s*\(/.exec(payload);
  if (constructor?.[1]) return { kind: "ref", $ref: constructor[1] };
  if (/^[A-Za-z_][\w.]*$/.test(payload)) return { kind: "ref", $ref: payload };
  return null;
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
    if (c === '"' || c === "'") {
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
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) return i;
  }
  return -1;
}
