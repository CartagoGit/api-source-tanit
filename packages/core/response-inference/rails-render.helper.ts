/**
 * Rails response inferrer (proposal `r00020` S3).
 *
 * ## The problem Rails poses
 *
 * Rails declares its routes in `config/routes.rb` and its responses in
 * the **controller** — a different file. The scanner reports the route
 * with the file it was declared in, so the inferrer is handed
 * `routes.rb` and asked what the endpoint returns. In `routes.rb`
 * there is no response.
 *
 * So this inferrer has three modes, and it picks by what it can read:
 *
 * 1. **The controller** — the file declares `def <action>` and the
 *    action renders JSON. Then the answer is read from the code:
 *    `render json: @user`, `render json: { id: 1 }`,
 *    `render json: @user, status: :created`. Confidence **medium**
 *    for a hash literal, **low** for an instance variable (the model
 *    is guessed from its name).
 * 2. **The controller, read from the project** — the route's file is
 *    `routes.rb`, so the controller is looked up on disk
 *    (`app/controllers/users_controller.rb`). Same answer, and it is
 *    the mode that fires in production.
 * 3. **The routes file** — the file declares routes and nothing else.
 *    Then the answer comes from the **convention** Rails guarantees:
 *    `resources :users` answers with users, `GET /users` answers with
 *    a collection, `GET /users/{id}` with one, `POST /users` with a
 *    `201`, `DELETE /users/{id}` with a `204`. Confidence **low** —
 *    it is a convention, not a declaration.
 *
 * Writing down which mode produced an answer is not decoration: the
 * `reason` is what the user reads in the exported collection.
 *
 * ## Why not a generic rule engine
 *
 * The convention table is **Rails'**: `index` is a collection, `show`
 * is one, `create` answers `201`, `destroy` answers `204`. Another
 * framework's conventions are another framework's business, and a
 * generic table would have to average them — producing answers that
 * are right about half the time.
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
  splitTopLevel,
  unwrapObjectLiteralItem,
} from "../helpers/source-scan.helper.js";

/** `render json: …` — the call that renders a JSON response. */
const RENDER_JSON_PATTERN = /\brender\s+(?:\([^)]*?\b)?json\s*:/g;

/** `status: :created` — the status the render declares. */
const RENDER_STATUS_PATTERN = /\bstatus\s*:\s*:([a-z_]+)/g;

/** `def <action>` — the controller method. */
const METHOD_PATTERN = /^([ \t]*)def\s+([a-z_][A-Za-z0-9_]*[?!]?)/gm;

/**
 * The statuses Rails' REST convention answers with, per action.
 *
 * `create` answers `201 Created`, `destroy` answers `204 No Content`,
 * and the rest answer `200`.
 */
const ACTION_STATUS: Readonly<Record<string, number>> = {
  index: 200,
  show: 200,
  create: 201,
  store: 201,
  update: 200,
  destroy: 204,
};

/**
 * The statuses a `render` may declare with a symbol.
 *
 * Rails' own vocabulary — the same list `ActionController` uses.
 */
const RENDER_STATUS: Readonly<Record<string, number>> = {
  ok: 200,
  created: 201,
  accepted: 202,
  no_content: 204,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable_entity: 422,
  internal_server_error: 500,
};

/**
 * Infers the response of a Rails route that renders JSON.
 *
 * The slice it serves is the `render json:` one: an action that
 * renders HTML says nothing about a JSON response.
 */
export class RailsRenderResponseInferrer implements IResponseInferrer {
  readonly framework = "rails";

  /**
   * Every Rails route is a candidate — whether it renders JSON is what
   * `infer()` decides, not `detect()`.
   */
  detect(framework: string, _route: IResponseRoute): boolean {
    return framework === this.framework;
  }

  infer(route: IResponseRoute, ctx: IResponseInferContext): IResponseSpec | null {
    // Mode 1 — the file we were given IS the controller.
    const direct = inferFromController(route, ctx.source.content);
    if (direct !== null) return direct;

    // Mode 2 — the controller is another file of the project.
    const controller = controllerTextOf(route, ctx);
    if (controller !== null) {
      const viaFile = inferFromController(route, controller);
      if (viaFile !== null) return viaFile;
      // The controller was read and its action does not render JSON:
      // we know the answer, and the answer is "not this slice".
      // Falling through to the convention here would answer with a
      // model the action never returns.
      if (actionBody(controller, actionOf(route)) !== null) return null;
    }

    // Mode 3 — the convention, read from the routes file.
    return inferFromRoutes(route, ctx.source.content);
  }
}

