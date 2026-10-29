/**
 * Laravel Resources response inferrer (proposal `r00020` S3).
 *
 * ## The problem Laravel poses
 *
 * Laravel declares its routes in `routes/api.php` and its responses in
 * the **controller** — a different file. The scanner reports the
 * controller it resolved (`App\Http\Controllers\UserController`) and
 * the action (`index`), which is the information this inferrer needs
 * to find the controller on disk.
 *
 * So this inferrer has three modes, and it picks by what it can read:
 *
 * 1. **The controller** — the action returns a Resource:
 *    `return new UserResource($user);` or
 *    `return UserResource::collection(User::all());`. The Resource
 *    class is the response. Confidence **high**.
 * 2. **The Resource class** — the Resource file is readable, so its
 *    `toArray()` says which fields the response carries. The field
 *    names are proven by the code; their types are not (a Resource
 *    reads them from the model), so they are reported as `any`.
 *    Confidence **high** — the shape is declared, not guessed.
 * 3. **The convention** — neither file is readable. Laravel's
 *    convention says a `UserController` answers with a
 *    `UserResource`. Confidence **low**: the convention can be broken,
 *    and the `reason` says it is a convention.
 *
 * ## Why Resources and not plain controllers
 *
 * A Laravel controller that returns `User::all()` returns a **model**,
 * and the fields a model serialises are a database question, not a
 * code question. A `JsonResource` states the shape **in code**
 * (`toArray()`), which is exactly the kind of signal a response
 * inferrer can read. That is why this inferrer serves the Resources
 * slice of Laravel and ignores the rest: inferring a model shape
 * would mean inventing fields.
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

/** `new UserResource(` — the resource the action returns. */
const NEW_RESOURCE_PATTERN = /\bnew\s+([A-Za-z_][A-Za-z0-9_]*Resource)\s*\(/g;

/** `UserResource::collection(` — the resource of a collection. */
const COLLECTION_PATTERN = /\b([A-Za-z_][A-Za-z0-9_]*Resource)\s*::\s*collection\s*\(/g;

/** `public function index(` — the controller action. */
const ACTION_PATTERN = /\bfunction\s+([a-zA-Z_][A-Za-z0-9_]*)\s*\(/g;

/** `return [ … ];` — the array a Resource's `toArray()` returns. */
const RETURN_ARRAY_PATTERN = /\breturn\s*\[/g;

/** `'id' => $this->id` — one entry of that array. */
const RESOURCE_FIELD_PATTERN = /['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*=>/g;

/**
 * The statuses Laravel's resource convention answers with.
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
 * Infers the response of a Laravel route that answers with a
 * `JsonResource`.
 *
 * The slice it serves is the Resources one: a Laravel controller that
 * returns a plain model says nothing about the shape of its response
 * that the code does not already say.
 */
export class LaravelResourcesResponseInferrer implements IResponseInferrer {
  readonly framework = "laravel";

  /**
   * Every Laravel route is a candidate — whether it answers with a
   * Resource is what `infer()` decides, not `detect()`.
   */
  detect(framework: string, _route: IResponseRoute): boolean {
    return framework === this.framework;
  }

  infer(route: IResponseRoute, ctx: IResponseInferContext): IResponseSpec | null {
    // Mode 1 — the file we were given IS the controller.
    const direct = inferFromController(route, ctx.source.content, ctx);
    if (direct !== null) return direct;

    // Mode 1' — the controller is another file of the project.
    const controller = controllerTextOf(route, ctx);
    if (controller !== null) {
      const viaFile = inferFromController(route, controller, ctx);
      if (viaFile !== null) return viaFile;
      // The controller was read and its action does not return a
      // Resource: we know the answer, and the answer is "not this
      // slice". Falling through to the convention here would answer
      // "OrderResource" for a controller that returns a plain model.
      if (actionBody(controller, route.actionName ?? "") !== null) return null;
    }

    // Mode 3 — the convention, read from the routes file.
    return inferFromRoutes(route, ctx.source.content);
  }
}

/**
 * The controller mode: the file returns a Resource.
 */
function inferFromController(
  route: IResponseRoute,
  text: string,
  ctx: IResponseInferContext,
): IResponseSpec | null {
  const action = route.actionName ?? "";
  const body = actionBody(text, action);
  if (body === null) return null;

  const resource =
    firstMatch(COLLECTION_PATTERN, body) ?? firstMatch(NEW_RESOURCE_PATTERN, body);
  if (resource === null) return null;

  const status = ACTION_STATUS[action] ?? 200;
  const fields = resourceFields(resource, ctx);
  const schema: IResponseSchema =
    fields !== null && fields.length > 0
      ? { kind: "schema-graph", graph: buildSchemaGraph(fields, { rootName: resource }) }
      : { kind: "ref", $ref: resource };

  const entry: IResponseInference = {
    status,
    schema,
    confidence: "high",
    reason:
      schema.kind === "schema-graph"
        ? `Laravel ${resource}::toArray() returned by the action`
        : `Laravel ${resource} returned by the action`,
  };
  return { responses: [entry] };
}

/**
 * The routes mode: the file declares routes and nothing else.
 *
 * The Resource is derived from the controller by Laravel's naming
 * convention: `UserController` → `UserResource`.
 */
function inferFromRoutes(
  route: IResponseRoute,
  text: string,
): IResponseSpec | null {
  if (!looksLikeRoutesFile(text)) return null;

  const status = ACTION_STATUS[route.actionName ?? ""];
  if (status === undefined) return null;

  const resource = resourceNameFromController(route.controllerClass);
  if (resource === null) return null;

  const entry: IResponseInference = {
    status,
    schema: { kind: "ref", $ref: resource },
    confidence: "low",
    reason: `Laravel convention — ${route.controllerClass} answers with ${resource}`,
  };
  return { responses: [entry] };
}

/**
 * The text of the controller that answers the route.
 *
 * The scanner reported the controller's FQCN, and Laravel's directory
 * layout is the convention: `App\Http\Controllers\UserController` lives
 * in `app/Http/Controllers/UserController.php`.
 */
function controllerTextOf(
  route: IResponseRoute,
  ctx: IResponseInferContext,
): string | null {
  const read = ctx.readSource;
  if (read === undefined) return null;
  const controllerClass = route.controllerClass;
  if (controllerClass === undefined || controllerClass.length === 0) return null;

  const candidates = controllerPaths(controllerClass);
  for (const candidate of candidates) {
    const file = read(candidate);
    if (file !== null && file.content.length > 0) return file.content;
  }
  return null;
}

/**
 * The paths a controller class may live in, most specific first.
 *
 * `App\Http\Controllers\UserController` → `app/Http/Controllers/
 * UserController.php`. The second candidate covers the projects that
 * keep the controller one level up.
 */
function controllerPaths(controllerClass: string): ReadonlyArray<string> {
  const parts = controllerClass.split(/[\\\/]/).filter((p) => p.length > 0);
  const className = parts[parts.length - 1] ?? "";
  const relative = parts
    .filter((p) => p !== "App")
    .map((p) => (p === className ? `${p}.php` : p))
    .join("/");
  const flat = `app/Http/Controllers/${className}.php`;
  const nested = relative.length > 0 ? `app/${relative}` : flat;
  return nested === flat ? [flat] : [nested, flat];
}

/**
 * The fields a Resource's `toArray()` declares.
 *
 * The **names** are read from the code; the **types** are not. A
 * Resource returns `$this->email`, and what that is depends on the
 * model's cast — a database question. So the fields are reported with
 * the `any` type, which is the truth about a Resource.
 */
function resourceFields(
  resource: string,
  ctx: IResponseInferContext,
): ReadonlyArray<IValidationSpec> | null {
  const read = ctx.readSource;
  if (read === undefined) return null;

  const file = read(`app/Http/Resources/${resource}.php`);
  if (file === null) return null;

  const body = toArrayBody(file.content);
  if (body === null) return null;

  const names: string[] = [];
  const re = new RegExp(RESOURCE_FIELD_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  if (names.length === 0) return null;

  return names.map((fieldName) => ({
    fieldName,
    location: "body" as const,
    type: "any" as const,
    required: true,
  }));
}

/**
 * The array a Resource's `toArray()` returns.
 */
function toArrayBody(text: string): string | null {
  const marker = /\bfunction\s+toArray\s*\(/.exec(text);
  if (marker === null) return null;
  const open = text.indexOf("{", marker.index);
  if (open === -1) return null;
  const close = matchingBrace(text, open);
  if (close === -1) return null;
  const body = text.slice(open, close + 1);

  const ret = new RegExp(RETURN_ARRAY_PATTERN.source, "g").exec(body);
  if (ret === null) return null;
  const start = body.indexOf("[", ret.index);
  if (start === -1) return null;
  const end = body.indexOf("]", start);
  if (end === -1) return null;
  return body.slice(start + 1, end);
}

/**
 * The body of the controller action.
 *
 * PHP's braces are reliable, so the body is the balanced block that
 * follows the method signature.
 */
function actionBody(text: string, actionName: string): string | null {
  const re = new RegExp(ACTION_PATTERN.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = match[1] ?? "";
    if (actionName.length > 0 && name !== actionName) continue;
    const open = text.indexOf("{", match.index);
    if (open === -1) return null;
    const close = matchingBrace(text, open);
    if (close === -1) return null;
    return text.slice(open, close + 1);
  }
  return null;
}

/** The first capture of the first match of a pattern. */
function firstMatch(pattern: RegExp, text: string): string | null {
  const re = new RegExp(pattern.source, "g");
  const match = re.exec(text);
  return match?.[1] ?? null;
}

/**
 * The Resource a controller answers with, by Laravel's convention.
 *
 * `App\Http\Controllers\UserController` → `UserResource`.
 */
function resourceNameFromController(
  controllerClass: string | undefined,
): string | null {
  if (controllerClass === undefined || controllerClass.length === 0) return null;
  const parts = controllerClass.split(/[\\\/]/).filter((p) => p.length > 0);
  const className = parts[parts.length - 1] ?? "";
  const model = className.endsWith("Controller")
    ? className.slice(0, -"Controller".length)
    : className;
  if (model.length === 0) return null;
  return `${model}Resource`;
}

/** Whether the file looks like a Laravel routes file. */
function looksLikeRoutesFile(text: string): boolean {
  return (
    text.includes("Route::") ||
    text.includes("Illuminate\\Support\\Facades\\Route")
  );
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