/**
 * The controller mode: the file renders JSON.
 */
function inferFromController(
  route: IResponseRoute,
  text: string,
): IResponseSpec | null {
  const action = actionOf(route);
  const body = actionBody(text, action);
  if (body === null) return null;

  const render = new RegExp(RENDER_JSON_PATTERN.source, "g").exec(body);
  if (render === null) return null;

  const afterRender = body.slice(render.index + render[0].length);
  const value = firstArgument(afterRender);
  if (value === null) return null;

  const status = declaredStatus(body, render.index) ?? ACTION_STATUS[action] ?? 200;
  const schema = schemaOfRenderValue(value);
  if (schema === null) return null;

  const entry: IResponseInference = {
    status,
    schema,
    confidence: schema.kind === "schema-graph" ? "medium" : "low",
    reason: `Rails render json: ${truncate(value)}`,
  };
  return { responses: [entry] };
}

/**
 * The routes mode: the file declares routes and nothing else.
 *
 * The answer comes from the REST convention, so it is `low`
 * confidence and the reason says so — a user who reads "Rails REST
 * convention" knows not to trust it blindly.
 */
function inferFromRoutes(
  route: IResponseRoute,
  text: string,
): IResponseSpec | null {
  if (!looksLikeRoutesFile(text)) return null;

  const action = actionOf(route);
  if (action.length === 0) return null;
  const status = ACTION_STATUS[action];
  if (status === undefined) return null;

  const model = modelNameOf(route);
  if (model === null) return null;

  const entry: IResponseInference = {
    status,
    schema: { kind: "ref", $ref: model },
    confidence: "low",
    reason: `Rails REST convention — ${action} answers with ${model}`,
  };
  return { responses: [entry] };
}

/**
 * The action that answers the route.
 *
 * The scanner reports it when the route came from `resources :x` —
 * and **only** then. A plain `get "/x" => "y#z"` carries no action,
 * and that is not a gap to fill with a guess: the convention "the
 * route answers with a model of the same name" is true of resource
 * routes and of nothing else. `get "/health"` answers with whatever
 * the action renders, and "Health" is not a model anybody has.
 *
 * So an unknown action means the inferrer has nothing to say.
 */
function actionOf(route: IResponseRoute): string {
  return route.actionName ?? "";
}

/**
 * The text of the controller that answers the route.
 *
 * Rails' layout is the convention: `app/controllers/users_controller.rb`
 * for `/users`, and `app/controllers/api/users_controller.rb` for a
 * route under the `api` namespace.
 */
function controllerTextOf(
  route: IResponseRoute,
  ctx: IResponseInferContext,
): string | null {
  const read = ctx.readSource;
  if (read === undefined) return null;

  for (const candidate of controllerPaths(route)) {
    const file = read(candidate);
    if (file !== null && file.content.length > 0) return file.content;
  }
  return null;
}

/**
 * The paths a controller may live in, most specific first.
 */
function controllerPaths(route: IResponseRoute): ReadonlyArray<string> {
  const segments = route.uri
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("{"));
  const last = segments[segments.length - 1];
  if (last === undefined) return [];

  const file = `${snakeCase(last)}_controller.rb`;
  const namespace = segments.slice(0, -1).map((s) => snakeCase(s));
  const nested = `app/controllers/${[...namespace, file].join("/")}`;
  const flat = `app/controllers/${file}`;
  return nested === flat ? [flat] : [nested, flat];
}

/**
 * `Users` → `users`, `APIKeys` → `api_keys`.
 */
function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
}

/**
 * The body of the controller method that answers the route.
 *
 * Ruby has no braces to match: the method ends at the next `def` at
 * the same indentation. That is the heuristic every Ruby reader uses,
 * and it is enough for a method that renders once.
 */
function actionBody(text: string, actionName: string): string | null {
  const re = new RegExp(METHOD_PATTERN.source, "gm");
  let match: RegExpExecArray | null;
  const candidates: Array<{ indent: string; name: string; start: number }> = [];
  while ((match = re.exec(text)) !== null) {
    candidates.push({
      indent: match[1] ?? "",
      name: match[2] ?? "",
      start: match.index + match[0].length,
    });
  }
  if (candidates.length === 0) return null;

  // An action that the controller does not define has no body. The
  // fallback to the first method is only for the case where nobody
  // named an action — reading another method's body would answer
  // with a response the route does not have.
  const wanted =
    actionName.length === 0
      ? candidates[0]
      : candidates.find((c) => c.name === actionName);
  if (wanted === undefined) return null;

  // The method ends where the next method of the same class starts.
  const next = candidates.find((c) => c.start > wanted.start && c.indent === wanted.indent);
  const end = next === undefined ? text.length : next.start;
  return text.slice(wanted.start, end);
}

/**
 * The first argument after the `json:` — the rendered value.
 */
function firstArgument(text: string): string | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{")) {
    const close = matchingBrace(trimmed, 0);
    return close === -1 ? null : trimmed.slice(0, close + 1);
  }
  const match = /^([^\s,]+)/.exec(trimmed);
  return match?.[1] ?? null;
}

/**
 * The status the render declares (`status: :created`), or `null`.
 */
function declaredStatus(body: string, renderIndex: number): number | null {
  const re = new RegExp(RENDER_STATUS_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index < renderIndex) continue;
    const status = RENDER_STATUS[match[1] ?? ""];
    if (status !== undefined) return status;
  }
  return null;
}

/**
 * The schema of the rendered value.
 *
 * A **hash literal** proves its shape: `{ id: 1, name: "Ada" }` is
 * read as an object. An **instance variable** (`@user`) names a model
 * whose columns are a database question, so the honest answer is a
 * reference to the model — the name it carries, capitalised.
 */
function schemaOfRenderValue(value: string): IResponseSchema | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    const fields = hashFields(trimmed);
    if (fields.length === 0) return null;
    return {
      kind: "schema-graph",
      graph: buildSchemaGraph(fields, { rootName: "Response" }),
    };
  }
  const variable = /^@([a-z_][A-Za-z0-9_]*)$/.exec(trimmed);
  if (variable?.[1] !== undefined) {
    return { kind: "ref", $ref: capitalise(variable[1]) };
  }
  return null;
}

/**
 * The fields of a Ruby hash literal.
 *
 * Only the top level is read: the repo's schema graph is built from a
 * flat list of fields by design.
 */
function hashFields(literal: string): ReadonlyArray<IValidationSpec> {
  const fields: IValidationSpec[] = [];
  for (const raw of splitTopLevel(literal)) {
    // The items keep the braces of the literal when there is only one
    // of them; the unwrap is what turns `{ id: 1 }` into `id: 1`.
    const item = unwrapObjectLiteralItem(raw);
    const colon = item.indexOf(":");
    if (colon === -1) continue;
    const name = item.slice(0, colon).trim().replace(/^["']|["']$/g, "");
    const value = item.slice(colon + 1).trim();
    if (name.length === 0) continue;
    fields.push({
      fieldName: name,
      location: "body",
      type: hashValueType(value),
      required: true,
    });
  }
  return fields;
}

/**
 * The type of a Ruby literal.
 *
 * The mapping is deliberately coarse: a literal proves its **shape**,
 * not its domain.
 */
function hashValueType(value: string): IValidationSpec["type"] {
  if (/^-?\d+$/.test(value)) return "integer";
  if (/^-?\d*\.\d+$/.test(value)) return "number";
  if (value === "true" || value === "false") return "boolean";
  if (value.startsWith("[")) return "array";
  if (value.startsWith("{")) return "object";
  return "any";
}

/**
 * The model a route answers with, by the Rails convention.
 *
 * `/users` answers with users; `/users/{id}` with one user.
 */
function modelNameOf(route: IResponseRoute): string | null {
  const segments = route.uri
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("{"));
  const last = segments[segments.length - 1];
  if (last === undefined) return null;
  const singular = last.endsWith("s") && !last.endsWith("ss") ? last.slice(0, -1) : last;
  return capitalise(singular);
}

/** `user` → `User`. */
function capitalise(name: string): string {
  if (name.length === 0) return name;
  return name[0]?.toUpperCase() + name.slice(1);
}

/** Whether the file looks like a Rails routes file. */
function looksLikeRoutesFile(text: string): boolean {
  return text.includes("Rails.application.routes.draw");
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
    if (c === '"' || c === "'") {
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

/** The first 40 characters of a value, for the reason. */
function truncate(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= 40 ? clean : `${clean.slice(0, 39)}…`;
}
